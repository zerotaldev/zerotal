---
title: Rate Limiting
description: Cap how many requests an actor can make in a time window and respond with 429 when they exceed it.
---

# Rate Limiting

Rate limiting protects routes from abuse by counting requests per actor and
rejecting anything over the threshold. Zerotal ships two complementary limiters in
`@zerotal/core` — both built in, with nothing to install or register.

- **`ThrottleMiddleware`** — a quick inline limiter you attach to a route or the
  global pipeline.
- **`RateLimiter`** — a **named**, reusable limiter you define once and apply by
  name, with rich keying strategies and runtime inspection.

Both use an in-memory sliding window and respond with **429 Too Many Requests**,
setting `Retry-After` and `X-RateLimit-*` headers when the limit is exceeded.

## Getting Started

Rate limiting is built into `@zerotal/core` — nothing to install:

```typescript
import { ThrottleMiddleware } from "zerotal";
```

## Which should I use?

- Reach for **`ThrottleMiddleware`** for a one-off limit on a single route or the
  global pipeline — the options live right where you attach it.
- Reach for **`RateLimiter`** when the same limit is reused across many routes, or
  when you want to query and reset it at runtime (e.g. clearing failed-login
  counters after a successful sign-in).

## ThrottleMiddleware — inline

Attach it directly with the static `.with(options)` factory, which returns a
ready-to-use middleware class:

```typescript fragment
// in routes/web.ts (or wherever you register routes)
import { ThrottleMiddleware } from "zerotal";

// Global: 120 requests / minute per IP
app.use([ThrottleMiddleware.with({ maxAttempts: 120, windowSeconds: 60 })]);

// Per-route: 5 login attempts / minute
Router.post("/login", AuthController, "login", [
  ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 }),
]);

// Key by authenticated user instead of IP
ThrottleMiddleware.with({
  maxAttempts: 1000,
  windowSeconds: 3600,
  keyResolver: (ctx) => String(ctx.user?.id ?? ctx.ip()),
});
```

| Option           | Required | Default     | Description                                                 |
| ---------------- | -------- | ----------- | ----------------------------------------------------------- |
| `maxAttempts`    | yes      | —           | Max requests within the window.                             |
| `windowSeconds`  | no       | `60`        | Window length in seconds.                                   |
| `keyResolver`    | no       | client IP   | Function returning the rate-limit key for a request.        |
| `trustedProxies` | no       | `undefined` | Number of trusted upstream proxies (see the warning below). |

`X-Forwarded-For` is written by the client, so it is consulted **only** when
`trustedProxies` says how many proxies sit in front of the app — the count is what says
which entry is not attacker-controlled. Left `undefined` (or `0`), the unspoofable socket
address is used.

**Counted from the right, and that is the whole of it.** Each proxy _appends_ the address
it received the request from, so the rightmost entries are the ones your own
infrastructure wrote and the leftmost is whatever the client sent. Reading the header
left-to-right — the obvious way, and how most hand-rolled versions do it — hands the
limiter's key to the attacker: they set `X-Forwarded-For: <your CFO's IP>`, spend the
budget, and the person whose address they borrowed is locked out of the form. A limiter
that can be aimed is worse than no limiter, because it looks like it is working.

> **Danger** — That default is right, and it is the wrong answer the moment you deploy
> behind a proxy. The socket address is then the _proxy's_ — `127.0.0.1` for every visitor
> — so everyone shares one bucket per form and the limiter inverts into the thing it was
> installed to prevent: one attacker making twenty bad sign-ins a minute locks the whole
> staff out of the console. Nothing fails; you put Caddy in front, everything works, and
> the limiter quietly stops telling people apart. Set `trustedProxies` to the number of
> proxies you actually run. `zt doctor` warns when a production-like deployment has a
> throttle and no `trustedProxies` — see [Deployment](/docs/deployment#behind-a-reverse-proxy).

### One `.with()` call, one bucket

Each `.with()` call returns its own class, and the hit counter belongs to the class — so
**re-using one `.with()` export on two routes gives them a shared budget**:

```typescript fragment
// One bucket: 5 attempts across BOTH forms.
const AuthThrottle = ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 });
Router.post("/login", AuthController, "login", [AuthThrottle]);
Router.post("/two-factor", AuthController, "challenge", [AuthThrottle]);

