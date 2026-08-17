import type { ServerWebSocket } from "bun";

// ── BroadcastEvent ────────────────────────────────────────────────────────────

/**
 * Implement this interface on any event class to make it broadcastable.
 *
 * @example
 * export class PostUpdated implements BroadcastEvent {
 *   constructor(private post: Post) {}
 *
 *   broadcastOn() { return channel('posts'); }
 *   broadcastAs() { return 'PostUpdated'; }
 *   broadcastWith() { return { id: this.post.id, title: this.post.title }; }
 * }
 *
 * // Dispatch
 * Broadcast.send(new PostUpdated(post));
 */
export interface BroadcastEvent {
  /** Channel name(s) to broadcast on. Use channel(), privateChannel(), or presenceChannel(). */
  broadcastOn(): string | string[];
  /** Optional — defaults to the class constructor name. */
  broadcastAs?(): string;
  /** Data to include in the broadcast payload. Defaults to `{}`. */
  broadcastWith?(): object;
}

// ── WebSocket data attached to each connection ────────────────────────────────

export interface WsConnectionData {
  /** Unique connection ID assigned on upgrade. */
  id: string;
  /** User ID if the connection was authenticated during upgrade. */
  userId?: string | number;
  /** Raw auth token from the upgrade request (for lazy auth). */
  token?: string;
}

// ── Protocol messages ─────────────────────────────────────────────────────────

export interface SubscribeMessage {
  event: "subscribe";
  channel: string;
  /**
   * Per-subscription HMAC signature for private/presence channels (Pusher-style), obtained
   * from `POST /broadcasting/auth`. When present, the server verifies it instead of running
   * the connection-level authorize callback.
   */
  auth?: string;
  /**
   * Signed presence member data (a JSON string) returned alongside `auth` by the auth
   * endpoint. Its exact bytes are covered by `auth`, so the server trusts it as the member.
   */
  channelData?: string;
}

export interface UnsubscribeMessage {
  event: "unsubscribe";
  channel: string;
}

export interface PingMessage {
  event: "ping";
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

export interface ServerMessage {
  event: string;
  channel?: string;
  data?: unknown;
  message?: string;
}

// ── Channel auth callback ─────────────────────────────────────────────────────

export type ChannelAuthFn = (
  channel: string,
  ws: ServerWebSocket<WsConnectionData>,
) => boolean | Promise<boolean>;
