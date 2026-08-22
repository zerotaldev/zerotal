---
title: Broadcasting Events
description: Write a broadcast event, dispatch it, and broadcast model changes automatically.
---

# Writing broadcast events

You only have to implement `broadcastOn()`; the rest default sensibly.

```ts fragment
// app/events/OrderShipmentStatusUpdated.ts
import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";
import type { Order } from "../models/Order.ts";

export class OrderShipmentStatusUpdated extends BroadcastingEvent {
  constructor(public readonly order: Order) {
    super();
  }

  broadcastOn() {
    return privateChannel(`orders.${this.order.id}`);
  }

  // Optional — all default sensibly:
  broadcastAs() {
    return "OrderShipmentStatusUpdated"; // default: the class name
  }
  broadcastWith() {
    return { id: this.order.id, status: this.order.status }; // default: the event's own props
  }
  broadcastWhen() {
    return this.order.total > 100; // default: true
  }
}
```

| Method            | Required | Default               | Description                                     |
| ----------------- | -------- | --------------------- | ----------------------------------------------- |
| `broadcastOn()`   | Yes      | —                     | Channel name(s). Use the channel helpers.       |
| `broadcastAs()`   | No       | the class name        | The wire event name clients listen for.         |
| `broadcastWith()` | No       | the event's own props | The payload object.                             |
| `broadcastWhen()` | No       | `true`                | Gate — broadcast only when this returns `true`. |

> **Note** — The lower-level `BroadcastEvent` _interface_ (`broadcastOn`/`broadcastAs?`/`broadcastWith?`)
> is also exported if you'd rather implement it structurally; `BroadcastingEvent` implements it.

## Dispatching events

Three ways to broadcast, in order of ergonomics:

```ts fragment
// in a controller
import { broadcast, Broadcast } from "@zerotal/broadcasting";

// 1. Static dispatch — constructs the event, runs any app-event listeners, AND broadcasts:
OrderShipmentStatusUpdated.dispatch(order);

// 2. The broadcast() helper — fluent, for excluding the current socket:
broadcast(new OrderShipmentStatusUpdated(order)).toOthers();
await broadcast(new OrderShipmentStatusUpdated(order)); // awaitable; sends automatically

// 3. The Broadcast facade — explicit send:
Broadcast.send(new OrderShipmentStatusUpdated(order));
```

`broadcast(event).toOthers()` excludes the connection that triggered the request (read from the
`X-Socket-ID` header your Socket client sends), so the user who just made an optimistic UI update
doesn't receive a duplicate.

`broadcast()` returns a `PendingBroadcast` — a thenable that sends itself on the next
microtask, or immediately when awaited. That is what lets `.toOthers()` configure it
first without you having to remember a `.send()`: both lines above deliver, one
fire-and-forget and one awaited. Hold the value only if you want to configure it across
several statements; otherwise treat `broadcast(...)` as the whole call.

A broadcastable event emitted on the [event bus](/docs/events) is broadcast automatically:

```ts fragment
// in a controller
import { Events } from "zerotal";

Events.emit(new OrderShipmentStatusUpdated(order)); // runs listeners AND broadcasts
```

Broadcast to multiple channels by returning an array from `broadcastOn()`:

```ts fragment
// in an event's broadcastOn()
broadcastOn() {
  return [privateChannel(`orders.${this.order.id}`), privateChannel(`users.${this.order.userId}`)];
}
```

### Anonymous broadcasts

When a full event class is overkill, broadcast inline:

```ts fragment
// in a controller
Broadcast.on(`orders.${order.id}`).as("OrderPlaced").with(order).toOthers().send();
Broadcast.private(`orders.${order.id}`).as("OrderPlaced").with({ id: order.id }).send();
Broadcast.presence(`chat.${room.id}`).with({ userId: user.id }).send();

// Or the lowest-level form — push a raw event straight to a channel:
Broadcast.to("posts", "PostViewed", { id: post.id, viewedAt: Date.now() });
```

### Reading presence members

Get the members currently subscribed to a presence channel (real driver only —
returns `[]` under the fake/null driver):

```ts fragment
// in a controller
const members = Broadcast.getMembers("presence-chat.room1");
// → [{ id, info }, …]
```

## Broadcasting model changes

Broadcast a model's lifecycle changes by mapping them to a `BroadcastingEvent` through the ORM's
`dispatchesEvents`. When the model fires the event on the [event bus](/docs/events), it is
broadcast automatically (see [dispatching](#dispatching-events)) — no manual broadcast call.

```ts fragment
// app/events/PostCreated.ts
import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";
import type { Post } from "../models/Post.ts";

export class PostCreated extends BroadcastingEvent {
  constructor(public readonly post: Post) {
    super();
  }
  broadcastOn() {
    return privateChannel(`posts.${this.post.id}`);
  }
  broadcastWith() {
    return { id: this.post.id, title: this.post.title };
  }
}
```

```ts fragment
// app/models/Post.ts
@table("posts")
export class Post extends Model {
  static dispatchesEvents = { created: PostCreated, updated: PostUpdated };
}
```

Now `await Post.create({ … })` fires `PostCreated`, which broadcasts to `private-posts.[id]`.
See [ORM Lifecycle & Events](/docs/orm/lifecycle).

### Shortcut: broadcastsModelEvents

When you only need to broadcast the change (no custom event class), `broadcastsModelEvents()`
wires `created`/`updated`/`deleted` for you. It generates the `BroadcastingEvent`s and populates
`dispatchesEvents` — the same bridge, less boilerplate. Call it once, below the model:

```ts
// app/models/Order.ts
import { Model, column, table } from "@zerotal/orm";
import { broadcastsModelEvents, privateChannel } from "@zerotal/broadcasting";

@table("orders")
export class Order extends Model {
  @column() id!: number;
  @column() status!: string;
}

broadcastsModelEvents(Order, {
  channels: (order) => privateChannel(`orders.${order.id}`),
  // events: ["created", "updated", "deleted"],   // default
  // as: (modelName, event) => `${modelName}${event}`,  // wire name; default "OrderUpdated"
  // with: (order) => ({ id: order.id, status: order.status }), // payload; default { order }
});
```

The wire event name defaults to `${ModelName}${Event}` (e.g. `OrderUpdated`) and the payload to
`{ order }` (the model under its camel-cased name). On the client:

```ts fragment
// in your client code
Socket.private(`orders.${id}`).listen("OrderUpdated", (e) => render(e.order));
```

## Next steps

- [Broadcasting overview](/docs/broadcasting) — the guide's front page and the rest of the sections.
- [Reference](/docs/broadcasting/references) — the full API surface in one table.
