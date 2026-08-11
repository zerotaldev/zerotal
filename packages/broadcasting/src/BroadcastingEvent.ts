import { Events } from "@zerotal/core";
import { Broadcast } from "./facades/Broadcast.ts";
import type { BroadcastEvent } from "./types.ts";

// Tracks events already broadcast, so dispatch() and the Events-bus hook never double-broadcast.
const _broadcasted = new WeakSet<object>();

/**
 * Broadcast an event at most once (idempotent across `dispatch()` and the `Events` auto-broadcast
 * hook), gated by `broadcastWhen()` (default true). Used by both paths; exported for the hook.
 *
 * @internal
 */
export function broadcastOnce(event: BroadcastEvent): void {
  if (_broadcasted.has(event)) return;
  _broadcasted.add(event);
  const when = (event as { broadcastWhen?(): boolean }).broadcastWhen;
  if (typeof when === "function" && when.call(event) === false) return;
  Broadcast.send(event);
}

/**
 * Base class for broadcastable events. Extend it, implement `broadcastOn()`, and you get
 * sensible defaults plus a static `dispatch()` that both fires application listeners and
 * broadcasts the event.
 *
 * @example
 * import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";
 *
 * export class OrderShipmentStatusUpdated extends BroadcastingEvent {
 *   constructor(public readonly order: Order) { super(); }
 *
 *   broadcastOn() { return privateChannel(`orders.${this.order.id}`); }
 *   broadcastWith() { return { id: this.order.id, status: this.order.status }; }
 *   broadcastWhen() { return this.order.total > 100; }
 * }
 *
 * // Construct + dispatch (runs listeners + broadcasts):
 * OrderShipmentStatusUpdated.dispatch(order);
 *
 * // Or broadcast only, excluding the current socket:
 * broadcast(new OrderShipmentStatusUpdated(order)).toOthers();
 */
export abstract class BroadcastingEvent implements BroadcastEvent {
  /** Channel name(s) to broadcast on. Use channel()/privateChannel()/presenceChannel(). */
  abstract broadcastOn(): string | string[];

  /** Wire event name. Defaults to the class name. */
  broadcastAs(): string {
    return this.constructor.name;
  }

  /**
   * Payload to broadcast. Defaults to the event's own enumerable, non-function properties
   * (so constructor-assigned fields are sent automatically). Override for a custom shape.
   */
  broadcastWith(): object {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) {
      if (typeof value !== "function") out[key] = value;
    }
    return out;
  }

  /** Conditional gate — the event broadcasts only when this returns true. Default: true. */
  broadcastWhen(): boolean {
    return true;
  }

  /**
   * Construct the event from the given arguments, fire it on the application event bus (so any
   * registered listeners run), and broadcast it (gated by `broadcastWhen()`).
   *
   * @example OrderShipmentStatusUpdated.dispatch(order);
   */
  static dispatch<T extends BroadcastingEvent, A extends unknown[]>(
    this: new (...args: A) => T,
    ...args: A
  ): T {
    const event = new this(...args);
    // Fire app listeners if an event bus is bound (its hook may broadcast). Broadcasting still
    // works when no bus is bound (e.g. outside a booted app) via the explicit broadcastOnce below.
    try {
      void Events.emit(event as object);
    } catch {
      /* no "events" binding */
    }
    broadcastOnce(event); // no-op if the Events hook already broadcast it
    return event;
  }
}
