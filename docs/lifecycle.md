---
title: Request Lifecycle
description: Understand the boot and per-request lifecycles so your logic runs in the right place.
---

# Request Lifecycle

A Zerotal app has **two lifecycles** — one that runs once at startup and one that
runs for every request. Keeping them straight is the key to putting logic in the
right place.

- **The boot lifecycle** runs **once**, when the server starts. It wires
  everything together — binds services, loads routes, scans your `app/*`
  directories — and then opens the socket. One-time setup belongs here, in a
  provider hook.
- **The request lifecycle** runs **for every incoming request**. It opens a
  per-request scope, walks the middleware pipeline to your controller, builds a
  response, and tears the scope back down. Per-request work belongs here, in
  middleware, a controller, or an after-response hook.

If you only remember one thing: _boot is for the app, request is for the
visitor._

## Mental model

Two clocks tick at different rates. The boot clock ticks once — everything it
sets up (container bindings, routes, the compiled route table) is shared by every
request that follows. The request clock ticks on each visit and gets its own
isolated scope, so concurrent requests never share state.

```
boot clock  ──tick── (server starts: bind, load routes, open socket)
                          │
request clock ───────────┼── tick (GET /a)  → scope A → response → flush A
                          ├── tick (GET /b)  → scope B → response → flush B
                          └── tick (POST /c) → scope C → response → flush C
```

## Boot lifecycle

Booting starts from the two files you own — `bootstrap/app.ts` (where you
configure the app, declaratively) and the managed `zt.ts` entry point (which
imports it and calls `start()`). From there `Application.boot()` runs a fixed
sequence, **once**, and is idempotent (a second call does nothing):

