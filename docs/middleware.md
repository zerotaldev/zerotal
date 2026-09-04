---
title: Middleware
description: Inspect, transform, or short-circuit HTTP requests in a layered pipeline between the server and your controller.
---

# Middleware

Middleware sits in the HTTP pipeline between the server and your controller.
Each piece of middleware receives the request context, can inspect or modify it,
then either passes control to the next layer or short-circuits with a response.

Middleware ships in `@zerotal/core`, so there is nothing to install or register
— import the types and write a class.

## Getting Started

The middleware pipeline is built into `@zerotal/core` — nothing to install:

```typescript
import type { HttpContext, NextFn } from "zerotal";
```

## Writing middleware

Implement the `Pipe<HttpContext>` interface — a single `handle` method that
receives the request `HttpContext` directly and reaches the request/response
helpers on it. A middleware does exactly one of three things: **continue** by
returning `next()`, **short-circuit** by returning a `Response`, or **wrap** by
awaiting `next()` (which resolves to the downstream `Response`) and returning a
transformed one. `next()` takes no arguments:

```ts
// app/middleware/LogRequestMiddleware.ts
import type { Pipe, NextFn, HttpContext } from "zerotal";

export class LogRequestMiddleware implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    console.log(`→ ${ctx.request.method} ${ctx.path()}`);

    const response = await next(); // ← inner middleware + controller run here

    console.log(`← ${response?.status} (${ctx.took}ms)`);
    return response;
  }
}
```

The `Pipe` and `NextFn` types come straight from the package:

```ts
// the signatures, for reference
interface Pipe<T> {
  handle(payload: T, next: NextFn): Promise<Response | void>;
}

type NextFn = () => Promise<Response | void>;
```

### Short-circuiting

Return a `Response` without calling `next` to stop the pipeline:

```ts
// app/middleware/MaintenanceMiddleware.ts
import type { Pipe, NextFn, HttpContext } from "zerotal";

export class MaintenanceMiddleware implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    if (Bun.env.MAINTENANCE_MODE === "true") {
      return new Response("Down for maintenance", { status: 503 }); // ← does NOT call next
    }
    return next();
  }
}
```

> **Note** — You can also set `ctx.response` and `return` (void) instead of returning the `Response`
> directly — both are equivalent. `ctx.response` is the canonical store; a `void` return
> leaves whatever it holds untouched, so it can never erase a response a deeper pipe set.

### Wrapping

Code after `await next()` runs on the way out — after the controller has responded. `next()`
resolves to the downstream `Response` (or `undefined` if none was produced). Use this for
saving session data or appending headers. Because some responses (e.g. `Response.redirect()`)
have immutable headers, reconstruct rather than mutate — the `withHeaders` helper does this:

```ts
// app/middleware/TimingHeaderMiddleware.ts
import type { Pipe, NextFn, HttpContext } from "zerotal";
import { withHeaders } from "zerotal";

export class TimingHeaderMiddleware implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const response = await next();
    if (!response) return;
    return withHeaders(response, { "Server-Timing": `total;dur=${ctx.took}` });
  }
}
```

## Attaching middleware to routes

There are five ways to attach middleware. Reach for the one that matches the scope you want:

- **Per-route** — one specific route needs the middleware.
- **Route groups** — a handful of related routes share it.
- **Named groups** — the same stack (`web`, `api`) is reused across many groups.
- **File-based** (`_middleware.ts`) — every route file under a directory inherits it.
- **Auto-discovered** — a class in `app/middleware/` referenced by its name as a string.

