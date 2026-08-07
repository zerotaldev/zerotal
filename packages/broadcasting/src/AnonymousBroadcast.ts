import { Broadcast } from "./facades/Broadcast.ts";
import { currentSocketId } from "./currentSocketId.ts";

/**
 * Fluent builder for broadcasting without a dedicated event class. Returned by
 * `Broadcast.on()` / `Broadcast.private()` / `Broadcast.presence()`.
 *
 * @example
 * Broadcast.on(`orders.${order.id}`).as("OrderPlaced").with(order).toOthers().send();
 * Broadcast.private(`orders.${order.id}`).as("OrderPlaced").with({ id: order.id }).send();
 */
export class AnonymousBroadcast {
  private _event = "AnonymousEvent";
  private _data: unknown = {};
  private _toOthers = false;

  constructor(private readonly channel: string) {}

  /** Set the wire event name (default `"AnonymousEvent"`). */
  as(event: string): this {
    this._event = event;
    return this;
  }

  /** Set the payload. */
  with(data: unknown): this {
    this._data = data;
    return this;
  }

  /** Exclude the originating connection (its `X-Socket-ID`). */
  toOthers(): this {
    this._toOthers = true;
    return this;
  }

  /** Broadcast now. (`sendNow()` is an alias; queued sending lands with the broadcast queue.) */
  send(): void {
    const exceptSocketId = this._toOthers ? currentSocketId() : undefined;
    Broadcast.to(
      this.channel,
      this._event,
      this._data,
      exceptSocketId ? { exceptSocketId } : undefined,
    );
  }

  /** Broadcast immediately. */
  sendNow(): void {
    this.send();
  }
}
