---
title: Broadcasting Channels
description: Public, private, presence, and typed channels — and authorizing access to them.
---

# Channels

`broadcastOn()` returns a channel name (or an array of them). Pick the channel type with one of
three helpers — they prefix the name so the server and client agree on it:

```ts
// in an event's broadcastOn()
import { channel, privateChannel, presenceChannel, isPrivateChannel } from "@zerotal/broadcasting";

channel("posts"); // public   — anyone may subscribe;    name: "posts"
privateChannel("orders.42"); // private  — requires authorization;  name: "private-orders.42"
presenceChannel("chat.room1"); // presence — private + member tracking; name: "presence-chat.room1"
```

| Helper                  | Channel kind | Authorization        | Name prefix |
| ----------------------- | ------------ | -------------------- | ----------- |
| `channel(name)`         | Public       | None                 | _(none)_    |
| `privateChannel(name)`  | Private      | Boolean callback     | `private-`  |
| `presenceChannel(name)` | Presence     | Member-data callback | `presence-` |

The helpers are idempotent — `privateChannel("private-orders.42")` returns the name unchanged, so
it's safe to wrap an already-prefixed channel. `isPrivateChannel(name)` is a guard that's `true`
for both `private-` and `presence-` names.

Private and presence channels are authorized in
[`routes/channels.ts`](#authorizing-channels); public channels need no auth.

## Authorizing channels

Private and presence channels require server-side authorization before a client can subscribe.
Define the rules in `routes/channels.ts` with `Broadcast.channel(pattern, callback)` — the
broadcasting analogue of `routes/web.ts`. It's loaded automatically at boot.

Patterns use the file-routing **`[param]` placeholder syntax**. Each `[param]` matches one channel
segment and is passed to the callback positionally after the authenticated user.

```ts
// routes/channels.ts
import { Broadcast } from "@zerotal/broadcasting";
import { Order } from "../app/models/Order.ts";
import type { User } from "../app/models/User.ts";

// Private channel — return a boolean.
Broadcast.channel("orders.[orderId]", async (user: User, orderId: string) => {
  return user.id === (await Order.findOrNew(orderId)).userId;
});

// Presence channel — return member data to authorize + publish presence, or null to deny.
Broadcast.channel("chat.[roomId]", (user: User, roomId: string) => {
  if (!user.canJoin(roomId)) return null;
  return { id: user.id, name: user.name };
});
```

- **The authenticated user** is whatever your auth middleware put on the request (`http.user`);
  guests are denied automatically.
- **Return value is the signal**: `boolean` for private channels; a member-data object for
  presence channels (`false`/`null` to deny).
- **No matching rule = denied.** A private/presence channel with no registered pattern is rejected.
- Patterns are registered **without** the `private-`/`presence-` prefix (it's stripped before
  matching), so one `orders.[orderId]` rule covers both private and presence variants.

> **Danger** — The authorization callback is the only thing between a client and another user's
> data. Return `true`/member data only after you've confirmed the authenticated user may access
> that exact channel — never trust the channel name alone.

Authorization is enforced on the `POST /broadcasting/auth` path. List every registered rule with:

```bash
# in your project root
bun zt channel:list
```

### Scaffolding

```bash
# in your project root
# Add a private channel rule to routes/channels.ts (creates the file if missing).
bun zt make:channel Order             # -> orders.[id]
bun zt make:channel orders.[orderId]  # -> orders.[orderId]
bun zt make:channel chat.[roomId] -p  # -p / --presence: presence-channel stub

# Generate a broadcastable event class (extends BroadcastingEvent).
bun zt make:event OrderShipped --broadcast   # or -b
```

`make:channel` appends a `Broadcast.channel(...)` block (private by default, presence with
`--presence`); a bare model name like `Order` expands to `orders.[id]`. `make:event --broadcast`
writes an `app/events/*.ts` with `broadcastOn()`/`broadcastWith()` stubbed.

## Presence channels

Presence channels track who is currently subscribed, enabling "who's online" lists. The
authorization rule for a presence channel returns the **member data** instead of a boolean:

```ts
// routes/channels.ts
Broadcast.channel("chat.[roomId]", (user: User, roomId: string) => {
  if (!user.canJoin(Number(roomId))) return null;
  return { id: user.id, name: user.name, avatar: user.avatar ?? null };
});
```

Read the current members anywhere with `Broadcast.getMembers("presence-chat.room1")`.

### Presence wire events

The server emits these protocol events on a presence channel. Names are shown as they appear on
the wire; a Pusher-protocol client surfaces them to your code under the `pusher:` prefix
(e.g. `pusher:subscription_succeeded`).

| Wire event (pusher driver)               | Payload                  | Description                                         |
| ---------------------------------------- | ------------------------ | --------------------------------------------------- |
| `pusher_internal:subscription_succeeded` | `{ presence }`           | Sent to the joining client with all current members |
| `pusher_internal:member_added`           | `{ user_id, user_info }` | Broadcast to other members when someone joins       |
| `pusher_internal:member_removed`         | `{ user_id }`            | Broadcast to other members when someone leaves      |

> **Note** — The native `ws`/`redis` drivers use the equivalent
> `subscription_succeeded` / `presence:member_added` / `presence:member_removed` events; the
> first-party `Socket` client maps them to Echo's `here`/`joining`/`leaving` callbacks for you.

## Typed channels

For end-to-end type safety, declare a channel map and use `TypedBroadcastManager`.
Keys are channel patterns (with optional `[param]` placeholders); values map event
names to their payload types. The compiler then enforces that every `to()` /
`toChannel()` call uses a valid channel, a known event name, and a matching payload.

```ts
// app/broadcasting/channels.ts
import { TypedBroadcastManager } from "@zerotal/broadcasting";
import type { BroadcastChannelMap } from "@zerotal/broadcasting";

export interface Channels extends BroadcastChannelMap {
  posts: {
    PostCreated: { id: number; title: string };
    PostDeleted: { id: number };
  };
  "private-orders.[orderId]": {
    OrderShipped: { orderId: number; trackingCode: string };
    OrderCancelled: { orderId: number; reason: string };
  };
}

const manager = new TypedBroadcastManager<Channels>();

// Static channel — event name + payload are checked against the map
manager.to("posts", "PostCreated", { id: 1, title: "Hello" });

// Parameterised channel — pass the pattern, its params, then event + payload
manager.toChannel("private-orders.[orderId]", { orderId: 42 }, "OrderShipped", {
  orderId: 42,
  trackingCode: "UPS-123",
});
```

A wrong event name, a missing payload field, or an unknown channel is a
**compile-time error** — nothing reaches the wire. Passing a parameter that the
pattern doesn't declare (or omitting one) throws `MissingChannelParameterError` at
runtime.

## Next steps

- [Broadcasting overview](/docs/broadcasting) — the guide's front page and the rest of the sections.
- [Reference](/docs/broadcasting/references) — the full API surface in one table.
