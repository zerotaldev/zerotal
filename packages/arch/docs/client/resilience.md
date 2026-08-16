---
title: Client Resilience
description: Timeouts, retries, and the circuit breaker that spares a failing upstream.
---

# Timeouts & retries

Set a default `timeout` (ms) and/or a `retry` policy on the client, and override either per request:

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  timeout: 10_000,
  retry: 2, // or { attempts, methods, statuses, backoff, respectRetryAfter }
});

await api.get("/api/users", undefined, { timeout: 2_000, retry: false });
```

Retries apply to **idempotent** methods by default (GET/PUT/DELETE/HEAD/OPTIONS) and trigger on
network errors, request timeouts, and `408 / 425 / 429 / 5xx` responses, using exponential backoff
with jitter and honoring any `Retry-After` header. A timeout aborts via `AbortSignal`; pass your
own `signal` to cancel manually (it's combined with the timeout).

> **Warning** — A caller-cancelled request (`AbortError`) is never retried, but a request that
> times out (`TimeoutError`) is treated as transient and retried per your policy.

## Circuit breaker

Attach a circuit breaker to stop hammering a struggling upstream service and fail
fast instead. When the circuit is open, requests throw `CircuitBreakerOpenError`
immediately — no network call is made.

```ts
// app/api/client.ts
import { createApiClient } from "@zerotal/client";

// Option 1 — options object (creates a dedicated breaker)
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  circuitBreaker: {
    threshold: 5, // open after 5 consecutive failures
    resetTimeout: 30_000, // attempt recovery after 30 s
  },
});

// Option 2 — shared instance (multiple clients trip the same circuit)
import { CircuitBreaker } from "@zerotal/client";

const breaker = new CircuitBreaker({ threshold: 3, resetTimeout: 10_000 });

const usersApi = createApiClient<Routes>({ baseUrl: "…", circuitBreaker: breaker });
const postsApi = createApiClient<Routes>({ baseUrl: "…", circuitBreaker: breaker });
```

### Which option should I use?

- **Options object** — one client talks to one upstream. Each client gets its own dedicated breaker.
- **Shared `CircuitBreaker` instance** — several clients hit the _same_ upstream and should trip together as a unit.

```ts
// in any frontend module
import { CircuitBreakerOpenError } from "@zerotal/client";

try {
  await api.get("/api/users");
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    // Return cached data, show degraded UI, etc.
  }
}
```

### Failure classification

By default:

- **5xx responses** → counted as failures (upstream is unhealthy)
- **4xx responses** → not counted (client mistakes, not upstream outages)
- **Network / DNS / timeout errors** → counted as failures

Override with a custom predicate:

```ts
// in any frontend module
new CircuitBreaker({
  isFailure: (err) => {
    if (err instanceof ApiClientError) return err.status >= 500;
    return true; // any non-ApiClientError (network failure) counts
  },
});
```

## Standalone CircuitBreaker

`CircuitBreaker` can wrap any async operation — not just HTTP requests.

```ts
// in any module
import { CircuitBreaker, CircuitBreakerOpenError } from "@zerotal/client";

const breaker = new CircuitBreaker({ threshold: 3, resetTimeout: 15_000 });

async function fetchPricing() {
  return breaker.call(async () => {
    const res = await fetch("https://pricing.internal/v1/rates");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}
```

### State machine

| State       | Behaviour                                               |
| ----------- | ------------------------------------------------------- |
| `closed`    | Requests pass through; consecutive failures are counted |
| `open`      | All calls immediately throw `CircuitBreakerOpenError`   |
| `half-open` | One probe request is allowed through to test recovery   |

Transitions:

- **closed → open** when failure count reaches `threshold`
- **open → half-open** after `resetTimeout` ms
- **half-open → closed** on a successful probe
- **half-open → open** on a failed probe (timer resets)

While in `half-open`, concurrent calls that arrive before the probe completes also
throw `CircuitBreakerOpenError` — only one probe goes through at a time.

```ts
// in any module
breaker.state; // 'closed' | 'open' | 'half-open'
breaker.failures; // current consecutive failure count
breaker.reset(); // manually reset to closed (e.g. after an admin action)
```

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Reference](/docs/client/references) — the full API surface in one table.
