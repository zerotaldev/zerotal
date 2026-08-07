# @zerotal/broadcasting

> Real-time WebSocket broadcasting with a Pusher-compatible server built into your app process.

Define a `BroadcastingEvent`, dispatch it, and every subscribed client receives the payload over a live WebSocket connection — no separate service required. Supports public, private, and presence channels, a Redis driver for horizontally-scaled deployments, and works unchanged with any Pusher-protocol client.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/broadcasting
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { BroadcastProvider } from "@zerotal/broadcasting";
```

It registers two HTTP endpoints automatically: `GET /app/{appKey}` (WebSocket upgrade) and `POST /broadcasting/auth` (private/presence channel auth).

## Usage

Write a broadcast event — only `broadcastOn()` is required:

```ts
import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";

export class OrderShipmentStatusUpdated extends BroadcastingEvent {
  constructor(public readonly order: Order) {
    super();
  }

  broadcastOn() {
    return privateChannel(`orders.${this.order.id}`);
  }

  broadcastWith() {
    return { id: this.order.id, status: this.order.status };
  }
}
```

Dispatch it — static, fluent, or via the facade:

```ts
import { broadcast, Broadcast } from "@zerotal/broadcasting";

OrderShipmentStatusUpdated.dispatch(order); // construct + dispatch + broadcast
await broadcast(new OrderShipmentStatusUpdated(order)).toOthers(); // exclude current socket
Broadcast.send(new OrderShipmentStatusUpdated(order)); // explicit send
```

Pick a channel type with the helpers, then authorize private/presence channels in `routes/channels.ts`:

```ts
import { channel, privateChannel, presenceChannel } from "@zerotal/broadcasting";

channel("posts"); // public
privateChannel("orders.42"); // private  -> "private-orders.42"
presenceChannel("chat.room1"); // presence -> "presence-chat.room1"
```

```ts
// routes/channels.ts
import { Broadcast } from "@zerotal/broadcasting";

Broadcast.channel("orders.[orderId]", async (user, orderId) => {
  return user.id === (await Order.findOrNew(orderId)).userId; // boolean = private
});

Broadcast.channel("chat.[roomId]", (user, roomId) => {
  return user.canJoin(roomId) ? { id: user.id, name: user.name } : null; // member data = presence
});
```

Testing with the in-memory recorder:

```ts
import { Broadcast } from "@zerotal/broadcasting";

const fake = Broadcast.fake();
await PostController.publish({ http: ctx });
fake.assertBroadcast("PostPublished", "posts", { id: post.id });
Broadcast.resetFake();
```

## Exports

- `BroadcastingEvent` / `broadcastOnce` — base class for broadcastable events.
- `broadcast` / `PendingBroadcast` — fluent dispatch helper (`.toOthers()`, awaitable).
- `Broadcast` — facade (`send`, `to`, `getMembers`, `channel`, `on`/`private`/`presence`, `fake`/`resetFake`).
- Channel helpers: `channel`, `privateChannel`, `presenceChannel`, `isPrivateChannel`.
- `BroadcastManager` — core manager; `TypedBroadcastManager` for compile-time-checked channel maps.
- `PusherCompatManager` — Pusher/Reverb-compatible protocol manager.
- `RedisBroadcastDriver` — Redis Pub/Sub fan-out for multi-instance deployments.
- `broadcastsModelEvents` — wire a model's `created`/`updated`/`deleted` to broadcasts.
- `AnonymousBroadcast` — inline broadcasts without an event class.
- `ChannelRegistry` / `channelRegistry` / `compileChannelPattern` — channel auth rule registry.
- `BroadcastFake` — test double behind `Broadcast.fake()`.
- `BroadcastProvider` — service provider.
- `BroadcastConfig` — config factory.
- Types: `PresenceMember`, `PresenceAuthFn`, `BroadcastChannelMap`, `ChannelParams`, `EventsOf`, `PayloadOf`, `TypedBroadcastEvent`, `BroadcastEvent`, `WsConnectionData`, `ChannelAuthFn`, `RecordedBroadcast`, and more.
- Typed error vocabulary re-exported from `./errors`.

## Documentation

- [Broadcasting](../../docs/broadcasting/index.md)
