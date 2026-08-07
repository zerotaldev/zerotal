# @zerotal/client

> Type-safe HTTP API client bound to a route map, with a built-in circuit breaker.

A fetch-based HTTP client that infers request bodies, path params, query params, and response shapes directly from a TypeScript route map — no casting. Includes request/response interceptors, 401 token-refresh handling, and a circuit breaker that fails fast when an upstream service is struggling.

> **`@zerotal/client` vs core's `Http` facade** — they solve different problems, despite both speaking HTTP:
>
> - Use **`@zerotal/client`** (`ApiClient`) for the **frontend/SPA** consuming _your own_ typed API — it's route-map-typed and ships a familiar realtime `Socket`.
> - Use core's **`Http`** facade (`@zerotal/core`) for **server-to-server** outgoing requests — fluent, with test fakes.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/client
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { ClientProvider } from "@zerotal/client";
```

## Usage

Define your API surface as a route map, then create a client bound to it:

```ts
// api-types.ts
export interface Routes {
  "GET /api/users": {
    query: { page?: number; search?: string };
    response: { data: UserResource[]; total: number };
  };
  "GET /api/users/{id}": { params: { id: number }; response: UserResource };
  "POST /api/users": { body: { name: string; email: string }; response: UserResource };
}
```

```ts
import { createApiClient } from "@zerotal/client";
import type { Routes } from "./api-types.ts";

export const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  headers: { Accept: "application/json" },
});
```

Request methods are fully typed against the route map:

```ts
const user = await api.get("/api/users/{id}", { id: 42 }); // -> UserResource
const list = await api.get("/api/users", undefined, { query: { page: 2, search: "alice" } });
const created = await api.post("/api/users", { name: "Alice", email: "alice@example.com" });
```

Attach interceptors and 401 refresh handling at construction:

```ts
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  onRequest: async (config) => ({
    ...config,
    headers: { ...config.headers, Authorization: `Bearer ${await tokenStore.get()}` },
  }),
  onUnauthorized: async (err, retry) => {
    const newToken = await authStore.refresh();
    return retry({ Authorization: `Bearer ${newToken}` }); // limited to one attempt
  },
});
```

Add a circuit breaker to fail fast against an unhealthy upstream:

```ts
import { CircuitBreaker, CircuitBreakerOpenError } from "@zerotal/client";

const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  circuitBreaker: { threshold: 5, resetTimeout: 30_000 },
});

// CircuitBreaker also wraps any async operation directly:
const breaker = new CircuitBreaker({ threshold: 3, resetTimeout: 15_000 });
const rates = await breaker.call(() =>
  fetch("https://pricing.internal/rates").then((r) => r.json()),
);
```

Non-2xx responses throw `ApiClientError` (with `status`, `statusText`, `body`); a `422` throws a typed `ValidationError` (`.errors`, `.has()`, `.first()`); an open circuit throws `CircuitBreakerOpenError`.

The client also handles **auth & CSRF** (`token`/`setToken`, `withCredentials`, `XSRF-TOKEN` → `X-XSRF-TOKEN`), **timeouts & retries** (`timeout`, `retry` with backoff + `Retry-After`), **file uploads/downloads** (`FormData`/`Blob` bodies, `responseType: "blob"`), nested query serialization (`ids[]=`, `filter[x]=`), and a per-request `meta` callback for response headers. See [the docs](../../docs/client/index.md).

### Realtime: `Socket`

A small, dependency-free WebSocket client for [`@zerotal/broadcasting`](../broadcasting)'s native
`ws` / `redis` drivers, with a familiar realtime-client API (and a drop-in for `window.Echo`). No
external realtime client required.

```typescript
import { Socket } from "@zerotal/client";

const socket = new Socket(); // ws(s)://<host>/app/ws

socket.channel("posts").listen("PostPublished", (e) => render(e));
socket.private(`orders.${id}`).listen("OrderUpdated", (e) => update(e.order));
socket
  .presence(`chat.${roomId}`)
  .here((members) => setOnline(members))
  .joining((m) => addOnline(m))
  .leaving((m) => removeOnline(m))
  .listen("Message", (e) => append(e));
```

Private/presence channels are authorized with a per-subscription HMAC signature (Pusher-style):
the client fetches it from `authEndpoint` (default `/broadcasting/auth`, signed server-side with
`APP_KEY`) and re-fetches on reconnect. Pass `auth.headers` for CSRF, or `authEndpoint: false` for
connection-level auth. Auto-reconnects and re-subscribes; observe state with
`socket.on("connected"|"disconnected"|…, cb)`; use `socket.socketId()` as the `X-Socket-ID` header
so server `toOthers()` broadcasts skip this client. See
[Broadcasting › Client-side](../../docs/broadcasting/client.md).

## Exports

- `createApiClient<Routes>(config)` — factory returning a type-safe `ApiClient`.
- `ApiClient` — the client class (`get`, `post`, `put`, `patch`, `delete`, `setToken`).
- `ApiClientError` — thrown on non-2xx responses (`status`, `statusText`, `body`, `retryAfterMs`).
- `ValidationError` — thrown on `422`; exposes `.errors`, `.has()`, `.first()`, `.fields()`, `.validationMessage`.
- `CircuitBreaker` — standalone breaker with `.call()`, `.state`, `.failures`, `.reset()`.
- `CircuitBreakerOpenError` — thrown immediately while the circuit is open.
- `Socket` — realtime broadcasting client (`channel`, `private`, `presence`/`join`, `leave`, `socketId`, `on`).
- `Channel` / `PresenceChannel` — channel objects (`listen`, `stopListening`, `subscribed`, `error`; presence adds `here`/`joining`/`leaving`).
- `ClientProvider` / `Client` — service provider and facade.
- `ClientConfig` — config factory.
- Types: `ApiRouteMap`, `RouteShape`, `HttpMethod`, `PathParams`, `ParamRecord`, `PathsFor`, `ResponseOf`, `BodyOf`, `QueryOf`, `ApiClientConfig`, `RequestConfig`, `RequestInterceptor`, `ResponseContext`, `ResponseInterceptor`, `ResponseMeta`, `RequestOptions`, `GetOptions`, `MutationOptions`, `TokenSource`, `RetryOptions`, `CircuitBreakerOptions`, `CircuitState`, `ClientConfigShape`, `SocketOptions`, `SocketState`, `SocketLike`, `PresenceMember`.

## Documentation

- [API Client](../../docs/client/index.md)
