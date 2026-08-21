---
title: API Client
description: Call your HTTP API with full TypeScript inference of params, body, query, and response shapes.
---

# API Client

A typed HTTP client bound to a **route map**. Describe an API's shape once and the
compiler infers path params, query params, request bodies and response types at
every call site — no casting, and a renamed endpoint is a build error.

```ts
const user = await api.get("/api/users/{id}", { id: 42 });
//    ^? User — inferred from the route map, not asserted
```

## Where it runs

Both sides, and the choice is about _how you get an instance_, not about where the
code lives:

| You are                                       | Use                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| In the browser, calling your own app's API    | `createApiClient<Routes>()` — one instance you own                         |
| On the server — a controller, job, or command | `ClientProvider` + the `Client` facade, configured from `config/client.ts` |

The provider is registered for `web`, `console`, `worker`, `test` and `repl`, so a
queued job calling a third-party API uses the same client a page does.

### How this differs from core's `Http`

Both send HTTP requests from a server; they are not interchangeable, and the split
is about **types, not sides**:

- **This package** when the API has a shape worth describing — your own API, or a
  third-party one you have typed. You get inference and a compile error when an
  endpoint moves.
- **Core's [`Http` facade](/docs/context)** for a one-off, untyped request — a
  webhook, a health probe, an endpoint you call once. Fluent, fakeable in tests,
  nothing to declare first.

Reach for `Http` when writing the route map would cost more than the call is worth.

> **This package also ships the realtime client.** `Socket`, `Channel` and
> `PresenceChannel` — a dependency-free WebSocket client speaking Zerotal's native
> broadcast protocol — live here too, and are documented where they are used:
> [Broadcasting → Client](/docs/broadcasting/client).

## Getting Started

```bash
# in your project root
bun add @zerotal/client
```

## Register the provider

Registering the provider is optional — it gives you one container-bound `client`
built from `config/client.ts`. Add `ClientProvider` to the providers array in
`bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { ClientProvider } from "@zerotal/client";

const providers = [
  // …your other providers
  ClientProvider,
];

export default providers;
```

Registering the provider switches on the following:

- `onRegister` — binds an `ApiClient` as a lazy singleton under the `client` key, built from the `client` config namespace.
- `onBooted` — pre-resolves that async singleton so the `Client` facade can be accessed synchronously after boot.

The provider is active in the `web`, `console`, `worker`, `test`, and `repl`
environments. Resolve the shared client via the container or the `Client` facade:

```ts
// in a controller or service
import { Client } from "@zerotal/client";

const users = await Client.get("/api/users");
```

## Configuration

Create `config/client.ts` with the `ClientConfig()` helper (or `satisfies
ClientConfigShape`) so every field stays type-checked. The shape extends
[`ApiClientConfig`](/docs/client/references) — every client option below is valid here:

```ts
// config/client.ts
import { ClientConfig } from "@zerotal/client";
import { env } from "zerotal";

export default ClientConfig({
  baseUrl: env("API_BASE_URL", "https://api.example.com"),
  headers: { Accept: "application/json" },
});
```

| Field             | Required | Default | Description                                                    |
| ----------------- | -------- | ------- | -------------------------------------------------------------- |
| `baseUrl`         | no       | `""`    | Base URL prepended to every request path.                      |
| `headers`         | no       | `{}`    | Default headers sent with every request.                       |
| `token`           | no       | —       | Bearer token (string or resolver) attached as `Authorization`. |
| `withCredentials` | no       | `false` | Send cookies (`credentials: 'include'`); also turns CSRF on.   |
| `csrf`            | no       | —       | CSRF cookie/header names, or a boolean to force on/off.        |
| `timeout`         | no       | —       | Default per-request timeout in ms (`0`/omitted = none).        |
| `retry`           | no       | —       | Default retry policy (number of attempts or `RetryOptions`).   |

> **Note** — The provider carries no framework-level defaults of its own; `ApiClient`
> applies its own internal defaults. The config file is just typed input.

## Create a client directly

In the browser (or anywhere you want a standalone instance), build a client with
`createApiClient<Routes>()`:

```ts
// app/api/client.ts
import { createApiClient } from "@zerotal/client";
import { env } from "zerotal";
import type { Routes } from "./api-types.ts";

export const api = createApiClient<Routes>({
  baseUrl: env("API_BASE_URL", "https://api.example.com"),
  headers: { Accept: "application/json" },
});
```

> **Tip** — Don't instantiate `ApiClient` directly; `createApiClient<Routes>(config)`
> binds the route map type for you.

## The rest of the guide

| Page                                       | What it covers                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| [Requests](/docs/client/requests)          | The typed route map, making requests, and shaping them with interceptors.      |
| [Authentication](/docs/client/auth)        | Bearer tokens, CSRF, and refreshing credentials on a 401.                      |
| [Error Handling](/docs/client/errors)      | What a failed request throws, and how to tell the failure modes apart.         |
| [Resilience](/docs/client/resilience)      | Timeouts, retries, and the circuit breaker that spares a failing upstream.     |
| [File Transfers](/docs/client/files)       | Uploading and downloading binary payloads.                                     |
| [Testing the Client](/docs/client/testing) | Stub the global fetch, cover the failure paths, and drive the circuit breaker. |
| [References](/docs/client/references)      | Every ApiClient method, config key, and error type in one table.               |

## Next steps

- [Rate Limiting](/docs/rate-limiting) — throttle outbound and inbound traffic.
- [Authentication](/docs/authentication) — issue the tokens your interceptors attach.
- [Validator](/docs/validator) — the server side that produces the `ValidationError` body.
- [Telemetry](/docs/telemetry) — observe request failures and circuit state.
