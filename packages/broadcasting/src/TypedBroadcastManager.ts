import { BroadcastManager } from "./BroadcastManager.ts";
import { MissingChannelParameterError } from "./errors.ts";
import type { BroadcastEvent } from "./types.ts";

// ── Channel-map type ──────────────────────────────────────────────────────────

/**
 * Shape of a typed broadcast channel map.
 *
 * Keys are channel name patterns (may include `[param]` placeholders).
 * Values are objects mapping event names to their payload types.
 *
 * @example
 * export interface Channels extends BroadcastChannelMap {
 *   'posts': {
 *     PostCreated: { id: number; title: string };
 *     PostDeleted: { id: number };
 *   };
 *   'private-orders.[orderId]': {
 *     OrderShipped: { orderId: number; trackingCode: string };
 *     OrderCancelled: { orderId: number; reason: string };
 *   };
 *   'presence-room.[roomId]': {
 *     MessageSent: { userId: number; text: string };
 *   };
 * }
 *
 * const manager = new TypedBroadcastManager<Channels>();
 *
 * // Static channel — fully typed
 * manager.to('posts', 'PostCreated', { id: 1, title: 'Hello' });
 *
 * // Parameterised channel — pass the pattern + params separately
 * manager.toChannel('private-orders.[orderId]', { orderId: 42 }, 'OrderShipped', {
 *   orderId: 42,
 *   trackingCode: 'UPS-123',
 * });
 */
export type BroadcastChannelMap = Record<string, Record<string, object>>;

// ── Type helpers ──────────────────────────────────────────────────────────────

/** Extract `[param]` names from a channel pattern string. */
export type ChannelParams<Pattern extends string> =
  Pattern extends `${string}[${infer Param}]${infer Tail}` ? Param | ChannelParams<Tail> : never;

/** Build the params record for a channel pattern. `undefined` when there are no params. */
export type ChannelParamRecord<Pattern extends string> = [ChannelParams<Pattern>] extends [never]
  ? undefined
  : { [K in ChannelParams<Pattern>]: string | number };

/** All event names for a given channel pattern in the map. */
export type EventsOf<M extends BroadcastChannelMap, Ch extends keyof M & string> = keyof M[Ch] &
  string;

/** The payload type for a specific event on a channel. */
export type PayloadOf<
  M extends BroadcastChannelMap,
  Ch extends keyof M & string,
  Ev extends EventsOf<M, Ch>,
> = M[Ch][Ev];

/** Channel patterns that have NO `[param]` placeholders. */
export type StaticChannels<M extends BroadcastChannelMap> = {
  [K in keyof M & string]: [ChannelParams<K>] extends [never] ? K : never;
}[keyof M & string];

/** Channel patterns that DO contain `[param]` placeholders. */
export type ParameterizedChannels<M extends BroadcastChannelMap> = {
  [K in keyof M & string]: [ChannelParams<K>] extends [never] ? never : K;
}[keyof M & string];

// ── Typed event interface ─────────────────────────────────────────────────────

/**
 * Implement on an event class to make it a typed broadcast event.
 * The type parameters enforce that the event name and payload match the channel map.
 *
 * @example
 * class PostCreated implements TypedBroadcastEvent<Channels, 'posts', 'PostCreated'> {
 *   constructor(private post: Post) {}
 *
 *   broadcastOn()   { return 'posts' as const; }
 *   broadcastAs()   { return 'PostCreated' as const; }
 *   broadcastWith() { return { id: this.post.id, title: this.post.title }; }
 * }
 */
export interface TypedBroadcastEvent<
  M extends BroadcastChannelMap,
  Ch extends keyof M & string,
  Ev extends EventsOf<M, Ch> = EventsOf<M, Ch>,
> extends BroadcastEvent {
  broadcastOn(): Ch | Ch[];
  broadcastAs(): Ev;
  broadcastWith(): PayloadOf<M, Ch, Ev>;
}

// ── Runtime helper ────────────────────────────────────────────────────────────

function interpolateChannel(pattern: string, params: Record<string, string | number>): string {
  return pattern.replace(/\[(\w+)\]/g, (_, key: string) => {
    const val = params[key];
    if (val === undefined) throw new MissingChannelParameterError(key);
    return String(val);
  });
}

// ── TypedBroadcastManager ─────────────────────────────────────────────────────

/**
 * A `BroadcastManager` variant that enforces payload types against a channel map.
 *
 * All `BroadcastManager` APIs (WebSocket lifecycle, auth, presence) are inherited
 * unchanged. Only `to()` and `toChannel()` gain type constraints.
 *
 * @example
 * const manager = new TypedBroadcastManager<Channels>();
 *
 * // Static channel
 * manager.to('posts', 'PostCreated', { id: 1, title: 'Hello' });
 *
 * // Parameterised channel
 * manager.toChannel('private-orders.[orderId]', { orderId: 42 }, 'OrderShipped', {
 *   orderId: 42, trackingCode: 'UPS-123',
 * });
 */
export class TypedBroadcastManager<Channels extends BroadcastChannelMap> extends BroadcastManager {
  /**
   * Typed broadcast to a static channel (no `[param]` placeholders).
   *
   * TypeScript will enforce that `event` and `data` match the channel map entry.
   * Falls back to the untyped base method for any string channel (e.g. if you
   * need to broadcast on a dynamically constructed name).
   */
  to<Ch extends StaticChannels<Channels>, Ev extends EventsOf<Channels, Ch>>(
    channel: Ch,
    event: Ev,
    data: PayloadOf<Channels, Ch, Ev>,
    opts?: { exceptSocketId?: string },
  ): void;
  /** Untyped fallback — preserves compatibility with the base class signature. */
  to(channel: string, event: string, data?: unknown, opts?: { exceptSocketId?: string }): void;
  to(channel: string, event: string, data: unknown = {}, opts?: { exceptSocketId?: string }): void {
    // `opts` is forwarded, not dropped. Declaring three parameters and omitting the fourth
    // is not a type error on an override, so `toOthers()` silently stopped excluding
    // anything the moment a broadcast went through this class.
    super.to(channel, event, data, opts);
  }

  /**
   * Typed broadcast to a parameterised channel pattern.
   *
   * The pattern is interpolated with `params` at runtime. TypeScript enforces
   * that the pattern key exists in the channel map and that `event` and `data`
   * match its declared event types.
   *
   * @example
   * manager.toChannel('private-orders.[orderId]', { orderId: 42 }, 'OrderShipped', {
   *   orderId: 42, trackingCode: 'UPS-123',
   * });
   */
  toChannel<
    Pattern extends ParameterizedChannels<Channels>,
    Ev extends EventsOf<Channels, Pattern>,
  >(
    pattern: Pattern,
    params: ChannelParamRecord<Pattern>,
    event: Ev,
    data: PayloadOf<Channels, Pattern, Ev>,
  ): void {
    const ch = interpolateChannel(pattern as string, params as Record<string, string | number>);
    super.to(ch, event as string, data);
  }

  /**
   * Dispatch a typed broadcast event.
   *
   * Accepts both `TypedBroadcastEvent` (with map-matched payload types) and the
   * untyped `BroadcastEvent` interface, so this is a drop-in replacement for
   * the base `send()`.
   */
  send(event: TypedBroadcastEvent<Channels, keyof Channels & string> | BroadcastEvent): void {
    super.send(event);
  }
}
