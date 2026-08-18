---
title: Broadcasting on the Client
description: Subscribe from the browser and react to events as they arrive.
---

# Client-side

## First-party Socket

`@zerotal/client` ships a small, dependency-free `Socket` that speaks the native broadcast
protocol and exposes a familiar realtime-client API — no external client library, and it works
with the lightweight `ws` and `redis` drivers (no Pusher credentials needed). It's also a drop-in
for `window.Echo`, so Flow's [`@on('echo:…')`](/docs/flow/events) listeners work against it.

> **The package root is fine to import in browser code.** It used to be a bundle error: the root
> also exports `ClientProvider`, which reaches the CLI commands and `await import("bun")`, and a
> browser bundler rejects that during resolution — before tree-shaking can discard the half you
> did not want. `@zerotal/client` now resolves to a browser-safe entry under the `browser`
> condition, so a bundler gets `Socket`, `ApiClient` and `CircuitBreaker` and none of the
> server-side exports. `@zerotal/client/Socket` still works and is still the leanest import if
> `Socket` is all you need.

```ts
// in your client code
import { Socket } from "@zerotal/client";

const socket = new Socket(); // ws(s)://<host>/app/ws (matches the `path` config)

// Public channel
socket.channel("posts").listen("PostPublished", (e) => {
  console.log("New post:", e.title);
});

// Private channel (the `private-` prefix is added for you; the WS connection carries the user)
socket.private(`orders.${id}`).listen("OrderUpdated", (e) => render(e.order));

// Presence channel — who's online
socket
  .presence(`chat.${roomId}`)
  .here((members) => setOnline(members))
  .joining((m) => addOnline(m))
  .leaving((m) => removeOnline(m))
  .listen("Message", (e) => append(e));

// Use it as Echo for Flow @on('echo:…') listeners:
window.Echo = socket;
```

Private and presence channels are authorized with a **per-subscription HMAC signature** (the same
model as Pusher): the client POSTs `{ socket_id, channel_name }` to `authEndpoint` (default
`/broadcasting/auth`), the server runs the [`routes/channels.ts`](/docs/broadcasting/channels)
rules and signs the result with the app's `APP_KEY`, and the client echoes the signature in its
`subscribe`. It's automatically re-fetched on reconnect (the signature is socket-bound). Pass CSRF
or other headers via `auth.headers`, or set `authEndpoint: false` to skip the fetch and rely on
connection-level authorization instead:

```ts
// in your client code
const socket = new Socket({
  auth: { headers: { "X-CSRF-TOKEN": csrf } }, // sent on POST /broadcasting/auth
});
```

Connection state is observable via `socket.on("connected" | "disconnected" | "reconnecting" |
"error", cb)`; the client auto-reconnects and re-subscribes. Use `socket.socketId()` as the
`X-Socket-ID` header on your HTTP requests so server `toOthers()` broadcasts skip the originating
client.

## Pusher-protocol clients

The server is also Pusher-protocol compatible, so the reference
[pusher-js](https://github.com/pusher/pusher-js) client works unchanged:

```ts
// in your client code
import Pusher from "pusher-js";

const pusher = new Pusher("my-app-key", {
  wsHost: window.location.hostname,
  wsPort: 3000,
  wssPort: 3000,
  forceTLS: false,
  disableStats: true,
  enabledTransports: ["ws"],
  // Private/presence channel auth — matches POST /broadcasting/auth
  authEndpoint: "/broadcasting/auth",
  auth: {
    headers: {
      "X-CSRF-TOKEN": document.querySelector('meta[name="csrf-token"]')?.content ?? "",
    },
  },
});

// Subscribe to a public channel
const postsChannel = pusher.subscribe("posts");
postsChannel.bind("PostPublished", (data: { title: string; slug: string }) => {
  console.log("New post:", data.title);
});

// Subscribe to a private channel
const ordersChannel = pusher.subscribe("private-orders.42");
ordersChannel.bind("OrderUpdated", (data) => {
  console.log("Order updated:", data);
});

// Subscribe to a presence channel
const chatChannel = pusher.subscribe("presence-chat.room1");
chatChannel.bind("pusher:subscription_succeeded", (members) => {
  console.log("Online members:", members);
});
```

## Next steps

- [Broadcasting overview](/docs/broadcasting) — the guide's front page and the rest of the sections.
- [Reference](/docs/broadcasting/references) — the full API surface in one table.