For middleware that must run on _every_ request, see [Global middleware](#global-middleware).

### Per-route

Pass an array of middleware classes as the fourth argument to any route
registration method:

```ts fragment
// routes/index.ts
Router.get("/dashboard", DashboardController, "index", [AuthMiddleware]);
Router.post("/posts", PostController, "store", [AuthMiddleware, ThrottleMiddleware]);
```

### Route groups

```ts fragment
// routes/index.ts
Router.group({ middleware: AuthMiddleware }, () => {
  Router.get("/dashboard", DashboardController, "index");
  Router.resource("posts", PostController);
});
```

### Auto-discovered middleware

Middleware classes under `app/middleware/` are auto-registered at boot as a **named group under
their class name** — reference them by string in routes without importing:

```ts fragment
// app/middleware/EnsureSubscribed.ts → referenceable as "EnsureSubscribed"
Router.group({ middleware: ["EnsureSubscribed"] }, () => {
  /* … */
});
```

They are **not** global by default; set `static global = true` on the class to add it to the
global pipeline. See [Conventions](/docs/conventions#middleware-appmiddleware).

### Named middleware groups

Define a group once, reference it by name everywhere:

```ts fragment
// in a ServiceProvider.onRegister()
Router.middlewareGroup("api", [ThrottleMiddleware, BearerTokenMiddleware]);
Router.middlewareGroup("web", [SessionMiddleware, CsrfMiddleware]);
```

```ts fragment
// routes/index.ts
Router.group({ prefix: "/api/v1", middleware: "api" }, () => {
  Router.resource("posts", PostController);
});

Router.group({ middleware: ["web", AuthMiddleware] }, () => {
  Router.get("/dashboard", DashboardController, "index");
});
```

### File-based route middleware

Drop a `_middleware.ts` file into any directory under your file routes folder.
It applies to every route file in that directory and all subdirectories:

```ts fragment
// app/routes/admin/_middleware.ts
import { AuthMiddleware } from "@zerotal/auth";
import { AdminMiddleware } from "../../middleware/AdminMiddleware.ts";

export const middleware = [AuthMiddleware, AdminMiddleware];
```

Middleware stacks from outer directories are prepended automatically —
you get `root/_middleware → admin/_middleware → route handler` in one pipeline.

> **It is `export const middleware`, an array — not `export default`.** Route
> files in the same directory default-export their handler, so a default export is
> the natural guess here and it is the wrong one. The app refuses to boot and tells
> you which file, rather than serving the subtree unguarded and looking exactly
> like a guarded one. The same applies to a `_middleware.ts` that
> fails to import: a typo or a bad import path is a boot error, not a subtree that
> quietly loses its guard. A directory with no `_middleware` file at all is the
> convention working, and stays silent.
>
> Note the asymmetry with its sibling: a `_layout` file is read by its **default**
> export, a `_middleware` file by a **named** one. Both now refuse to boot on the
> other's spelling rather than applying nothing.

## Global middleware

Register middleware that runs on every request in `bootstrap/app.ts`:

```ts fragment
// bootstrap/app.ts
export default Application.create({ providers }).use([
  DevtoolsInjectionMiddleware,
  RequestIdMiddleware,
]);
```

Framework providers auto-register their own middleware (e.g. `SessionMiddleware`
from `@zerotal/session`, `AuthMiddleware` from `@zerotal/auth`) — you do not need to
add them manually.

## Built-in middleware

The package ships several middleware you can drop straight into `app.use([...])`
or a route's middleware array. Each extends `BaseMiddleware`, so `.with({ … })`
bakes options into a zero-argument class.

### Names the framework already occupies

Middleware live in a flat namespace: your `app/middleware/` classes are discovered by
class name, and so are the ones a package exports. Naming one of yours after one of
these is not caught as a conflict — it surfaces later as a type error somewhere that
does not mention either file, which is a confusing way to learn that
`TwoFactorMiddleware` was taken.

The full list, so you can check before you name:

| Middleware                                                                             | Package                          |
| -------------------------------------------------------------------------------------- | -------------------------------- |
| `CorsMiddleware`, `SecureHeadersMiddleware`, `ThrottleMiddleware`, `WebhookMiddleware` | `@zerotal/core`                  |
| `AuthMiddleware`, `GuestMiddleware`, `PersistUserMiddleware`, `RememberMeMiddleware`   | `@zerotal/auth`                  |
| `BasicAuthMiddleware`, `BearerTokenMiddleware`, `JwtGuardMiddleware`                   | `@zerotal/auth`                  |
| `RequireRoleMiddleware`, `RequirePermissionMiddleware`, `TwoFactorMiddleware`          | `@zerotal/auth`                  |
| `ValidateSignatureMiddleware`                                                          | `@zerotal/auth`                  |
| `SessionMiddleware`, `CsrfMiddleware`, `AuthSessionMiddleware`                         | `@zerotal/session`               |
| `InertiaMiddleware`, `PrecognitionMiddleware`                                          | `@zerotal/inertia`               |
| `AdminGuardMiddleware`, `AdminAbilityMiddleware`                                       | `@zerotal/admin`                 |
| `MonitorAuthMiddleware`, `MonitorPayloadMiddleware`                                    | `@zerotal/monitor`               |
| `IdempotencyMiddleware`                                                                | `@zerotal/cache`                 |
| `LocaleMiddleware`                                                                     | `@zerotal/i18n`                  |
| `EnsureTenancyMiddleware`                                                              | `@zerotal/tenancy`               |
| `TelemetryMiddleware`                                                                  | `@zerotal/telemetry`             |
| `BaseMiddleware`                                                                       | `@zerotal/core` (the base class) |

If yours does something different from the framework's, say so in the name rather
than shadowing it — `RequireTwoFactorMiddleware` for "fence the console until staff
have enrolled" reads better than `TwoFactorMiddleware` anyway, and cannot collide.

### CorsMiddleware

```ts fragment
// bootstrap/app.ts
import { CorsMiddleware } from "zerotal";

// Permissive (default — allow any origin)
app.use([CorsMiddleware]);

// Restrict to one origin
app.use([CorsMiddleware.with({ origin: "https://app.example.com", credentials: true })]);

// Dynamic origin check
app.use([CorsMiddleware.with({ origin: (o) => o.endsWith(".mycompany.com") })]);
```

| Option           | Default        | Description                                                  |
| ---------------- | -------------- | ------------------------------------------------------------ |
| `origin`         | `'*'`          | Allowed origins — string, string[], or `(origin) => boolean` |
| `methods`        | all verbs      | Allowed HTTP methods                                         |
| `allowedHeaders` | common headers | Allowed request headers                                      |
| `exposedHeaders` | `[]`           | Headers JS may read from the response                        |
| `credentials`    | `false`        | Allow cookies / auth in cross-origin requests                |
| `maxAge`         | `600`          | Preflight cache duration (seconds)                           |

> **Danger** — Setting `origin: '*'` together with `credentials: true` is rejected by browsers
> and leaks cross-origin responses. Name an explicit origin (or use the function form) whenever
> you allow credentials.

### ThrottleMiddleware

Rate-limits requests with an in-memory sliding window counter. Returns `429`
with `Retry-After` and `X-RateLimit-*` headers when the limit is exceeded.

```ts fragment
// bootstrap/app.ts (global) and routes/index.ts (per-route)
import { ThrottleMiddleware } from "zerotal";

// Global: 120 requests / minute
app.use([ThrottleMiddleware.with({ maxAttempts: 120, windowSeconds: 60 })]);

// Per-route: 5 login attempts / minute
Router.post("/login", AuthController, "login", [
  ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 }),
]);

// By authenticated user ID instead of IP
ThrottleMiddleware.with({
  maxAttempts: 1000,
  windowSeconds: 3600,
  keyResolver: (ctx) => String(ctx.user?.id ?? ctx.ip()),
});
```

| Option           | Default     | Description                           |
| ---------------- | ----------- | ------------------------------------- |
| `maxAttempts`    | (required)  | Max requests in the window            |
| `windowSeconds`  | `60`        | Window length in seconds              |
| `keyResolver`    | IP address  | Function returning the rate-limit key |
| `trustedProxies` | `undefined` | Number of trusted upstream proxies    |

### RateLimiter — named limiters

For limits reused across routes (and queryable/resettable at runtime), define a
**named limiter** once at boot (e.g. in a `ServiceProvider`), then apply it by name.

```ts
// in a ServiceProvider (boot time)
import { RateLimiter } from "zerotal";

// 1000 req/hour per authenticated user (falls back to IP when unauthenticated)
RateLimiter.for("api").limit(1000).every(3600).byUser().register();

// 5 login attempts per minute, per IP
RateLimiter.for("login").limit(5).every(60).byIp().register();

// 500 req/min keyed by an API-key header (unknown key -> per IP)
RateLimiter.for("partner").limit(500).every(60).byApiKey("x-api-key").register();

// Custom key
RateLimiter.for("upload")
  .limit(10)
  .every(3600)
  .by((ctx) => `user:${ctx.user?.id ?? "anon"}`)
  .register();
```

Apply as route middleware with `RateLimiter.middleware(name)`:

```ts fragment
// routes/index.ts
Router.post("/login", AuthController, "login", [RateLimiter.middleware("login")]);

Router.group({ prefix: "/api", middleware: [RateLimiter.middleware("api")] }, () => {
  Router.get("/users", UserController, "index");
});
```

| Method               | Keys on                                       | Falls back to            |
| -------------------- | --------------------------------------------- | ------------------------ |
| `.byUser()`          | `ctx.user.id`                                 | IP when unauthenticated  |
| `.byApiKey(header?)` | `x-api-key` header (or custom)                | IP when header is absent |
| `.byIp()`            | Socket IP -> `X-Forwarded-For` -> `X-Real-IP` | `'unknown'`              |
| `.by(fn)`            | Return value of your function                 | -                        |

Check or reset a limiter manually — e.g. clear failed login attempts after a
successful sign-in:

```ts fragment
// in a controller action — `ctx` is the HttpContext the action receives
if (await RateLimiter.tooManyAttempts("login", ctx)) {
  return ctx.json({ message: "Too Many Requests" }, 429);
}

RateLimiter.resetFor("login", ctx); // clear the counter for this actor
```

> **Tip** — `ThrottleMiddleware.with({ … })` is inline and per-attachment; a named `RateLimiter`
> is defined once and can be reused, queried with `tooManyAttempts()`, and cleared with
> `resetFor()`. Use the inline form for one-off routes, the named form when the same limit
> appears in several places. See [Rate limiting](/docs/rate-limiting) for the full surface.

### SecureHeadersMiddleware

Adds `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and a
basic `Content-Security-Policy` to every response:

```ts fragment
// bootstrap/app.ts
import { SecureHeadersMiddleware } from "zerotal";
app.use([SecureHeadersMiddleware]);
```

It is registered for you as kernel middleware, so an app gets these headers
without asking. Configure them under `app.secureHeaders` in `config/app.ts` — see
[Configuration](/docs/config-system).

**Static files get the same headers**, even though no middleware runs for them.
Files under `public/` are handed to Bun as pre-registered responses and served
without entering JavaScript, so the pipeline never sees them; the header set is
baked into those responses at registration time instead. A per-directory header
passed to `Router.static()` still wins, so a mount that is deliberately
embeddable stays that way.

> **Tip** — Run [`bun zt doctor --url=…`](/docs/deployment) after deploying. A
> header your app sets and your proxy also sets is invisible from inside the
> process, and browsers disagree about which copy applies.

### WebhookMiddleware

Verifies HMAC-SHA256 signatures on incoming webhook requests:

```ts fragment
// routes/index.ts
import { WebhookMiddleware } from "zerotal";

Router.post("/webhooks/stripe", StripeController, "handle", [
  WebhookMiddleware.with({
    secret: Bun.env.STRIPE_WEBHOOK_SECRET!,
    header: "stripe-signature",
    algorithm: "sha256",
  }),
]);
```

> **Danger** — Keep the webhook `secret` in an environment variable, never hard-coded. A leaked
> secret lets anyone forge valid signatures and call your webhook endpoint.

## Middleware with constructor injection

Decorate the class with `@inject(...)`, listing its dependency tokens in
constructor order; the container resolves them and passes them in:

```ts fragment
// app/middleware/AuditMiddleware.ts
import { inject } from "zerotal";
import type { Pipe, NextFn, HttpContext } from "zerotal";

@inject(AuditLogger)
export class AuditMiddleware implements Pipe<HttpContext> {
  constructor(private logger: AuditLogger) {}

  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const response = await next();
    await this.logger.record(ctx.request.method, ctx.path(), ctx.user?.id);
    return response;
  }
}
```

## Execution order

Middleware nests like layers of an onion: outer layers run first on the way in,
and last on the way out (after `await next()`).

```text
Global (app.use)          ← outermost, first in / last out
  Provider auto-middleware  ← Session, Auth, etc.
    Switch middleware        ← CORS, Throttle, SecureHeaders
      Group middleware        ← Router.group({ middleware })
        Route middleware       ← Router.get(path, C, a, [M])
          Controller action    ← innermost
        ← route mw unwind
      ← group mw unwind
    ← switch mw unwind
  ← provider mw unwind      ← session saved here
← global mw unwind
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). Middleware has
two behaviours worth proving, and they are easy to confuse: what it does when it
lets a request **through**, and what it does when it **stops** one.