```text
# boot sequence (overview)
bootstrap/app.ts            ← you configure the app (declarative)
  Application.create({ providers })
    .bind((container) => …)        ← optional: register container bindings
    .routing({ … })                ← declare explicit route files
    .fileBasedRouting({ … })       ← declare route directories
    .use([ …middleware ])          ← register global middleware
  └─ exports `app`
        │
        ▼
zt.ts (managed)         ← imports bootstrap/app.ts, then: app.start(port)
        │
        ▼
app.boot()   ── runs once, idempotent ───────────────────────────────────
   1. bind core singletons        `config`, `events`
   2. load config                 scan `config/*.ts` (unless preloaded)
   3. discover providers          scan `app/providers/*`
   4. run app.bind() callbacks    your bootstrap bindings
   5. onRegister()   each, sync          providers bind their services
   6. onBooting()    each, in order      providers prepare; may use earlier ones
   7. onBooted()     all, in parallel    every binding is now resolvable
   8. discover middleware         scan `app/middleware/*`
   9. load routes                 routing() + fileBasedRouting() files run
  10. convention phase            scan app/{models, observers, policies, listeners,
                                  events, jobs, services, validators}; serve public/
        │
        ▼
app.start()  ── continues ────────────────────────────────────────────────
  11. onStarting()   each               last chance before the socket opens
  12. Bun.serve()                       server binds and starts listening
  13. onStarted()    each               health endpoint, PID file, signal handlers
```

The three provider phases (steps 5–7) are the part you'll touch most. They're
**ordered for a reason**: `onRegister()` only _binds_ (nothing is resolved yet),
`onBooting()` runs **sequentially** so a later provider can depend on an earlier
one, and `onBooted()` runs in **parallel** once every binding exists — so it's the
safe place to resolve services that depend on other providers. See
[Provider lifecycle hooks](#provider-lifecycle-hooks) below.

> **Tip** — _Bind in `onRegister()`, resolve in `onBooted()`_ is the rule that
> avoids 90% of ordering bugs.

The convention phase (step 10) scans the `app/*` directories and registers what it
finds — models, observers, policies, listeners, jobs, services, validators.
Providers declare which directories get scanned via `this.app.registerConcern(...)`.
See [Conventions](/docs/conventions).

## Request lifecycle

Now the per-request path. Every request gets its **own isolated scope** — created
when it arrives, flushed when it leaves — so concurrent requests never share
state. The route table was already compiled at boot, so matching is a fast lookup,
not a re-scan:

```text
# per-request flow
Bun.serve() receives Request
        │
        ▼
  compiled route table lookup
  → match path + method → RouteDefinition
        │
        ├── no match → 404 NotFoundError → ExceptionHandler.render()
        │
        ▼
  createRouteHandler(definition, container)
        │
        ▼
  ScopedResolver created       ← request-scoped DI scope
  HttpContext created           ← ctx.requestId, ctx.startedAt, ctx.url, …
  RequestContext.run(ctx, fn)   ← AsyncLocalStorage stores ctx for this async tree
        │
        ▼
  Model bindings resolved       ← the model's resolver / .bind() runs
  ctx._models populated
        │
        ▼
  Pipeline runs (middleware chain):
  [global middleware] → [group middleware] → [route middleware] → controller action
        │
        ├── any middleware can short-circuit by returning a Response (or setting ctx.response)
        │
        ▼
  Controller action executes
  → sets ctx.response (via ctx.json(), ctx.view(), ctx.redirect(), etc.)
        │
        ▼
  Pipeline unwinds (finally blocks in middleware run here — e.g. SessionMiddleware saves)
        │
        ▼
  ctx.response returned to Bun.serve()
        │
        ▼
  afterResponse callbacks fire  ← ctx.afterResponse(() => sendEmail())
        │
        ▼
  ScopedResolver.flush()        ← request-scoped bindings disposed
```

## Middleware execution order

Middleware nests: the outermost layer runs first on the way in and last on the way
out. The list below reads top-to-bottom as the order requests enter, then unwinds
in reverse as responses leave:

```text
# nesting order (outer → inner)
Global (app.use)
  └── Provider auto-registered (SessionMiddleware, AuthMiddleware, …)
        └── Switch middleware (withCors, withThrottle, withSecureHeaders)
              └── Group middleware (Router.group({ middleware: [...] }))
                    └── Route middleware (Router.get('/...', C, 'a', [M]))
                          └── Controller action
                    ┌── (unwind)
              ┌── (unwind)
        ┌── (unwind — session saved here)
  ┌── (unwind)
```

Middleware wraps the next step — `await next()` is where the inner layers
run. Code before `next` runs on the way in; code after runs on the way out.
`next()` resolves to the downstream `Response`.

```typescript
// app/middleware/TimingMiddleware.ts
import type { HttpContext } from "zerotal";
import type { Pipe, NextFn } from "zerotal";

export class TimingMiddleware implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const start = performance.now();
    const response = await next(); // ← inner layers run here
    console.log(`${ctx.path()} took ${Math.round(performance.now() - start)}ms`);
    return response;
  }
}
```

## Exception handling

If any middleware or controller throws, the pipeline catches the error and calls
the exception handler — first to report it, then to turn it into a `Response`:

```text
# on an unhandled throw
ExceptionHandler.report(err, ctx)   ← log / Sentry / whatever
ExceptionHandler.render(err, ctx)   → Response
```

The response is sent to the client, and `afterResponse` callbacks still fire.

In production, raw 500 errors show a minimal "Internal Server Error" page.
In dev, unhandled exceptions show a full stack-trace page. See
[Error Handling](/docs/errors) for custom handlers.

## AsyncLocalStorage context

`RequestContext` stores the request's `HttpContext` in an `AsyncLocalStorage` so
that any code running inside the async tree of a request — facades, services, ORM
models — can reach the current context without prop-drilling:

```typescript
// in a service, anywhere in the async tree
import { RequestContext } from "zerotal";

const ctx = RequestContext.tryGet(); // HttpContext | undefined
const user = ctx?.user;
```

> **Note** — Use `RequestContext.tryGet()` (returns `undefined` outside a request)
> for code that runs in both request and non-request contexts — CLI commands,
> queue workers, scheduled jobs. Use `RequestContext.get()` when you want it to
> throw if there is no active request.

Facades like `Auth` and `Config` use this internally. You rarely need to access
`RequestContext` directly.

## Provider lifecycle hooks

A provider can hook into any step of the boot and shutdown sequence by overriding
these methods. The three most-used ones map to boot steps 5–7 above; the rest
bracket the server starting and stopping.

| Hook           | When it runs                            | Typical use                                   |
| -------------- | --------------------------------------- | --------------------------------------------- |
| `onRegister()` | Boot step 5 — sync, nothing resolved    | `container.singleton()`, `Router.macro()`     |
| `onBooting()`  | Boot step 6 — sequential, in order      | Prepare a service that a later provider needs |
| `onBooted()`   | Boot step 7 — parallel, all bound       | Resolve cross-provider deps, warm singletons  |
| `onStarting()` | Just before the socket opens            | Final pre-flight checks                       |
| `onStarted()`  | After the server is listening           | Start background timers / workers             |
| `onStopping()` | Graceful shutdown, reverse order        | Release resources, flush buffers              |
| `onStopped()`  | After shutdown completes, reverse order | Final cleanup                                 |

Providers can also observe **every request** without registering middleware —
`onRequestReceived()` (before the pipeline runs), `onRequestProcessed()` (after
the pipeline sets `ctx.response`), and `onResponseSent()` (after the response is
sent). The full phase reference lives in
[The Application](/docs/application) and [Service Providers](/docs/providers).

```typescript
// app/providers/PaymentProvider.ts
import { ServiceProvider } from "zerotal";

export class PaymentProvider extends ServiceProvider {
  onRegister(): void {
    this.app.container.singleton(
      PaymentGateway,
      () => new StripeGateway({ key: Bun.env.STRIPE_KEY! }),
    );
  }

  async onBooted(): Promise<void> {
    const gw = await this.app.container.make(PaymentGateway);
    gw.setWebhookSecret(Bun.env.STRIPE_WEBHOOK_SECRET!);
  }
}
```

> **Warning** — Do not resolve services in `onRegister()`. Nothing is resolvable
> yet at that phase — only _bind_ there, and resolve in `onBooted()` once every
> provider has registered its bindings.

## Which hook should I use?

- **Registering a binding (singleton, macro, alias)** → `onRegister()`. It runs
  first and only binds; nothing is resolved.
- **Preparing a service a _later_ provider depends on** → `onBooting()`. It runs
  sequentially in registration order, so earlier providers are already booting.
- **Resolving a service that spans providers, or warming a singleton** →
  `onBooted()`. Every binding exists by now and these run in parallel.
- **Opening a socket / starting timers after the server is up** → `onStarted()`.
- **Releasing resources on shutdown** → `onStopping()` / `onStopped()` (reverse
  order).
- **Observing each request without owning a middleware slot** →
  `onRequestReceived()` / `onRequestProcessed()` / `onResponseSent()`.

## Reference

Boot and shutdown phases in order, and the per-request hook surface.

| Phase / hook           | Runs                         | Concurrency         |
| ---------------------- | ---------------------------- | ------------------- |
| `onRegister()`         | Boot — bind services         | Sync, sequential    |
| `onBooting()`          | Boot — prepare services      | Async, sequential   |
| `onBooted()`           | Boot — every binding ready   | Async, parallel     |
| `onStarting()`         | Before `Bun.serve()` binds   | Async, parallel     |
| `onStarted()`          | After server is listening    | Async, parallel     |
| `onStopping()`         | Graceful shutdown            | Async, reverse      |
| `onStopped()`          | After shutdown completes     | Async/sync, reverse |
| `onRequestReceived()`  | Per request, before pipeline | Async, parallel     |
| `onRequestProcessed()` | Per request, after pipeline  | Async, parallel     |
| `onResponseSent()`     | Per request, after response  | Async, parallel     |

## Next steps

- [Providers](/docs/providers) — register and boot services.
- [Middleware](/docs/middleware) — the request pipeline in depth.
- [Container](/docs/container) — dependency injection and scopes.
- [Conventions](/docs/conventions) — auto-registration of app directories.
- [HttpContext](/docs/context) — the per-request object and its helpers.