// A bucket each, which is almost always what was meant.
Router.post("/login", AuthController, "login", [
  ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 }),
]);
Router.post("/two-factor", AuthController, "challenge", [
  ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 }),
]);
```

The sharing is deliberate — it is what lets you spend one allowance across a group of
related routes on purpose — and it is not what a reader expects from a factory. On a sign-in
flow it bites: a handful of fumbled passwords can spend the allowance a legitimate person
needs to answer their second factor. Call `.with()` once per thing that deserves its own
budget.

## RateLimiter — named limiters

Define a limiter once (typically in a `ServiceProvider.onBooted()`), then apply it
by name anywhere. Definitions are fluent, and `.register()` activates them:

```typescript
// in a ServiceProvider's onBooted()
import { RateLimiter } from "zerotal";

// 1000 req/hour per authenticated user (falls back to IP when unauthenticated)
RateLimiter.for("api").limit(1000).every(3600).byUser().register();

// 5 login attempts per minute, per IP
RateLimiter.for("login").limit(5).every(60).byIp().register();

// 500 req/min keyed by an API-key header (unknown key → per IP)
RateLimiter.for("partner").limit(500).every(60).byApiKey("x-api-key").register();

// Custom key
RateLimiter.for("upload")
  .limit(10)
  .every(3600)
  .by((ctx) => `user:${ctx.user?.id ?? "anon"}`)
  .register();
```

> **Warning** — `.register()` is required. A definition that is never registered
> cannot be resolved by `RateLimiter.middleware()`, which throws if the name is
> unknown.

### Keying strategies

Each `.by*()` call sets how requests are bucketed. The default (no `.by*()` call)
is the client IP.

| Method               | Keys on                                     | Falls back to            |
| -------------------- | ------------------------------------------- | ------------------------ |
| `.byUser()`          | `ctx.user.id`                               | IP when unauthenticated  |
| `.byApiKey(header?)` | `x-api-key` header (or a custom header)     | IP when header is absent |
| `.byIp()`            | Socket IP → `X-Forwarded-For` → `X-Real-IP` | `'unknown'`              |
| `.by(fn)`            | Return value of your function               | —                        |

### Applying a named limiter

`RateLimiter.middleware(name)` returns the middleware instance for a registered
limiter, ready to drop into a route or group:

```typescript fragment
// in routes/web.ts
import { RateLimiter } from "zerotal";

Router.post("/login", AuthController, "login", [RateLimiter.middleware("login")]);

Router.group({ prefix: "/api", middleware: [RateLimiter.middleware("api")] }, () => {
  Router.get("/users", UserController, "index");
});
```

### Inspecting and resetting at runtime

Check or clear a limiter imperatively — e.g. reset failed-login counts after a
successful sign-in:

```typescript fragment
// in a controller
import { RateLimiter } from "zerotal";

if (await RateLimiter.tooManyAttempts("login", ctx)) {
  return ctx.json({ message: "Too Many Requests" }, 429);
}

RateLimiter.resetFor("login", ctx); // clear this actor's counter
```

> **Note** — `RateLimiter.tooManyAttempts()` records a hit and returns a promise,
> so `await` it. Unlike the middleware, it never sends the 429 itself — you decide
> how to respond.

## Response on limit

When the window is exceeded, both limiters return **429** with:

- `Retry-After` — seconds until the window resets.
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` — the cap and what's left.
- `X-RateLimit-Reset` — the unix timestamp (seconds) when the window resets.

The 429 body is content-negotiated: an HTML page for web requests, a
`{ message: "Too Many Requests" }` JSON object for API requests, and a plain-text
line for CLI requests.

