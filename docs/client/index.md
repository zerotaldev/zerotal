---
title: HTTP Client
description: Call another service from your app — requests, auth, timeouts, retries, errors, and a circuit breaker.
---

# HTTP Client

Your application calling somebody else's: charging a card, sending a message,
looking up an address. `@zerotal/client` is the outbound HTTP client — a thin,
expressive wrapper over `fetch` that adds what every real integration ends up
needing anyway and that is tedious to get right by hand.

```ts fragment
import { Client } from "@zerotal/client";

const charge = await Client.post("https://api.stripe.com/v1/charges", {
  amount: 2000,
  currency: "usd",
  source: token,
});
```

Timeouts, retries with backoff, bearer tokens, a circuit breaker for the upstream
that has started failing, and errors you can branch on.

> **For requests coming _into_ your app**, see [Routing](/docs/routing). This page is
> only about requests going out.

## Install and register

```bash
bun add @zerotal/client
```

Add `ClientProvider` to `bootstrap/providers.ts` to get one shared, configured
client from the container:

```ts
// bootstrap/providers.ts
import { ClientProvider } from "@zerotal/client";

const providers = [
  // …your other providers
  ClientProvider,
];

export default providers;
```

It binds a client under the `client` key in the `web`, `console`, `worker`, `test`
and `repl` environments — so a queued job calling a gateway uses the same client a
controller does — and exposes it as the `Client` facade.

## Making requests

Five methods, each taking a URL. Pass an absolute URL, or set a `baseUrl` in config
and pass a path:

```ts
import { Client } from "@zerotal/client";

await Client.get("https://api.example.com/v1/invoices");
await Client.post("https://api.example.com/v1/invoices", { customer: "cus_123" });
await Client.put("https://api.example.com/v1/invoices/in_9", { memo: "Paid" });
await Client.patch("https://api.example.com/v1/invoices/in_9", { memo: "Paid" });
await Client.delete("https://api.example.com/v1/invoices/in_9");
```

