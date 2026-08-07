import { Broadcast } from "./facades/Broadcast.ts";
import { currentSocketId } from "./currentSocketId.ts";
import type { BroadcastEvent } from "./types.ts";

/**
 * A deferred broadcast returned by `broadcast(event)`. It is thenable and sends automatically on
 * the next microtask (or immediately when awaited), so `.toOthers()` can configure it first.
 */
export class PendingBroadcast implements PromiseLike<void> {
  private _toOthers = false;
  private _sent = false;

  constructor(private readonly event: BroadcastEvent) {}

  /**
   * Exclude the connection that originated the triggering request (its `X-Socket-ID`), so the
   * user who just made an optimistic update doesn't receive a duplicate.
   */
  toOthers(): this {
    this._toOthers = true;
    return this;
  }

  /** Send now (idempotent). Called automatically on microtask / await. */
  send(): void {
    if (this._sent) return;
    this._sent = true;
    const exceptSocketId = this._toOthers ? currentSocketId() : undefined;
    Broadcast.send(this.event, exceptSocketId ? { exceptSocketId } : {});
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    this.send();
    return Promise.resolve().then(onfulfilled, onrejected);
  }
}

/**
 * Broadcast an event with fluent modifiers. Sends automatically (no `.send()` needed).
 *
 * @example
 * broadcast(new OrderShipmentStatusUpdated(update)).toOthers();
 * await broadcast(new OrderShipmentStatusUpdated(update));
 */
export function broadcast(event: BroadcastEvent): PendingBroadcast {
  const pending = new PendingBroadcast(event);
  // Auto-send after the synchronous chain (so .toOthers() runs first). Awaiting sends sooner.
  queueMicrotask(() => pending.send());
  return pending;
}