> **Warning** — Counters are in-memory and live in the process. With multiple
> instances behind a load balancer, each enforces the limit independently — fine
> for coarse protection. For a hard global cap across instances, gate the action
> with a shared store such as a [distributed lock](/docs/lock) or a cache-backed
> counter.

## Testing

Set your suite up once as described in [Testing](/docs/testing). A rate limiter
is only proven by the request that gets refused, so the test has to exhaust it.

```typescript fragment
// tests/http/throttle.test.ts
import { test, expect } from "bun:test";
import { createApp } from "../helpers.ts";

test("the sixth attempt in a minute is refused", async () => {
  const app = await createApp();

  for (let i = 0; i < 5; i++) {
    (await app.post("/login", { email: "a@b.c", password: "wrong" })).assertStatus(422);
  }

  const blocked = await app.post("/login", { email: "a@b.c", password: "wrong" });

  blocked.assertStatus(429);
  blocked.assertHeader("Retry-After");
  await app.close();
});
```

**Assert the headers, not just the status.** `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` are what a well-behaved client
reads to back off. A limiter that returns `429` without them still fails the
clients it was meant to protect you from:

```typescript fragment
// tests/http/throttle.test.ts
blocked.assertHeader("X-RateLimit-Limit", "5");
blocked.assertHeader("X-RateLimit-Remaining", "0");
```

**The counter is shared state**, so a limiter test contaminates whatever runs
next in the same window. Give each test a distinct key — a different route, IP
header, or user — rather than relying on ordering:

```typescript fragment
// tests/http/throttle.test.ts
await app.post("/login", { email: "a@b.c" }, { "X-Forwarded-For": "10.0.0.7" });
```

> **Warning** — A throttled response is `429` for JSON and an HTML page for a
> browser request. `assertStatus(429)` holds for both; `assertJson()` does not.

## References

### `RateLimiter` (static)

| Method            | Signature                                                           | Description                                                  |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `for`             | `for(name: string): LimiterDefinition`                              | Begin a fluent definition.                                   |
| `middleware`      | `middleware(name: string): ThrottleMiddleware`                      | Get middleware for a registered limiter (throws if unknown). |
| `tooManyAttempts` | `tooManyAttempts(name: string, ctx: HttpContext): Promise<boolean>` | Record a hit; `true` if the actor is over the limit.         |
| `resetFor`        | `resetFor(name: string, ctx: HttpContext): void`                    | Reset the actor's counter for a limiter.                     |
| `clear`           | `clear(): void`                                                     | Clear all registered limiters (useful in tests).             |

### `LimiterDefinition` (fluent)

| Method     | Signature                                    | Description                                                |
| ---------- | -------------------------------------------- | ---------------------------------------------------------- |
| `limit`    | `limit(max: number): this`                   | Maximum requests in the window (default `60`).             |
| `every`    | `every(seconds: number): this`               | Window duration in seconds (default `60`).                 |
| `byUser`   | `byUser(): this`                             | Key by `ctx.user.id`; IP when unauthenticated.             |
| `byApiKey` | `byApiKey(header?: string): this`            | Key by header value (default `x-api-key`); IP when absent. |
| `byIp`     | `byIp(): this`                               | Key by client IP (the explicit default).                   |
| `by`       | `by(fn: (ctx: HttpContext) => string): this` | Key by your own resolver.                                  |
| `register` | `register(): this`                           | Register the limiter with the global registry.             |

### `ThrottleMiddleware`

| Member     | Signature                                                                      | Description                              |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `with`     | `static with(options: Partial<ThrottleOptions>): new () => ThrottleMiddleware` | Build a middleware class from options.   |
| `reset`    | `reset(): void`                                                                | Clear all counters (useful in tests).    |
| `resetKey` | `resetKey(ctx: HttpContext): void`                                             | Clear the counter for one context's key. |

## Next steps

- [Middleware](/docs/middleware) — attaching middleware to routes and groups.
- [Lock](/docs/lock) — coordinating limits across multiple instances.
- [Authentication](/docs/authentication) — `ctx.user` used by `.byUser()`.
