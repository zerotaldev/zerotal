---
title: The Application
description: Understand the kernel that owns the container, runs the provider lifecycle, and takes you from boot to a running server.
---

# The Application

The `Application` is the heart of every Zerotal project: the IoC container's owner,
the service-provider registry, the route loader, and the lifecycle engine that
takes you from `bun zt serve` to a running HTTP server. You construct it once
in `bootstrap/app.ts`, and the framework drives it the rest of the way.

Think of it as the **assembly line and the conductor** rolled into one. When the
app starts it walks a fixed sequence of phases — register everything, boot it,
start the server — and at each phase it gives your providers a chance to hook in.
The container holds the _services_; the Application decides _when_ they get wired
up, _when_ routes load, and _when_ the server opens for traffic.

In practice you touch a small slice of this. `bootstrap/app.ts` is a short,
mostly-declarative file: create the app, point it at your routes, and (optionally)
register a binding or two. Almost everything else — discovering providers, loading
config, scanning conventions — happens automatically. The rest of this page
explains what's happening behind that file, and the handful of methods you'll
actually call.

## Mental model

The app is created once and exposed as a singleton. Every configuration method
(`routing`, `bind`, `defer`, `use`, `withExceptionHandler`, …) returns the same
instance, so in real code they chain straight onto `Application.create(...)`:

```text
                 ┌──────────────────────────────────────────┐
 bootstrap/app.ts│  Application.create()                     │
                 │     .bind(...).routing(...).use(...)       │  ← config methods chain
                 └──────────────────┬───────────────────────┘
                                    │  start() / boot() / bootAsWorker()
                                    ▼
   ┌─────────┐   ┌─────────┐   ┌────────┐   ┌──────────┐   ┌─────────┐
   │ Register│ → │ Booting │ → │ Booted │ → │ Starting │ → │ Started │
   └─────────┘   └─────────┘   └────────┘   └──────────┘   └─────────┘
     phase 1       phase 2       phase 3       phase 4        phase 5
   onRegister    onBooting     onBooted      onStarting     onStarted
                              + routes load               (Bun.serve live)
```

> **Note** — wherever this page shows a bare `app`, it means _this_ instance: the
> one `Application.create()` returns and `bootstrap/app.ts` exports.

## Import

```typescript
// bootstrap/app.ts
import { Application } from "zerotal";
```

## Creating the application

`Application.create()` builds the singleton instance and returns it. Call it once
in `bootstrap/app.ts` — no providers or config arguments needed; both are
discovered automatically at boot:

```typescript
// bootstrap/app.ts
import { Application, basePath } from "zerotal";

export default Application.create().routing({ web: basePath("routes/web.ts") });
```

There is one application per process; once `create()` has run, the `currentApp()`
helper reaches it anywhere.

> **Note** — `Application.create({ providers })` and
> `Application.create({ providers, config, env })` accept explicit providers and
> config for lightweight in-process test setups that bypass auto-discovery. See
> [Testing](/docs/testing).

### The current application

```typescript
import { currentApp } from "zerotal";

// anywhere after create() has run
const app = currentApp(); // throws if create() hasn't run yet
```

Calling `create()` a second time is an error — retrieve the running app with
`currentApp()`. Tests reset the process between cases with
`Application._resetInstance()`.

The configuration methods (`defer`, `use`, `routing`, `withExceptionHandler`, …)
each return `app`, so in real code they're usually chained directly onto
`Application.create(...)` rather than called on a stored variable.

## Configuration

An application needs its config loaded before providers boot. There are three ways
to supply it, and they compose cleanly.

The framework default is **zero-config auto-discovery**: if you never call
`useConfig()` and never pass `config` to `create()`, `boot()` scans
`<cwd>/config/*.ts` and loads each file's default export under its filename
(`config/app.ts` → the `app` namespace). Files that throw on import (e.g. a
missing env var) are skipped rather than crashing the boot.

To load config explicitly, use `configLoader()` and pass it to `useConfig()`:

```typescript
// bootstrap/app.ts
import { Application } from "zerotal";
import { configLoader } from "zerotal/config";

Application.create().useConfig(configLoader("./config"));
```

