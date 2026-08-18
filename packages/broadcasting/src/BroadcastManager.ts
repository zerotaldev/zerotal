import type { ServerWebSocket } from "bun";
import { safeEqual, hmacHex } from "@zerotal/core";
import { isPrivateChannel } from "./Channel.ts";
import type { BroadcastEvent, WsConnectionData, ClientMessage, ChannelAuthFn } from "./types.ts";
import { frameworkLog } from "@zerotal/core/logger";

type WS = ServerWebSocket<WsConnectionData>;

/**
 * Core broadcast manager.
 *
 * - Tracks all open WebSocket connections.
 * - Manages per-channel subscription sets.
 * - Dispatches broadcast events to subscribers.
 * - Authenticates private/presence channel subscriptions via a registered callback.
 *
 * Wire into the application via BroadcastProvider, which calls
 * `app.withWebSocket(manager.wsHandlers)` before the server starts.
 */
export interface PresenceMember {
  id: string | number;
  info: Record<string, unknown>;
}

/** Callback that returns member data for a presence channel subscription. */
export type PresenceAuthFn = (
  channel: string,
  ws: ServerWebSocket<WsConnectionData>,
) => Promise<PresenceMember | false> | PresenceMember | false;

export class BroadcastManager {
  /** connectionId → live WebSocket */
  protected _conns = new Map<string, WS>();
  /** channelName → Set<connectionId> */
  protected _subs = new Map<string, Set<string>>();
  /** presence channelName → Map<connectionId, PresenceMember> */
  protected _members = new Map<string, Map<string, PresenceMember>>();
  /** Auth callback for private/presence channels */
  private _authFn: ChannelAuthFn | undefined = undefined;
  /** Presence auth callback (returns member data or false) */
  private _presenceFn: PresenceAuthFn | undefined = undefined;
  /** Secret for per-subscription HMAC signatures (the app's APP_KEY). */
  protected _authSecret: string | undefined = undefined;

  // ── Per-subscription signatures (Pusher-style) ─────────────────────────────

  /**
   * Set the secret used to sign/verify per-subscription auth tokens. Wired from the app's
   * `APP_KEY` by `BroadcastProvider`. Without it the signed-auth path is disabled and the
   * server falls back to the connection-level authorize callbacks.
   */
  setAuthSecret(secret: string): void {
    this._authSecret = secret;
  }

  /**
   * Sign a `socket_id` / `channel` pair (and, for presence, its `channelData`) — the token
   * `POST /broadcasting/auth` hands back to the client, which echoes it in `subscribe`.
   */
  signAuth(socketId: string, channel: string, channelData?: string): string {
    // Sign an unambiguous encoding, not a `:`-joined string.
    //
    // The previous form was `${socketId}:${channel}:${channelData}` with an unescaped separator,
    // while the channel pattern compiler maps `[param]` to `([^.]+)` — which matches `:` and
    // `{`. That made signAuth(s, 'presence-chat.5:{"user_id":1}') produce a byte-identical
    // payload to signAuth(s, 'presence-chat.5', '{"user_id":1}'), so an attacker could request
    // a token for a crafted channel name and replay it as another member's presence identity.
    // JSON.stringify of a fixed-arity array is injective: the delimiters cannot be forged from
    // within a field because they are escaped inside it.
    const str = JSON.stringify([socketId, channel, channelData ?? null]);
    return hmacHex(str, this._authSecret ?? "");
  }