**Test the stop first**, because it is the reason the middleware exists:

```typescript fragment
// tests/http/middleware.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("a guest is turned away from a protected route", async () => {
  const app = await createApp();

  const res = await app.get("/dashboard");

  res.assertRedirect("/login");
  await app.close();
});
```

**Then prove it lets the right request through**, otherwise a middleware that
rejects everything passes the first test perfectly:

```typescript fragment
// tests/http/middleware.test.ts
const res = await app.actingAs(user).get("/dashboard");

res.assertOk();
```

**A middleware that transforms rather than blocks** is tested through its effect.
Register a probe route in the `setup` callback — `createTestApp(bootstrap, setup)`
runs it before the server starts, so the route compiles into the router:

```typescript fragment
// tests/http/middleware.test.ts
const app = await createApp(() => {
  Router.get("/probe", () => ({ locale: Context.get("locale") })).middleware([LocaleMiddleware]);
});

const res = await app.get("/probe", { "Accept-Language": "fr" });

res.assertJsonPath("locale", "fr");
```

> **Warning** — Middleware ordering is behaviour, not configuration. If auth must
> run before a rate limiter (so anonymous floods are cheap) or after it (so
> logins are throttled), write the test that fails when the order flips —
> reordering the array is a one-line change nobody reviews closely.

