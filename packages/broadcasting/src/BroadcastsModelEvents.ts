import { Str } from "@zerotal/core";
import { BroadcastingEvent } from "./BroadcastingEvent.ts";

/** The model lifecycle events that can be auto-broadcast. */
export type ModelBroadcastEventName = "created" | "updated" | "deleted";

export interface BroadcastsModelEventsOptions<M> {
  /** Which lifecycle events to broadcast. Default: `created`, `updated`, `deleted`. */
  events?: ModelBroadcastEventName[];
  /** The channel(s) to broadcast on for a given model instance + event. */
  channels: (model: M, event: ModelBroadcastEventName) => string | string[];
  /** The wire event name. Default: `${ModelName}${Event}`, e.g. `OrderUpdated`. */
  as?: (modelName: string, event: ModelBroadcastEventName) => string;
  /** The wire payload. Default: `{ [camelModelName]: model }`, e.g. `{ order }`. */
  with?: (model: M, event: ModelBroadcastEventName) => object;
}

/** Minimal shape of an ORM model class with the `dispatchesEvents` bridge. */
type ModelClassWithEvents<M> = (new (...args: never[]) => M) & {
  name: string;
  dispatchesEvents?: Record<string, new (model: unknown) => object>;
};

/**
 * Auto-broadcast a model's lifecycle events.
 *
 * It populates the model's `dispatchesEvents` map with generated `BroadcastingEvent` subclasses,
 * reusing the existing model-event bridge: when the model is created/updated/deleted, the event
 * is fired on the application `Events` bus (so listeners run) and broadcast (so connected clients
 * receive it). Call it once — at the bottom of the model file or in a provider's boot.
 *
 * @example
 * // app/models/Order.ts
 * import { BaseModel, column, table } from "@zerotal/orm";
 * import { broadcastsModelEvents, privateChannel } from "@zerotal/broadcasting";
 *
 * @table("orders")
 * export class Order extends BaseModel {
 *   @column() id!: number;
 *   @column() status!: string;
 * }
 *
 * broadcastsModelEvents(Order, {
 *   channels: (order) => privateChannel(`orders.${order.id}`),
 *   // optional: with: (order) => ({ id: order.id, status: order.status }),
 * });
 *
 * // Client: Socket.private(`orders.${id}`).listen("OrderUpdated", (e) => ...)
 */
export function broadcastsModelEvents<M extends object>(
  ModelClass: ModelClassWithEvents<M>,
  options: BroadcastsModelEventsOptions<M>,
): void {
  const events = options.events ?? ["created", "updated", "deleted"];
  const modelName = ModelClass.name;
  const modelKey = Str.camelCase(modelName);
  const channelsFn = options.channels;
  const withFn = options.with;
  const asFn = options.as;

  const map: Record<string, new (model: unknown) => object> = {
    ...(ModelClass.dispatchesEvents ?? {}),
  };

  for (const event of events) {
    const wireName = asFn ? asFn(modelName, event) : `${modelName}${capitalize(event)}`;

    class ModelBroadcast extends BroadcastingEvent {
      readonly model: M;
      constructor(model: M) {
        super();
        this.model = model;
      }
      broadcastOn(): string | string[] {
        return channelsFn(this.model, event);
      }
      broadcastAs(): string {
        return wireName;
      }
      broadcastWith(): object {
        return withFn ? withFn(this.model, event) : { [modelKey]: this.model };
      }
    }

    map[event] = ModelBroadcast as unknown as new (model: unknown) => object;
  }

  ModelClass.dispatchesEvents = map;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