  /** Constant-time check that `auth` is a valid signature for this socket/channel(/data). */
  verifyAuth(socketId: string, channel: string, auth: string, channelData?: string): boolean {
    if (!this._authSecret) return false; // no secret → cannot trust signatures
    return safeEqual(auth, this.signAuth(socketId, channel, channelData));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Register an authorization callback for private/presence channels.
   * Return `true` to allow subscription, `false` to deny.
   *
   * @example
   * broadcast.authorizeWith(async (channel, ws) => {
   *   if (!ws.data.userId) return false;
   *   if (channel.startsWith('private-orders.')) {
   *     const id = channel.split('.')[1];
   *     return await Order.findOwner(id) === ws.data.userId;
   *   }
   *   return true;
   * });
   */
  authorizeWith(fn: ChannelAuthFn): void {
    this._authFn = fn;
  }

  /**
   * Register a presence channel auth callback.
   * Return a `PresenceMember` object to grant access and track the member,
   * or `false` to deny.
   *
   * @example
   * manager.authorizePresenceWith(async (channel, ws) => {
   *   const user = await User.find(ws.data.userId);
   *   if (!user) return false;
   *   return { id: user.id, info: { name: user.name, avatar: user.avatar } };
   * });
   */
  authorizePresenceWith(fn: PresenceAuthFn): void {
    this._presenceFn = fn;
  }

  /**
   * Return all members currently subscribed to a presence channel.
   *
   * @example
   * const members = manager.getMembers('presence-chat.room');
   * // [{ id: 1, info: { name: 'Alice' } }, ...]
   */
  getMembers(channel: string): PresenceMember[] {
    return [...(this._members.get(channel)?.values() ?? [])];
  }

  // ── WS lifecycle ──────────────────────────────────────────────────────────

  handleOpen(ws: WS): void {
    this._conns.set(ws.data.id, ws);
    ws.send(JSON.stringify({ event: "connected", data: { socketId: ws.data.id } }));
  }

  async handleMessage(ws: WS, raw: string | Uint8Array): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw),
      ) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ event: "error", message: "Invalid JSON." }));
      return;
    }

    switch (msg.event) {
      case "subscribe":
        // `channel` is client input and reaches String.prototype methods immediately.
        // An omitted or non-string value used to throw a TypeError out of the handler.
        if (!_isValidChannel(msg.channel)) {
          ws.send(JSON.stringify({ event: "error", message: "Invalid channel." }));
          return;
        }
        await this._subscribe(ws, msg.channel, msg.auth, msg.channelData);
        break;
      case "unsubscribe":
        if (!_isValidChannel(msg.channel)) return;
        this._unsubscribe(ws, msg.channel);
        break;
      case "ping":
        ws.send(JSON.stringify({ event: "pong" }));
        break;
      default:
        ws.send(JSON.stringify({ event: "error", message: "Unknown event." }));
    }
  }

  handleClose(ws: WS): void {
    this._conns.delete(ws.data.id);
    for (const [ch, ids] of this._subs) {
      ids.delete(ws.data.id);
      if (ids.size === 0) this._subs.delete(ch);
    }
    // Remove from presence member maps and notify channel
    for (const [ch, members] of this._members) {
      if (members.has(ws.data.id)) {
        const member = members.get(ws.data.id)!;
        members.delete(ws.data.id);
        if (members.size === 0) this._members.delete(ch);
        // Notify remaining members
        this.to(ch, "presence:member_removed", { member, channel: ch });
      }
    }
  }

  // ── Broadcast API ─────────────────────────────────────────────────────────

  /**
   * Broadcast a raw event to all subscribers of `channel`.
   *
   * @example
   * broadcast.to('posts', 'PostCreated', { id: 99 });
   */
  to(
    channel: string,
    eventName: string,
    data: unknown = {},
    opts?: { exceptSocketId?: string },
  ): void {
    const ids = this._subs.get(channel);
    if (!ids || ids.size === 0) return;
    const msg = JSON.stringify({ event: eventName, channel, data });
    for (const id of ids) {
      // `toOthers()` excludes the originating connection (its socket id == connection id).
      if (opts?.exceptSocketId && id === opts.exceptSocketId) continue;
      this._conns.get(id)?.send(msg);
    }
  }

  /**
   * Dispatch a BroadcastEvent to all its declared channels.
   *
   * @example
   * broadcast.send(new PostUpdated(post));
   */
  send(event: BroadcastEvent, opts?: { exceptSocketId?: string }): void {
    const channels = [event.broadcastOn()].flat();
    const name = event.broadcastAs?.() ?? event.constructor.name;
    const data = event.broadcastWith?.() ?? {};
    for (const ch of channels) {
      this.to(ch, name, data, opts);
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /** Returns the list of channels a connection is subscribed to. */
  subscriptionsFor(connectionId: string): string[] {
    const result: string[] = [];
    for (const [ch, ids] of this._subs) {
      if (ids.has(connectionId)) result.push(ch);
    }
    return result;
  }

  /** Returns the number of subscribers on a channel. */
  subscriberCount(channel: string): number {
    return this._subs.get(channel)?.size ?? 0;
  }

  /** Total open connections. */
  connectionCount(): number {
    return this._conns.size;
  }

  // ── Bun.serve() handler config ────────────────────────────────────────────

  get wsHandlers() {
    return {
      open: (ws: WS) => this.handleOpen(ws),
      // The rejection handler is not optional. Bun's ws.message callback is sync, so an
      // unhandled rejection from handleMessage() propagates to the process — and there is no
      // process-level unhandledRejection guard anywhere in the framework. A single malformed
      // frame (or a throwing app-supplied authorizeWith callback) took the server down.
      message: (ws: WS, msg: string | Uint8Array) =>
        void this.handleMessage(ws, msg).catch((error: unknown) => {
          this._onHandlerError(ws, error);
        }),
      close: (ws: WS) => this.handleClose(ws),
    };
  }

  /**
   * Last-resort handler for a rejection escaping {@link handleMessage}.
   *
   * Logs and, where possible, tells the offending client. Never rethrows: the whole point is
   * that one client's bad frame must not terminate the process serving everyone else.
   */
  protected _onHandlerError(ws: WS, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    frameworkLog("broadcast").error(`Message handler failed: ${message}`);
    try {
      ws.send(JSON.stringify({ event: "error", message: "Message could not be processed." }));
    } catch {
      // The socket may already be closed — nothing useful left to do.
    }
  }

  /** Factory for `upgradeData` passed to `app.withWebSocket()`. */
  upgradeData(req: Request): Record<string, unknown> {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    return { token };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _subscribe(
    ws: WS,
    channel: string,
    auth?: string,
    channelData?: string,
  ): Promise<void> {
    const isPresence = channel.startsWith("presence-");
    // Block body, not an expression body: `ServerWebSocket.send` returns a send
    // status, and `return deny()` in a `Promise<void>` method would otherwise
    // try to return that number. The status is not useful here — a client that
    // failed to receive its own denial is already gone.
    const deny = (): void => {
      ws.send(JSON.stringify({ event: "subscription_error", channel, message: "Unauthorized" }));
    };

    if (isPresence) {
      // Two ways to authorize a presence subscription:
      //   • Signed (Pusher-style): a per-subscription `auth` token covering `channelData`.
      //     We verify the HMAC and take the member straight from the signed `channelData`.
      //   • Connection-level: the registered presence/auth callback reads `ws.data`.
      let member: PresenceMember;
      if (auth !== undefined) {
        if (!this.verifyAuth(ws.data.id, channel, auth, channelData)) return deny();
        member = _parseSignedMember(channelData, ws.data.id);
      } else {
        const authFn = this._presenceFn ?? this._authFn;
        if (!authFn) return deny();
        const result = await authFn(channel, ws);
        if (!result) return deny();
        member =
          result === true
            ? ({ id: ws.data.id, info: {} } as PresenceMember)
            : (result as PresenceMember);
      }

      if (!this._members.has(channel)) this._members.set(channel, new Map());
      if (!this._subs.has(channel)) this._subs.set(channel, new Set());
      this._members.get(channel)!.set(ws.data.id, member);

      // Notify EXISTING subscribers before adding the new one (so they don't self-notify)
      this.to(channel, "presence:member_added", { member, channel });

      // Now add the new subscriber to the channel
      this._subs.get(channel)!.add(ws.data.id);

      // Tell the new subscriber who's already here (full member list after their join)
      ws.send(
        JSON.stringify({
          event: "subscription_succeeded",
          channel,
          data: { members: this.getMembers(channel) },
        }),
      );
      return;
    }

    if (isPrivateChannel(channel)) {
      // Signed token if provided, else the connection-level authorize callback.
      const authorized =
        auth !== undefined
          ? this.verifyAuth(ws.data.id, channel, auth)
          : this._authFn
            ? await this._authFn(channel, ws)
            : false;
      if (!authorized) return deny();
    }

    if (!this._subs.has(channel)) this._subs.set(channel, new Set());
    this._subs.get(channel)!.add(ws.data.id);
    ws.send(JSON.stringify({ event: "subscription_succeeded", channel }));
  }

  private _unsubscribe(ws: WS, channel: string): void {
    this._subs.get(channel)?.delete(ws.data.id);
    // Presence: an explicit leave (e.g. Socket.leave on a component teardown / SPA navigation) must
    // remove the member and notify the remaining subscribers — the same cleanup a full disconnect
    // does in handleClose. Without this, a member who navigated away lingers in others' "who's here"
    // until they close the tab.
    const members = this._members.get(channel);
    const member = members?.get(ws.data.id);
    if (members && member) {
      members.delete(ws.data.id);
      if (members.size === 0) this._members.delete(channel);
      this.to(channel, "presence:member_removed", { member, channel });
    }
    ws.send(JSON.stringify({ event: "unsubscribed", channel }));
  }
}

/** Parse the signed presence `channelData` (`{ id, info }`) into a member, with fallbacks. */
function _parseSignedMember(channelData: string | undefined, fallbackId: string): PresenceMember {
  if (!channelData) return { id: fallbackId, info: {} };
  try {
    const parsed = JSON.parse(channelData) as {
      id?: string | number;
      info?: Record<string, unknown>;
    };
    return { id: parsed.id ?? fallbackId, info: parsed.info ?? {} };
  } catch {
    return { id: fallbackId, info: {} };
  }
}

/**
 * Longest channel name accepted from a client. Channel names are used as Map keys and echoed
 * into outbound frames, so an unbounded value is both a memory and an amplification vector.
 */
const _MAX_CHANNEL_LENGTH = 256;

/**
 * Whether a client-supplied channel name is structurally acceptable.
 *
 * The character set deliberately excludes `:`, which is the field separator used when signing
 * presence auth payloads — without that exclusion a crafted channel name could be split across
 * the separator to forge another member's identity.
 */
export function _isValidChannel(channel: unknown): channel is string {
  return (
    typeof channel === "string" &&
    channel.length > 0 &&
    channel.length <= _MAX_CHANNEL_LENGTH &&
    /^[A-Za-z0-9_\-=@,.;]+$/.test(channel)
  );
}
