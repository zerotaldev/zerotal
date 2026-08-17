import type { ServerWebSocket } from "bun";
import { safeEqual, hmacHex } from "@zerotal/core";
import { BroadcastManager, _isValidChannel } from "./BroadcastManager.ts";
import type { PresenceMember } from "./BroadcastManager.ts";
import type { WsConnectionData } from "./types.ts";

type WS = ServerWebSocket<WsConnectionData>;

interface PusherSubscribeData {
  channel: string;
  auth?: string;
  channel_data?: string;
}

interface PusherClientMessage {
  event: string;
  data?: PusherSubscribeData | Record<string, unknown>;
  channel?: string;
}

/**
 * Callback for resolving a presence-channel member from an HTTP auth request.
 * Return `false` to deny authorization.
 */
export type PusherPresenceResolver = (
  req: Request,
  channel: string,
) =>
  | Promise<{ id: string | number; info?: Record<string, unknown> } | false>
  | { id: string | number; info?: Record<string, unknown> }
  | false;

/**
 * Pusher/Reverb-compatible WebSocket broadcast manager.
 *
 * Implements the Pusher wire protocol on top of `BroadcastManager` so that
 * Any Pusher-compatible client can connect to a Zerotal
 * backend without modifications.
 *
 * Key protocol differences from the native Zerotal protocol:
 *  - Connection event: `pusher:connection_established` (data is JSON string)
 *  - Subscribe event: `pusher:subscribe` (channel inside `data` object)
 *  - Subscription succeeded: `pusher_internal:subscription_succeeded`
 *  - All server-sent data fields are JSON strings, not objects
 *  - Auth for private/presence channels uses HMAC-SHA256 signatures
 *
 * Auth flow:
 *  1. Echo calls POST /broadcasting/auth with socket_id + channel_name
 *  2. Server signs with `signAuth()` and returns `{auth: "key:sig"}`
 *  3. Echo includes `auth` in the pusher:subscribe message
 *  4. Manager verifies HMAC before allowing subscription
 *
 * @example
 * // config/broadcasting.ts
 * BroadcastConfig({
 *   driver: 'pusher',
 *   pusher: {
 *     appKey:    Bun.env.PUSHER_APP_KEY!,
 *     appSecret: Bun.env.PUSHER_APP_SECRET!,
 *   },
 * });
 */
export class PusherCompatManager extends BroadcastManager {
  private _presenceResolver: PusherPresenceResolver | undefined;

  constructor(
    private readonly _appKey: string,
    private readonly _appSecret: string,
  ) {
    super();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Register a callback that resolves presence-channel member data for the
   * HTTP auth endpoint. Return `false` to deny the subscription.
   *
   * @example
   * pusher.resolvePresenceWith(async (req, _channel) => {
   *   const userId = await getUserIdFromSession(req);
   *   if (!userId) return false;
   *   return { id: userId, info: { name: await getUserName(userId) } };
   * });
   */
  resolvePresenceWith(fn: PusherPresenceResolver): void {
    this._presenceResolver = fn;
  }

  /**
   * Generate a Pusher auth token for a given socket/channel pair.
   * Called by the HTTP auth endpoint before returning the token to the client.
   *
   * For private channels: `signAuth(socketId, channel)`
   * For presence channels: `signAuth(socketId, channel, channelData)`
   * where `channelData = JSON.stringify({ user_id, user_info })`
   */
  signAuth(socketId: string, channel: string, channelData?: string): string {
    const str = channelData ? `${socketId}:${channel}:${channelData}` : `${socketId}:${channel}`;
    const sig = hmacHex(str, this._appSecret);
    return `${this._appKey}:${sig}`;
  }

  /**
   * Resolve presence member data for the HTTP auth endpoint.
   * Returns `false` when no resolver is registered or the resolver denies.
   */
  async resolvePresence(
    req: Request,
    channel: string,
  ): Promise<{ id: string | number; info?: Record<string, unknown> } | false> {
    if (!this._presenceResolver) return false;
    return this._presenceResolver(req, channel);
  }

  // ── WS lifecycle ──────────────────────────────────────────────────────────

  override handleOpen(ws: WS): void {
    this._conns.set(ws.data.id, ws);
    ws.send(
      JSON.stringify({
        event: "pusher:connection_established",
        data: JSON.stringify({ socket_id: ws.data.id, activity_timeout: 120 }),
      }),
    );
  }

  override async handleMessage(ws: WS, raw: string | Uint8Array): Promise<void> {
    let msg: PusherClientMessage;
    try {
      msg = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw),
      ) as PusherClientMessage;
    } catch {
      ws.send(
        JSON.stringify({
          event: "pusher:error",
          data: JSON.stringify({ message: "Invalid JSON.", code: 4001 }),
        }),
      );
      return;
    }

