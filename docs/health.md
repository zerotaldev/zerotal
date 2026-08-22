---
title: Health Checks
description: Serve a probe-friendly /health endpoint that reports liveness and the readiness of your app's dependencies.
---

# Health Checks

Zerotal serves a `/health` endpoint for liveness/readiness probes (Kubernetes,
load balancers, uptime monitors). It is **on by default outside production** and
**off in production until you enable it and protect it**.

Health checks are a core built-in — there is no package to install and no
provider to register. You configure the endpoint under the `health` key of
`config/app.ts`, then register dependency checks via the `Health` registry.

## Getting Started

Health checks are built into `@zerotal/core` — nothing to install and no
provider to register. The endpoint is registered when the application starts:

```typescript
import { Health } from "zerotal/health";
```

## Defaults

| Environment                  | Default  | Access                                                       |
| ---------------------------- | -------- | ------------------------------------------------------------ |
| development / test / staging | enabled  | open                                                         |
| production                   | disabled | requires a `secret` (`?key=` or `X-Health-Key`) once enabled |

## Configuration

The health config lives under the `health` key of `config/app.ts`. Use the
`AppConfig()` helper so every field stays type-checked:

```typescript
// config/app.ts
import { env } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "My App",
  health: {
    enabled: true, // default: on outside production, off in production
    path: "/health", // default: '/health'
    // Spread rather than assigned, because `secret?: string` under
    // `exactOptionalPropertyTypes` (which the templates set) will not take the
    // `undefined` that `env()` returns when the variable is unset. The framework
    // reads the field the same way.
    ...(env("HEALTH_KEY") ? { secret: env("HEALTH_KEY") } : {}), // required in production
    showDetails: true, // false → bare { "status": "ok" }
  },
});
```

| Field         | Required | Default         | Description                                                            |
| ------------- | -------- | --------------- | ---------------------------------------------------------------------- |
| `enabled`     | no       | on outside prod | Serve the endpoint. Off in production unless explicitly set.           |
| `path`        | no       | `"/health"`     | Route path the endpoint is registered at.                              |
| `secret`      | in prod  | unset           | Shared secret, supplied via `?key=` or the `X-Health-Key` header.      |
| `showDetails` | no       | `true`          | Include per-check details; `false` collapses the body to `{ status }`. |

> **Note** — The endpoint is only registered when the app runs in the `web` or
> `worker` environment. Console commands and tests never expose it.

> **Note** — A legacy `config/health.ts` namespace and a bare `health: true`
> boolean on `config/app.ts` are still honoured for back-compat. New projects
> should author the `health` object directly under `config/app.ts`.

### Protecting the endpoint

In production the endpoint refuses to serve unless a `secret` is configured —
so it can never be exposed unprotected by accident. Call it with the key:

```bash
# from a probe or terminal
curl "https://your-app.com/health?key=YOUR_HEALTH_KEY"
# or via header
curl -H "X-Health-Key: YOUR_HEALTH_KEY" https://your-app.com/health
```

Access control resolves as follows:

- **A `secret` is set** — the request must supply a matching `?key=` or
  `X-Health-Key`. A wrong or missing key returns **HTTP 401**.
- **Production with no `secret`** — the endpoint is refused with **HTTP 503**;
  it must be protected before it can be exposed.
- **Otherwise** (development, no secret) — access is open.

You can also leave `secret` unset and instead wrap the path in your own
auth/IP-allowlist middleware.

> **Danger** — In production, set a `secret` (or wrap the path in your own auth)
> before enabling the endpoint. The detailed report exposes dependency status,
> versions, and memory; an unprotected `/health` leaks that to anyone.

## Registering checks

Out of the box the endpoint is a **liveness** probe (the process answered) plus
a built-in `runtime` probe (memory, Bun version, in-flight requests). It becomes
a **readiness** probe as you register dependency checks against the `Health`
registry exported from `zerotal`:

```typescript fragment
// in a bootstrap file (e.g. bootstrap/health.ts)
import { Health } from "zerotal/health";

// Critical checks drive the overall status and the HTTP 503 response.
Health.register(
  "database",
  async () => {
    await DB.raw("select 1");
  },
  { critical: true },
);

// Non-critical failures degrade the report without failing readiness.
Health.register("cache", async () => {
  await Cache.set("__health", "1", 5);
  return { meta: { driver: "redis" } };
});

Health.register("disk", () => {
  const free = getFreeBytes();
  return free < 100_000_000
    ? { status: "degraded", message: "low disk" }
    : { status: "ok", meta: { freeBytes: free } };
});
```

A check is healthy when it returns (or returns `{ status: 'ok' }`), `degraded`
when it returns `{ status: 'degraded' }`, and `down` when it returns
`{ status: 'down' }` **or throws** (the thrown message becomes the check's
`message`).

### Overall status