`useConfig()` accepts a `ConfigLoader`, the generated configs barrel, or a raw
`{ namespace: { ... } }` map. If config was already provided via
`Application.create({ config })`, this call is **ignored** (create wins). The
managed `zt.ts` always calls `useConfig()` for you — in normal app usage you
never need to call it directly.

See [Configuration](/docs/config-system) for the config files themselves.

### Which config path should I use?

- **Do nothing** — let zero-config auto-discovery scan `config/*.ts`. This is the
  right choice for almost every app.
- **`useConfig(configLoader(...))`** — when you need an explicit config directory
  or want to pre-load before providers boot.
- **`create({ config })`** — for in-process tests that bypass file discovery.

## Registering providers

Providers are discovered automatically — you do not need to list them. At boot,
before the register phase, the application scans `app/providers/*` and
instantiates every `ServiceProvider` subclass it finds, running each through the
full lifecycle.

Create a provider and place it under `app/providers/`:

```typescript
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";

export class AppServiceProvider extends ServiceProvider {
  onRegister(): void {
    // bind services into the container
  }
}
```

That file is picked up automatically — no manual registration required. See
[Service Providers](/docs/providers) for the full provider API and lifecycle
hooks.

### Package providers

Framework packages (`@zerotal/orm`, `@zerotal/auth`, `@zerotal/notifications`, …) ship
their own providers. List them in the **providers array** in
`bootstrap/providers.ts` and pass that array to `Application.create({ providers })`:

```typescript
// bootstrap/providers.ts
import { DatabaseProvider } from "@zerotal/orm";
import { AuthProvider } from "@zerotal/auth";
import { AppServiceProvider } from "../app/providers/AppServiceProvider.ts";

const providers = [DatabaseProvider, AuthProvider, AppServiceProvider];

export default providers;
```

```typescript
// bootstrap/app.ts
import { Application, basePath } from "zerotal";
import providers from "./providers.ts";

export default Application.create({ providers }).routing({ web: basePath("routes/web.ts") });
```