The response body is decoded for you — JSON when the response is JSON, text
otherwise. A 2xx returns; anything else throws, which [Errors](#errors) covers.

### Query parameters

```ts fragment
await Client.get("https://api.example.com/v1/charges", undefined, {
  query: { limit: 25, status: "succeeded", created: { gte: 1_700_000_000 } },
});
```

Nested objects and arrays are serialized with bracket notation, so
`{ created: { gte: 1 } }` becomes `created[gte]=1`.

### Request bodies

A plain object or array is JSON-encoded with the matching `Content-Type`. Anything
`fetch` understands natively — `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`,
a raw string — passes straight through, so the runtime sets the header itself
(including multipart boundaries):

```ts fragment
// Form-encoded, which several gateways still require
await Client.post(
  "https://api.example.com/v1/charges",
  new URLSearchParams({ amount: "2000", currency: "usd" }),
);
```

### Headers

Per request, merged over the client's defaults:

```ts fragment
await Client.post("https://api.example.com/v1/messages", payload, {
  headers: { "Idempotency-Key": crypto.randomUUID() },
});
```

## Authentication

Most APIs want a bearer token. Set it once and every request carries
`Authorization: Bearer …`:

```ts
// config/client.ts
import { ClientConfig } from "@zerotal/client";
import { env } from "zerotal";

export default ClientConfig({
  baseUrl: "https://api.example.com",
  token: env("PAYMENTS_API_KEY", ""),
  headers: { Accept: "application/json" },
});
```

A `token` may also be a function, including an async one, which is how credentials
that expire are handled — it is resolved per request:

```ts fragment
export default ClientConfig({
  token: async () => await currentAccessToken(),
});
```

Change it at runtime with `setToken(token)`, or pass `null` to clear it. Its type is
`TokenSource`.

For an API that wants something other than a bearer token, set the header directly:

```ts fragment
export default ClientConfig({
  headers: { "X-Api-Key": env("PARTNER_API_KEY", "") },
});
```

### Refreshing on a 401

`onUnauthorized` receives the error and a `retry` function, so a token can be
refreshed and the original request replayed once:

```ts fragment
export default ClientConfig({
  onUnauthorized: async (error, retry) => retry({ Authorization: `Bearer ${await refresh()}` }),
});
```

## Timeouts

There is no timeout by default, because the right one depends on the upstream. Set a
default and override per request:

```ts fragment
export default ClientConfig({ timeout: 10_000 });

// This one is slow and we accept that
await Client.post("https://api.example.com/v1/reports", body, { timeout: 60_000 });
```

`timeout: 0` disables it. Pass your own `signal` to cancel for any other reason; it
is combined with the timeout rather than replacing it.

## Retries

A network blip or a `503` is worth trying again; a `422` never is. `retry` retries
idempotent requests on network errors, 5xx and 429 with exponential backoff, and
honours a `Retry-After` header when the server sends one:

```ts fragment
export default ClientConfig({ retry: 2 });

await Client.post("https://api.example.com/v1/charges", body, { retry: false });
```

Turning retries **off** for a charge is the deliberate part: retrying a payment you
cannot prove failed is how a customer gets billed twice. Send an idempotency key if
you want both. Pass `RetryOptions` instead of a number to tune the delays and which
statuses qualify.

## Errors

A non-2xx throws `ApiClientError`, carrying what you need to decide what happened:

```ts fragment
import { ApiClientError } from "@zerotal/client";

try {
  await Client.post("https://api.example.com/v1/charges", body);
} catch (error) {
  if (error instanceof ApiClientError) {
    error.status; // 402
    error.body; // raw response text
    error.headers; // Headers, when available
    error.retryAfterMs; // parsed Retry-After, or null
  }
  throw error;
}
```

A `422` carrying a field-error body throws `ValidationError`, a subclass that reads
those fields for you — `has(field)`, `first(field)`, `all()`, `fields()`, and
`validationMessage` for the top-level message.

`onError` fires for every non-2xx before the throw and `onForbidden` for a 403 —
both good places to log or alert without wrapping each call site.

## Circuit breaker

When an upstream is down, continuing to call it wastes your own capacity and slows
everything queued behind it. A `CircuitBreaker` stops after a threshold of
consecutive failures, fails fast for a cooldown, then lets a single request through
to test the water:

```ts fragment
export default ClientConfig({
  circuitBreaker: { threshold: 5, cooldownMs: 30_000 },
});
```

While it is open, calls throw `CircuitBreakerOpenError` **without** a request being
made — catch that specifically to fall back to a cached answer or a queued retry.
`state` reports the `CircuitState` (`closed`, `open`, `half-open`), `failures` the
current count, and `reset()` closes it by hand.

Pass a shared `CircuitBreaker` instance instead of options when several clients talk
to the same upstream and should trip together.

## Files

Upload with `FormData`; download by asking for the body you want:

```ts fragment
const form = new FormData();
form.append("file", Bun.file("./invoice.pdf"));
await Client.post("https://api.example.com/v1/documents", form);

const pdf = await Client.get("https://api.example.com/v1/documents/doc_1", undefined, {
  responseType: "blob",
});
```

`responseType` takes `auto` (the default), `json`, `text`, `blob` or `arrayBuffer`.

## Interceptors

`onRequest` runs before every request and can rewrite the outgoing `RequestConfig`;
`onResponse` runs after every 2xx with the `ResponseContext`. Both take one function
or an array:

```ts fragment
export default ClientConfig({
  onRequest: (config) => {
    config.headers["X-Request-Id"] = crypto.randomUUID();
    return config;
  },
});
```

To read the status or headers of a single response without a global interceptor,
pass `meta` in the request options.

## Testing

The client calls `fetch`, so a test replaces `fetch`:

```ts
import { test, expect } from "bun:test";

test("charges the card", async () => {
  globalThis.fetch = async () => Response.json({ id: "ch_1", paid: true });

  const charge = await Client.post("https://api.example.com/v1/charges", { amount: 2000 });
  expect(charge.paid).toBe(true);
});
```

Return a non-2xx `Response` to cover the failure paths, and throw from the stub to
exercise retries and the breaker. For requests your app _receives_ in tests, see
[Testing](/docs/testing).

## Configuration reference

Every field of `ClientConfigShape` (which extends `ApiClientConfig`) is optional:

| Field             | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `baseUrl`         | Prepended to every request path. Omit it and pass absolute URLs.            |
| `headers`         | Default headers for every request.                                          |
| `token`           | Bearer token — a string, or a (possibly async) resolver called per request. |
| `timeout`         | Default per-request timeout in ms. `0` disables.                            |
| `retry`           | Default retry policy — a count, or `RetryOptions`.                          |
| `circuitBreaker`  | A `CircuitBreaker` instance to share, or options for a dedicated one.       |
| `withCredentials` | Send cookies (`credentials: 'include'`), and turn CSRF on.                  |
| `csrf`            | CSRF cookie/header names, or a boolean.                                     |
| `onRequest`       | Interceptor(s) run before every request.                                    |
| `onResponse`      | Interceptor(s) run after every 2xx.                                         |
| `onError`         | Called for every non-2xx before the error is thrown.                        |
| `onUnauthorized`  | Called on 401, with a `retry` function.                                     |
| `onForbidden`     | Called on 403.                                                              |

Per-request options — `RequestOptions`, plus `query` on `GetOptions` and
`params`/`query` on `MutationOptions` — override the client's defaults: `headers`,
`timeout`, `retry`, `responseType`, `signal`, `init` and `meta`.

## Calling your own API

Everything above treats a URL as a string, which is the right trade for a service
you hit a handful of endpoints on. Nobody should describe someone else's API in
types to send three requests to it.

If you are calling **your own** API repeatedly, `createApiClient<Routes>(config)`
binds a route map, so paths, params, query and response types are inferred and a
renamed endpoint becomes a build error. It returns the same `ApiClient` with a
narrower type; the `Client` facade above is bound to the base map and answers
`unknown`. The route-map types are listed in the [API reference](/docs/api).

## Realtime

This package also ships `Socket`, `Channel` and `PresenceChannel` — a WebSocket
client speaking Zerotal's broadcast protocol. Different job, documented where it is
used: [Broadcasting → Client](/docs/broadcasting/client).

## Next steps

- [Rate Limiting](/docs/rate-limiting) — throttle what you send and what you accept.
- [Telemetry](/docs/telemetry) — trace outbound calls and watch circuit state.
- [Queues](/docs/queue) — where a slow or flaky integration usually belongs.