    switch (msg.event) {
      case "pusher:subscribe": {
        const data = (msg.data ?? {}) as PusherSubscribeData;
        await this._pusherSubscribe(ws, data);
        break;
      }
      case "pusher:unsubscribe": {
        const channel = ((msg.data ?? {}) as PusherSubscribeData).channel;
        if (channel) this._subs.get(channel)?.delete(ws.data.id);
        break;
      }
      case "pusher:ping":
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        break;
      default:
        // Forward client-* events to other channel subscribers
        if (typeof msg.event === "string" && msg.event.startsWith("client-") && msg.channel) {
          this._forwardClientEvent(ws, msg);
        }
    }
  }

  override handleClose(ws: WS): void {
    this._conns.delete(ws.data.id);

    for (const [ch, ids] of this._subs) {
      ids.delete(ws.data.id);
      if (ids.size === 0) this._subs.delete(ch);
    }

    for (const [ch, members] of this._members) {
      if (members.has(ws.data.id)) {
        const member = members.get(ws.data.id)!;
        members.delete(ws.data.id);
        if (members.size === 0) this._members.delete(ch);
        this.to(ch, "pusher_internal:member_removed", { user_id: String(member.id) });
      }
    }
  }

  // ── Broadcast API ─────────────────────────────────────────────────────────

  /**
   * Broadcast an event to all subscribers.
   * Pusher format: `data` is always a JSON string, not an object.
   */
  override to(
    channel: string,
    eventName: string,
    data: unknown = {},
    opts?: { exceptSocketId?: string },
  ): void {
    const ids = this._subs.get(channel);
    if (!ids || ids.size === 0) return;
    const msg = JSON.stringify({ event: eventName, channel, data: JSON.stringify(data) });
    for (const id of ids) {
      // `toOthers()` excludes the originating connection. Declaring three parameters and
      // dropping the fourth made the exclusion vanish here without a type error.
      if (opts?.exceptSocketId && id === opts.exceptSocketId) continue;
      this._conns.get(id)?.send(msg);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _verifyAuth(
    socketId: string,
    channel: string,
    auth: string,
    channelData?: string,
  ): boolean {
    return safeEqual(auth, this.signAuth(socketId, channel, channelData));
  }

  private async _pusherSubscribe(ws: WS, data: PusherSubscribeData): Promise<void> {
    const { channel, auth, channel_data } = data;

    // Reject structurally invalid channel names before anything is signed or verified.
    //
    // signAuth() keeps Pusher's `socketId:channel:channelData` wire format for protocol
    // compatibility, so a channel name containing `:` could otherwise be crafted to shift the
    // field boundaries — signAuth(s, 'presence-chat.5:{"user_id":1}') produces the same bytes
    // as signAuth(s, 'presence-chat.5', '{"user_id":1}'), letting an attacker obtain a token
    // for a channel they may join and replay it as another member's presence identity.
    // _isValidChannel excludes `:` for exactly this reason. It also rejects non-strings and
    // over-long names, which previously threw out of the handler.
    if (!_isValidChannel(channel)) {
      ws.send(
        JSON.stringify({
          event: "pusher:error",
          data: JSON.stringify({ message: "Invalid channel name.", code: 4009 }),
        }),
      );
      return;
    }

    const isPresence = channel.startsWith("presence-");
    const isPrivate = channel.startsWith("private-") || isPresence;

    if (isPrivate) {
      if (!auth || !this._verifyAuth(ws.data.id, channel, auth, channel_data)) {
        ws.send(
          JSON.stringify({
            event: "pusher:error",
            data: JSON.stringify({ message: "Unauthorized.", code: 4009 }),
          }),
        );
        return;
      }
    }

    if (isPresence) {
      let memberData: { user_id?: string | number; user_info?: Record<string, unknown> } = {};
      try {
        if (channel_data) {
          memberData = JSON.parse(channel_data) as typeof memberData;
        }
      } catch {
        /* use defaults */
      }

      const member: PresenceMember = {
        id: memberData.user_id ?? ws.data.id,
        info: memberData.user_info ?? {},
      };

      if (!this._members.has(channel)) this._members.set(channel, new Map());
      if (!this._subs.has(channel)) this._subs.set(channel, new Set());

      // Notify existing subscribers BEFORE adding the new one (no self-notify)
      this.to(channel, "pusher_internal:member_added", {
        user_id: String(member.id),
        user_info: member.info,
      });

      this._members.get(channel)!.set(ws.data.id, member);
      this._subs.get(channel)!.add(ws.data.id);

      const allMembers = [...this._members.get(channel)!.values()];
      const presenceData = {
        presence: {
          count: allMembers.length,
          ids: allMembers.map((m) => String(m.id)),
          hash: Object.fromEntries(allMembers.map((m) => [String(m.id), m.info])),
        },
      };

      ws.send(
        JSON.stringify({
          event: "pusher_internal:subscription_succeeded",
          data: JSON.stringify(presenceData),
          channel,
        }),
      );
      return;
    }

    if (!this._subs.has(channel)) this._subs.set(channel, new Set());
    this._subs.get(channel)!.add(ws.data.id);
    ws.send(
      JSON.stringify({
        event: "pusher_internal:subscription_succeeded",
        data: "{}",
        channel,
      }),
    );
  }

  private _forwardClientEvent(ws: WS, msg: PusherClientMessage): void {
    const channel = msg.channel!;

    // Pusher permits client events only on private/presence channels, and only from a
    // connection that is actually subscribed to the channel. This checked neither: it verified
    // the `client-` event-name prefix and nothing else, so any socket — never subscribed, never
    // authenticated — could inject a frame into `private-admin` and every real subscriber
    // received it as though it came from a peer.
    if (!channel.startsWith("private-") && !channel.startsWith("presence-")) return;

    const ids = this._subs.get(channel);
    if (!ids) return;
    if (!ids.has(ws.data.id)) return; // sender is not a member of this channel

    const out = JSON.stringify({ event: msg.event, channel, data: msg.data });
    for (const id of ids) {
      if (id !== ws.data.id) this._conns.get(id)?.send(out);
    }
  }
}
