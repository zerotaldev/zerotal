---
title: HTTP Client
description: Call another service over HTTP from your app — typed against a route map, with retries, timeouts and a circuit breaker.
---

# HTTP Client

Your application talking to somebody else's — a payment gateway, an internal
service, a partner API. `@zerotal/client` sends those requests, and types them
against a **route map** so the compiler knows the path params, query, body and
response of every endpoint:

```ts
const api = createApiClient<Routes>({ baseUrl: "https://api.example.com" });

const user = await api.get("/api/users/{id}", { id: 42 });
//    ^? User — inferred from the route map, not asserted
```

Describe the API once and a renamed endpoint or a missing parameter becomes a build
error rather than a 404 in production.

> **Inference comes from the instance, not the facade.** `createApiClient<Routes>()`
> is what binds the map. The container-bound `Client` facade below is typed against
> the base route map, so it sends the same requests and gives you back `unknown`
> rather than `User` — convenient for a quick call, not a substitute for a typed
> instance.

## When to use this, and when to use `Http`

Core ships an [`Http` facade](/docs/context) that also makes outbound requests, and
the two are not interchangeable. The split is **how much you know about the API**:

|                   |                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This package**  | An API you call repeatedly and can describe — your own service, a documented third-party one. You write a route map once and every call site is checked. |
| **Core's `Http`** | A one-off, untyped request — a webhook, a health probe, an endpoint you hit once. Fluent and fakeable, with nothing to declare first.                    |

Reach for `Http` when writing the route map would cost more than the call is worth.
Reach for this when the same endpoints come up again and again, or when getting the
shape wrong is expensive.

It also carries the resilience an outbound call needs: per-request timeouts,
retries, and a [circuit breaker](/docs/client/resilience) that stops hammering a
service that is already failing.

> **Realtime lives elsewhere.** This package also ships `Socket`, `Channel` and
> `PresenceChannel`, but they are a different job and documented where that job is:
> [Broadcasting → Client](/docs/broadcasting/client).

> **Using it in a browser bundle?** Importing `@zerotal/client` from browser-targeted
> code resolves to a browser-safe entry — the same `createApiClient()` and
> `ApiClient`, without `ClientProvider` and `ClientConfig`, which are server-only.
> The import is the same either way; the pages that follow are written from the
> server's side.

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

This is the typed path, and the one to reach for when the API matters. Build the
instance once — in a service, a job, or a module your controllers import — and share
it:

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
