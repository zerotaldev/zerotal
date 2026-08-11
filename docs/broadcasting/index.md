---
title: Broadcasting
description: Push server-side events to subscribed clients in real time over WebSockets, with Pusher-protocol compatibility built in.
---

# Broadcasting

Real-time WebSocket broadcasting with a Pusher-compatible server built into the Zerotal
application process — no separate service required. Define a `BroadcastingEvent`, dispatch it,
and every subscribed client receives the payload over a live WebSocket connection. Any
Pusher-protocol client works unchanged.

## Getting Started

```bash
# in your project root
bun add @zerotal/broadcasting
```

## Register the provider

Add `BroadcastProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { BroadcastProvider } from "@zerotal/broadcasting";

const providers = [
  // …your other providers
  BroadcastProvider,
];

export default providers;
```

Registering the provider switches on the following (only the hooks it actually uses, in
lifecycle order):

- `onRegister` — reads `config/broadcasting.ts`, builds the configured driver's
  `BroadcastManager`, binds it to the container as `broadcast`, wires the auto-broadcast hook so
  any `BroadcastingEvent` emitted on the [event bus](/docs/events) is broadcast, attaches the
  WebSocket handlers via `app.withWebSocket()`, and registers the `POST /broadcasting/auth`
  channel-auth route (for the `ws`, `redis`, and `pusher` drivers).
- `onBooting` — boots the Redis driver (when active) and side-effect-imports `routes/channels.ts`
  so its authorization rules are registered before the first auth request.
- `onBooted` — registers the `channel:list` and `make:channel` CLI commands.
- `onStopping` — stops the Redis driver, so nothing leaks between boots or test suites.

The provider exposes one HTTP route and one WebSocket upgrade path:

- `POST /broadcasting/auth` — the private/presence channel auth endpoint (a real `Router` route).
- The WebSocket upgrade is served at the configured `path` (default `/app/ws`) via Bun's
  WebSocket handler — it is _not_ a separate `Router` route. Pusher/Echo clients connect to
  `ws://host/app/{appKey}`.

## Configuration

Create `config/broadcasting.ts` with the `BroadcastConfig()` helper so every field stays
type-checked while literal values stay inferred. All options below are shown with their defaults;
`redis` and `pusher` are only required for their respective drivers.

```ts
// config/broadcasting.ts
import { BroadcastConfig } from "@zerotal/broadcasting";
import { env } from "zerotal";

export default BroadcastConfig({
  path: "/app/ws", // WebSocket upgrade path
  driver: "null", // 'null' | 'ws' | 'redis' | 'pusher'

  // Required when driver is 'redis':
  redis: { url: env("REDIS_URL", "redis://localhost:6379") },

  // Required when driver is 'pusher':
  pusher: {
    appKey: env("PUSHER_APP_KEY", ""),
    appSecret: env("PUSHER_APP_SECRET", ""),
  },
});
```

| Field    | Required        | Default     | Description                                                                |
| -------- | --------------- | ----------- | -------------------------------------------------------------------------- |
| `path`   | no              | `"/app/ws"` | WebSocket upgrade path. Pusher clients connect to `/app/{appKey}` instead. |
| `driver` | no              | `"null"`    | `'null'` \| `'ws'` \| `'redis'` \| `'pusher'` — how broadcasts are sent.   |
| `redis`  | with `'redis'`  | —           | `{ url }` Redis connection. Falls back to `redis://localhost:6379`.        |
| `pusher` | with `'pusher'` | —           | `{ appKey, appSecret }` Pusher/Reverb credentials.                         |

### Which driver should I use?

The active driver decides _how_ a broadcast is delivered. Switch drivers per environment via the
`driver` key — your event classes never change.

| Driver   | Class                  | Delivery                                       | Use for                                          |
| -------- | ---------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `null`   | —                      | Discards everything (default)                  | Local dev / tests where you don't need real WS   |
| `ws`     | —                      | In-process WebSocket, Zerotal native protocol  | Single-server deployments                        |
| `redis`  | `RedisBroadcastDriver` | Redis Pub/Sub fan-out, Zerotal native protocol | Horizontally-scaled deployments (many instances) |
| `pusher` | `PusherCompatManager`  | Pusher-compatible wire protocol                | Existing Pusher-protocol clients                 |

You select a driver through the `driver` key rather than constructing one. The classes
are exported for the cases that need the instance itself — a test asserting on
fan-out, or a custom driver wrapping one rather than reimplementing it.

> **Tip** — Start on `null` in tests and local dev; switch to `ws` for a single server, `redis`
> once you run more than one instance, and `pusher` only when you must speak the Pusher wire
> protocol to existing clients.

## Basic usage

Import the surface you need from `@zerotal/broadcasting`:

```ts
// in a controller or event file
import {
  Broadcast,
  BroadcastingEvent,
  broadcast,
  channel,
  privateChannel,
  presenceChannel,
} from "@zerotal/broadcasting";
```

Extend `BroadcastingEvent`, implement `broadcastOn()`, and dispatch — every subscribed client on
that channel receives the payload:

```ts
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
}

// elsewhere — construct, run listeners, and broadcast in one call:
OrderShipmentStatusUpdated.dispatch(order);
```

## The rest of the guide

| Page                                               | What it covers                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Events](/docs/broadcasting/events)                | Write a broadcast event, dispatch it, and broadcast model changes automatically. |
| [Channels](/docs/broadcasting/channels)            | Public, private, presence, and typed channels — and authorizing access to them.  |
| [on the Client](/docs/broadcasting/client)         | Subscribe from the browser and react to events as they arrive.                   |
| [Testing Broadcasting](/docs/broadcasting/testing) | Fake the broadcaster and assert on what would have been sent.                    |
| [References](/docs/broadcasting/references)        | The Broadcast facade, channel APIs, errors, and commands.                        |

## Next steps

- [Events](/docs/events) — the in-process event bus; emitting a `BroadcastingEvent` broadcasts it.
- [Notifications](/docs/notifications) — real-time notifications over the `'broadcast'` channel.
- [Authentication](/docs/authentication) — how `http.user` is populated for the
  `routes/channels.ts` authorization callbacks.
- [ORM Lifecycle](/docs/orm/lifecycle) — the `dispatchesEvents` bridge that auto-broadcasts model changes.