The aggregate status is derived from every check:

- **`down`** (HTTP 503) — any `critical` check is down.
- **`degraded`** (HTTP 200) — a non-critical check is down or degraded.
- **`ok`** (HTTP 200) — everything passed.

> **Tip** — Mark only the dependencies your app genuinely cannot serve requests
> without (your primary database, say) as `critical`. A flaky cache should
> `degrade` the report, not knock the whole app out of the load balancer.

## What the endpoint returns

```json
{
  "status": "ok",
  "app": { "name": "my-app", "version": "1.4.0", "environment": "production" },
  "uptime": 3672,
  "timestamp": "2026-06-15T10:32:00.000Z",
  "checks": {
    "runtime": {
      "status": "ok",
      "durationMs": 0,
      "critical": false,
      "meta": { "memory": { "rss": 84934656 }, "bun": "1.3.14", "pendingRequests": 3 }
    },
    "database": { "status": "ok", "durationMs": 4, "critical": true },
    "cache": { "status": "ok", "durationMs": 2, "critical": false, "meta": { "driver": "redis" } }
  }
}
```

`uptime` is whole seconds since the process started. With `showDetails: false`
the body collapses to `{ "status": "ok" }` — handy for public uptime monitors
that should not see internal details.

## Testing

Set your suite up once as described in [Testing](/docs/testing). A health check
is a function you registered, so test it directly — and test what happens when it
fails, since that is the case the endpoint exists for.

```typescript
// tests/health/checks.test.ts
import { test, expect, afterEach } from "bun:test";
import { Health } from "zerotal/health";

afterEach(() => Health.clear());

test("a failing critical check brings the report down", async () => {
  Health.register(
    "database",
    async () => {
      throw new Error("connection refused");
    },
    { critical: true },
  );

  const report = await Health.run({
    name: "app",
    version: "1.0.0",
    environment: "test",
    uptime: 0, // required — seconds since boot, and a test has none worth reporting
  });

  expect(report.status).toBe("down");
  expect(report.checks.database?.status).toBe("down");
});
```

**`Health.clear()` in `afterEach` matters.** The registry is process-wide, so a
check registered by one test runs in every later one — and a deliberately failing
check left behind turns the rest of your suite red for reasons that have nothing
to do with it.

**Critical and non-critical fail differently**, and that distinction is the whole
design. A non-critical check that fails must leave the overall status up,
otherwise a flaky cache probe takes your deployment out of the load balancer:

```typescript fragment
// tests/health/checks.test.ts
test("a non-critical failure degrades without going down", async () => {
  Health.register("cache", async () => {
    throw new Error("timeout");
  }); // critical defaults to false

  const report = await Health.run(meta);

  expect(report.status).not.toBe("down");
  expect(report.checks.cache?.status).toBe("down");
});
```

**The endpoint's access rules deserve their own test**, because a health endpoint
that leaks internals is a reconnaissance gift:

```typescript fragment
// tests/http/health.test.ts
const res = await app.get("/health");

res.assertOk();
res.assertDontSee("connection refused"); // no error detail to an anonymous caller
```

> **Note** — Check functions run on every request to the endpoint. A check that
> queries the database on each call turns your load balancer's probe into
> steady traffic — worth a test asserting yours is cheap, or a cache in front.

## References

### `Health` registry

```typescript
import { Health } from "zerotal/health";
```

| Method     | Signature                                                                           | Description                                                            |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `register` | `register(name: string, fn: HealthCheckFn, options?: { critical?: boolean }): this` | Register (or replace) a named check; `critical` checks fail readiness. |
| `remove`   | `remove(name: string): this`                                                        | Remove a previously registered check by name.                          |
| `clear`    | `clear(): this`                                                                     | Remove every registered check.                                         |
| `has`      | `has(name: string): boolean`                                                        | Whether a check is registered under the given name.                    |
| `names`    | `names: string[]`                                                                   | The names of all registered checks.                                    |
| `run`      | `run(meta: HealthRunMeta): Promise<HealthReport>`                                   | Run every check and assemble the aggregate report.                     |

### `HealthResult`

What a check returns to describe its own state. A check may also return nothing
(or `undefined`) to mean `ok`.

| Field     | Type                           | Description                                             |
| --------- | ------------------------------ | ------------------------------------------------------- |
| `status`  | `"ok" \| "degraded" \| "down"` | Defaults to `ok` when a check returns without throwing. |
| `message` | `string`                       | Optional human-readable detail.                         |
| `meta`    | `Record<string, unknown>`      | Optional structured metadata surfaced in the report.    |

## Next steps

- [Telemetry](/docs/telemetry) — collect the metrics behind your readiness checks.
- [Deployment](/docs/deployment) — wire `/health` into liveness and readiness probes.
- [Logger](/docs/logger) — record failing checks for later inspection.