## References

Imported from `zerotal`.

| Member           | Signature                                                                           | Description                                                               |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Pipe<T>`        | `interface Pipe<T> { handle(payload: T, next: NextFn): Promise<Response \| void> }` | The contract every middleware implements (`T` is `HttpContext`).          |
| `NextFn`         | `type NextFn = () => Promise<Response \| void>`                                     | Passes control downstream; resolves to the downstream `Response`.         |
| `HttpContext`    | `class HttpContext<TParams>`                                                        | The request context passed to `handle` — read params from `ctx.params`.   |
| `withHeaders`    | `withHeaders(res: Response, headers: Record<string, string>): Response`             | Returns a copy of `res` with headers added (safe on immutable responses). |
| `BaseMiddleware` | `class BaseMiddleware<O> { static with(options: Partial<O>): new () => … }`         | Base class providing the `.with()` option-baking helper.                  |

Built-in middleware classes (`MiddlewareClass.with(options)` where noted):

| Class                     | Configure with                | Purpose                                            |
| ------------------------- | ----------------------------- | -------------------------------------------------- |
| `CorsMiddleware`          | `.with(CorsOptions)`          | Cross-origin resource sharing headers.             |
| `ThrottleMiddleware`      | `.with(ThrottleOptions)`      | In-memory sliding-window rate limiting.            |
| `SecureHeadersMiddleware` | `.with(SecureHeadersOptions)` | Security response headers (CSP, frame options, …). |
| `WebhookMiddleware`       | `.with(WebhookOptions)`       | HMAC signature verification for webhooks.          |

Named rate limiters via `RateLimiter`:

| Method                                               | Signature                                                           | Description                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `RateLimiter.for`                                    | `for(name: string): LimiterDefinition`                              | Start defining a named limiter.                   |
| `RateLimiter.middleware`                             | `middleware(name: string): ThrottleMiddleware`                      | Get the middleware for a registered limiter.      |
| `RateLimiter.tooManyAttempts`                        | `tooManyAttempts(name: string, ctx: HttpContext): Promise<boolean>` | Record a hit and report whether the limit is hit. |
| `RateLimiter.resetFor`                               | `resetFor(name: string, ctx: HttpContext): void`                    | Clear the counter for this actor's key.           |
| `LimiterDefinition.limit`/`.every`                   | `limit(max): this` / `every(seconds): this`                         | Set the window size and length.                   |
| `LimiterDefinition.byUser`/`.byIp`/`.byApiKey`/`.by` | `byUser(): this` / `byApiKey(header?): this` / `by(fn): this`       | Choose the key strategy.                          |
| `LimiterDefinition.register`                         | `register(): this`                                                  | Register the limiter with the global registry.    |

## Next steps

- [Routing](/docs/routing) — attach middleware to routes and groups.
- [Lifecycle](/docs/lifecycle) — where middleware sits in the request flow.
- [Controllers](/docs/controllers) — move route logic out of closures.
- [Rate limiting](/docs/rate-limiting) — named limiters in depth.