> **Note** — When one package depends on another, prefer declaring it on the class
> with `static dependsOn` rather than relying on list order — the dependency is then
> pulled in and booted first automatically, so the app only lists the features it
> uses. Registration is idempotent, so listing a provider that's also pulled in via
> `dependsOn` is harmless. See [Declaring dependencies](/docs/providers#declaring-dependencies).

### Deferred providers

A deferred provider boots lazily — only the first time one of its container
bindings is resolved. This keeps cold-start fast when a service isn't used on
every request.

```typescript
// bootstrap/app.ts — defer() is called on the app instance (and returns it)
const app = Application.create({ providers });

// Single token
app.defer("cache", CacheProvider);

// Object map
app.defer({ cache: CacheProvider, mail: MailProvider });

// Array — each provider must declare `static provides = ['token'] as const`
app.defer([CacheProvider, MailProvider, QueueProvider]);
```

Providers whose `static environments` list doesn't include the current runtime
mode are filtered out before they ever instantiate, so a `web`-only provider never
boots inside a `worker`. See [Conventions](/docs/conventions) for how the scanner
works.

## Registering services without a provider

A provider is the right tool when bootstrapping is involved — lifecycle hooks,
config-driven wiring, middleware. But when you just need to register a binding or
two, that's a lot of ceremony. For those cases, `bind()` lets you register
straight from `bootstrap/app.ts`:

```typescript
// bootstrap/app.ts
import { Application, basePath } from "zerotal";
import { Clock, SystemClock } from "../app/services/clock.ts";

export default Application.create({ providers })
  .bind((container) => {
    container.singleton(Clock, () => new SystemClock());
  })
  .fileBasedRouting({ web: basePath("app/flow/pages") });
```

The callback receives the live container and runs once at boot — **after** the
core singletons are bound and **before** any provider's `onRegister()`, so a
provider can still override what you register here. It's the natural home for
**interface → implementation** bindings (binding a `Clock` contract to a
`SystemClock`), which a self-registering service class can't express on its own.

This is one of three lighter-than-a-provider paths, alongside the `app/services`
convention and the `App` facade. For the full picture — including when to pick
each — see [App-level dependency injection](/docs/container#app-level-dependency-injection).

> **Tip** — to _resolve_ a service anywhere in your app (a page, a controller, a
> job), use the [`App` facade](/docs/container#the-app-facade):
> `await App.make(MyService)`, or the `make()` / `app()` global helpers. You
> rarely need `currentApp()` directly.

## Routing

Declare where your routes live; the application loads them at boot, after every
provider has registered its middleware groups (so a route file can always
reference `web`, `api`, or any provider-supplied group).

```typescript
// bootstrap/app.ts
Application.create().routing({
  web: "./routes/web.ts",
  api: "./routes/api.ts",
});
```

`web` and `api` have built-in defaults — `web` mounts at `/` with the `web`
middleware group, `api` mounts at `/api` with the `api` group. Any other group
name must declare both `prefix` and `middleware` explicitly (or an error is thrown
at boot):

```typescript
// bootstrap/app.ts
.routing({
  web: "./routes/web.ts",
  admin: { file: "./routes/admin.ts", prefix: "/admin", middleware: ["web", "auth"] },
})
```

For directory-based routing, use `fileBasedRouting()` — same key semantics, but
each value is a directory that's scanned for exported HTTP-method handlers:

```typescript
// bootstrap/app.ts
Application.create().fileBasedRouting({ web: "./app/routes" });
```

Use [`basePath()`](/docs/helpers#basepath) to anchor these paths to the project
root regardless of the calling file.

## Middleware

Register global middleware that runs on every request, in array order:

```typescript
// bootstrap/app.ts
import { CorsMiddleware, SecureHeadersMiddleware } from "zerotal";

Application.create().use([SecureHeadersMiddleware, CorsMiddleware]);
```

The resolved pipeline runs provider-registered middleware first, then everything
you added via `.use()`. You can read the final ordering back off the app instance
(handy in a test or a diagnostic):

```typescript
// in a test or diagnostic
currentApp().globalMiddleware; // PipeClass[] in execution order
```

Middleware discovered from `app/middleware/*` is registered as a named group keyed
by class name (so it isn't global by default); add `static global = true` to a
class to push it onto the global pipeline automatically. See
[Middleware](/docs/middleware).

> **Note** — `useOnce()` registers a middleware idempotently and is what providers
> use internally to guarantee their required middleware is present exactly once.
> You generally won't call it directly.

## Other wiring

These are the remaining configuration methods, all called on the app instance in
`bootstrap/app.ts` (and all returning it, so they chain):

```typescript
// bootstrap/app.ts
import { Handler } from "../app/exceptions/Handler.ts";

const app = Application.create({ providers });

// Custom exception handler for all unhandled route errors
app.withExceptionHandler(Handler);

// Resolve the authenticated user from a session id (usually automatic — see Auth)
app.withUserResolver((id) => User.find(id));

// Register WebSocket handlers (used by the broadcasting provider)
app.withWebSocket(handlers, (req) => ({ userId: tokenFrom(req) }));

// Contribute a convention descriptor (used by packages, not apps)
app.registerConcern(myConcern);
```

Each of these returns `app`, so in practice they chain straight onto
`Application.create(...)` rather than being called on a stored variable.

## How the lifecycle works

You normally call exactly one of `start()`, `bootAsWorker()`, or `boot()`; the
managed `zt.ts` picks the right one based on the command. Each drives the
provider hooks through a fixed set of phases.

`boot()` runs phases 1–3 and is idempotent (a second call is a no-op):

1. **Register** — config and core singletons (`config`, `events`) are bound;
   `app/providers/*` is discovered; each provider's synchronous `onRegister()`
   runs.
2. **Booting** — each provider's `onBooting()` runs sequentially, in registration
   order, so later providers can depend on earlier ones.
3. **Booted** — every provider's `onBooted()` runs concurrently. Then middleware
   is discovered, route files load, and the convention phase registers models,
   observers, policies, listeners, jobs, and validators.

`start(port = 3000)` boots (if needed) then runs phases 4–5 and binds the server:

4. **Starting** — `onStarting()` on every provider, before the socket opens.
5. **Started** — `Bun.serve()` is live; `onStarted()` fires. A health endpoint, a
   PID file, and `SIGTERM`/`SIGINT`/`SIGUSR2` handlers are installed.

```typescript
// zt.ts (managed) ultimately does:
const app = (await import("./bootstrap/app.ts")).default;
await app.start(Number(env("PORT", 3000)));
```

`bootAsWorker()` forces `worker` mode, boots, and runs the `starting`/`started`
phases without binding an HTTP server — used by the queue worker. On shutdown it
drains providers in reverse (LIFO) order.

`stop()` runs the teardown phases in LIFO order:

6. **Stopping** — `onStopping()` on each provider, newest first.
7. **Stopped** — `onStopped()` on each, the PID file is removed, and the process
   exits.

### Which entry point should I use?

- **`start(port?)`** — the normal web server. Boots, binds `Bun.serve()`, installs
  signal handlers.
- **`bootAsWorker()`** — the queue worker. Boots in `worker` mode with no HTTP
  socket.
- **`boot()`** — phases 1–3 only, no server. Useful in tests and one-off scripts
  that need the container wired but no listening port.

### Per-request provider hooks

Beyond the boot phases, providers can observe every request without registering
middleware. The application calls `onRequestReceived` before the pipeline,
`onRequestProcessed` after `ctx.response` is set, and `onResponseSent` after the
response has been flushed to the client. These power telemetry, request logging,
and similar cross-cutting concerns.

### Zero-downtime route reload

In development, sending `SIGUSR2` to the server re-runs your route files with
cache-busting imports and hot-swaps the compiled route table with no dropped
connections. The dev server wires this up for you on file change.

## References

| Member                                   | Purpose                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `Application.create()`                   | Create the process's application. Providers and config are auto-discovered. |
| `currentApp()`                           | Return the current application (throws if not created).                     |
| `.register(providers)`                   | Add providers.                                                              |
| `.bind(callback)`                        | Register container bindings at boot, without a provider.                    |
| `.defer(token \| map \| array)`          | Register providers that boot lazily on first resolution.                    |
| `.useConfig(input)`                      | Pre-load config (ignored if `create({ config })` was used).                 |
| `.routing(config)`                       | Declare explicit route files per named group.                               |
| `.fileBasedRouting(config)`              | Declare file-route directories per named group.                             |
| `.use(middleware)`                       | Add global middleware (array order).                                        |
| `.withExceptionHandler(Handler)`         | Set the handler for unhandled errors.                                       |
| `.withUserResolver(fn)`                  | Set the session → user loader.                                              |
| `.withWebSocket(handlers, upgradeData?)` | Enable the WebSocket protocol.                                              |
| `.registerConcern(descriptor)`           | Contribute a convention descriptor (packages).                              |
| `.globalMiddleware`                      | Read the resolved global pipeline.                                          |
| `.environment`                           | The runtime environment (`web`, `worker`, `console`, …).                    |
| `.booted`                                | Whether `boot()` has completed.                                             |
| `.boot()`                                | Phases 1–3 (idempotent).                                                    |
| `.start(port?)`                          | Boot then bind the HTTP server (phases 4–5).                                |
| `.bootAsWorker()`                        | Boot in `worker` mode, no HTTP server.                                      |
| `.stop()`                                | Teardown (phases 6–7) and exit.                                             |
| `.container`                             | The IoC [container](/docs/container).                                       |
| `.routerState`                           | The router state owned by this app.                                         |

## Next steps

- [Service Container](/docs/container) — the IoC container the application owns.
- [Service Providers](/docs/providers) — the unit of bootstrapping.
- [Conventions](/docs/conventions) — auto-discovery of providers, models, and more.
- [Request Lifecycle](/docs/lifecycle) — how a request flows through the pipeline.
- [Configuration](/docs/config-system) — config files and the `config()` helper.
