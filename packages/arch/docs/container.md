---
title: Service Container
description: Register how each object is built once, then resolve it by name with dependencies wired automatically.
---

# Service Container

The service container is the part of Zerotal that **builds your objects for you**:
you describe how to construct something once, then ask for it by name and it wires
up the dependencies.

Most classes need other things to do their job: a repository needs a database
connection, a mailer needs an API key, a service needs a logger. Wiring all of
that by hand — `new PostRepository(new CacheManager(config), new Logger())` —
gets tedious and couples every caller to the exact construction details. The
container takes that job over: you tell it _how_ to build something once, and from
then on you just ask for it by name. It figures out the dependencies, builds them
in the right order, and hands you a finished object.

This is **dependency injection**: your classes declare _what_ they need, and the
container supplies it — instead of each class reaching out and constructing its
own dependencies. The payoff is testability (swap a real mailer for a fake one in
one line) and decoupling (a class depends on a `Mailer` contract, not on
`SendGridMailer`).

> **Note** — Do I need to learn all of this? Not up front. In everyday app code
> you'll mostly _resolve_ services with [`App.make()`](#app-level-dependency-injection)
> or let [`@inject()`](#auto-wiring-with-inject) wire them for you, and _register_
> the occasional one with the [`app/services` convention](#app-level-dependency-injection).
> The lifetimes, contextual bindings, aliases, and hooks below are there when you
> need finer control — reach for them as the need arises, not before.

## Accessing the container

Inside a `ServiceProvider`, the container lives at `this.app.container`:

```typescript
// in a ServiceProvider method
this.app.container.singleton(CacheManager, () => new CacheManager());
const cache = await this.app.container.make(CacheManager);
```

Anywhere else, reach it through the application singleton:

```typescript fragment
// in application code outside a provider
import { Application } from "zerotal";

const container = currentApp().container;
const cache = await container.make(CacheManager);
```

> **Tip** — In application code, prefer [`@inject()`](#auto-wiring-with-inject) so the
> container wires dependencies for you, or the [`App` facade](#app-level-dependency-injection)
> (`App.make(...)`) for terse access — reaching for `currentApp()` is a
> last resort.

> **Note** — Reading the examples: a code block that opens with
> `this.app.container.…` is inside a `ServiceProvider`. A block that uses a bare
> `container.…` assumes you already obtained it one of the two ways above. Blocks
> that belong in a specific file (`bootstrap/app.ts`, `app/services/…`) say so in a
> comment on the first line.

## Binding lifetimes

A _lifetime_ answers one question: **when you ask for this thing twice, do you get
the same instance or a new one?** That's the only real decision when registering a
binding, and it comes down to whether the object holds state and who that state
belongs to.

**Which should I use?**

- Reach for **singleton** by default for services — a database manager, a cache,
  an HTTP client. They're expensive to build, safe to share, and you want one of
  them. This is the most common choice.
- Use **scoped** when the object carries data that belongs to _one request_ and
  must never bleed into another — the current user, a per-request "unit of work",
  a request-id. Each request gets its own; concurrent requests stay isolated.
- Use **transient** for cheap, stateless, or deliberately short-lived objects
  where sharing would be surprising — a fresh report builder per call.
- Use **value** when you already _have_ the finished object and just want the
  container to hand it back — a config blob, a pre-configured SDK client.

When in doubt, start with singleton; move a binding to scoped only once you find
it holding per-request state.

| Lifetime  | Method        | Instances created               | Use for                                |
| --------- | ------------- | ------------------------------- | -------------------------------------- |
| Singleton | `singleton()` | Once per application            | Shared, stateful services (cache, db)  |
| Scoped    | `scoped()`    | Once per HTTP request           | Per-request state (current user, cart) |
| Transient | `bind()`      | Every `make()` call             | Stateless or short-lived objects       |
| Value     | `value()`     | Never — you supply the instance | Config objects, pre-built clients      |

### Singleton

Created once, then cached for the lifetime of the application. Every caller gets
the same instance. The factory receives the container so it can resolve its own
dependencies:

```typescript
// in a ServiceProvider's onRegister()
this.app.container.singleton(CacheManager, async (c) => {
  const cfg = await c.make("config");
  return new CacheManager(cfg.get("cache"));
});
```

Singleton resolution is **concurrency-safe**: if two requests resolve the same
unresolved singleton at the same time, the factory runs exactly once and the
second caller awaits the same in-flight promise.

### Scoped

Created once per HTTP request and isolated between concurrent requests via
`AsyncLocalStorage`. Resolving a scoped binding outside of a request context
throws `ScopedOutsideRequestError`:

```typescript
// in a ServiceProvider's onRegister()
this.app.container.scoped(UserSession, (c) => new UserSession());
```

### Transient

A fresh instance on every `make()`:

```typescript
// in a ServiceProvider's onRegister()
this.app.container.bind(ReportGenerator, () => new ReportGenerator());
```

### Value

Bind a pre-built instance directly — no factory, no lazy construction:

```typescript
// in a ServiceProvider's onRegister()
this.app.container.value("config", configObject);
```

## Registering bindings

Bindings are registered in a `ServiceProvider`'s `onRegister()`:

```typescript fragment
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";
import { CacheManager } from "../services/CacheManager.ts";
import { PaymentGateway } from "../services/PaymentGateway.ts";

export class AppServiceProvider extends ServiceProvider {
  onRegister(): void {
    // Singleton — shared across all requests
    this.app.container.singleton(CacheManager, async (c) => {
      const cfg = await c.make("config");
      return new CacheManager(cfg.get("cache"));
    });

    // Scoped — isolated per request
    this.app.container.scoped(PaymentGateway, async (c) => {
      const cfg = await c.make("config");
      return new PaymentGateway(cfg.get("stripe.secret"));
    });
  }
}
```

> **Warning** — `onRegister()` is synchronous and runs before any binding is resolved.
> Register here; **resolve** in `onBooted()`, once every provider has registered. See
> [Service Providers](/docs/providers).

## App-level dependency injection

Everything above is the container's full API, mostly used by framework packages
inside providers. For your own application services you rarely need that
machinery — a full `ServiceProvider` is overkill for one class. These are the
lighter, everyday paths, all backed by the same container.

**Which one should I use?** Match the path to what you're doing:

- **Just need to _use_ a service?** Resolve it — [`App.make(MyService)`](#the-app-facade)
  or `@inject(MyService)` on the class that depends on it. No registration needed
  for a plain class; the container auto-wires it.
- **Want a service to be a shared singleton?** Drop it in `app/services/` and add
  [`static lifetime = "singleton"`](#the-appservices-convention). Zero wiring.
- **Binding a contract to an implementation** (e.g. `Mailer` → `SendGridMailer`),
  or doing setup that doesn't belong next to a single class? Use the
  [bootstrap `bind()` callback](#bootstrap-bind-callback).
- **Genuinely complex bootstrapping** — config-driven wiring, lifecycle hooks,
  middleware registration? _Then_ write a [`ServiceProvider`](/docs/providers).

As a rule of thumb: start with the convention, graduate to `bind()` when a class
can't register itself, and only reach for a provider when you need lifecycle hooks.

### The App facade

`App` is the canonical surface for application code — resolve from anywhere
(pages, controllers, jobs) without importing `Application`:

```typescript fragment
// in a controller, page, or job
import { App } from "zerotal";
import { UsersService } from "@app/services/users-service.ts";

const users = await App.make(UsersService); // auto-wired
const events = await App.make("events"); // named binding
```

It also exposes registration (`bind`, `singleton`, `scoped`, `value`, `alias`,
`forget`), introspection (`bound`, `container`, `instance()`), and environment
helpers (`environment()`, `isProduction()`, `isLocal()`). The `make()` and
`app()` global helpers are shorthands:

```typescript fragment
// in application code
import { make, app } from "zerotal";

const users = await make(UsersService); // = App.make(UsersService)
const kernel = app(); // the Application instance
const same = await app(UsersService); // = make(UsersService)
```

### Bootstrap `bind()` callback

Register bindings in `bootstrap/app.ts` without a provider. The callback runs at
boot, before any provider's `onRegister()`, so providers can still override:

```typescript fragment
// bootstrap/app.ts — the callback receives the live container
Application.create({ providers })
  .bind((container) => {
    container.singleton(Clock, () => new SystemClock());
    container.for(ReportService).give(Clock, () => new FixedClock()); // contextual
  })
  .fileBasedRouting({ web: basePath("app/flow/pages") });
```

This is the place for **interface → implementation** bindings, since a class
can't register itself against a different token:

```typescript fragment
// bootstrap/app.ts
Application.create({ providers }).bind((container) =>
  container.singleton(Mailer, () => new SendGridMailer(env("SENDGRID_KEY"))),
);
```

### The `app/services` convention

Any class under `app/services/` is auto-discovered at boot. Declare its lifetime
next to the class with a `static lifetime` flag and it's registered for you:

```typescript fragment
// app/services/users-service.ts
@inject(Auth)
export class UsersService {
  static lifetime = "singleton" as const; // "singleton" | "scoped" | "transient"

  constructor(private auth: AuthManager) {}
}
```

Now `App.make(UsersService)` returns the **same** singleton on every call.
`transient` (or no flag) registers nothing — the container still auto-wires the
class on demand, just with a fresh instance each time.

### Registration is boot-time only

The container is process-global and shared across every concurrent request, so
the `App` registration methods are **locked once `boot()` completes** — calling
`App.singleton()` (etc.) from inside a request throws `ContainerLockedError`.
Register during boot; for genuinely per-request state, register a `scoped`
binding at boot and the container hands each request its own instance.

> **Danger** — The container is shared across every concurrent request. Mutating
> it at request time would leak state between requests — which is exactly why the
> `App` facade locks registration after boot. Use a `scoped` binding for anything
> that must be per-request.

> **Note** — the lock guards the `App` facade, not the raw container. Framework
> internals (deferred providers that register lazily) and tests use
> `container.*` directly and are intentionally unaffected.

## Resolving bindings

### Async resolution — make

`make()` is the primary way to resolve a binding. It's async because factories
may be async and deferred providers may need to boot first:

```typescript fragment
// in application code
const cache = await container.make(CacheManager);
const cfg = await container.make("config");
```

### Sync resolution — makeSync

`makeSync()` resolves **without awaiting** but only works for two cases:

- **value** bindings, and
- **singleton** bindings that have already been resolved.

Anything else throws `SyncResolutionError`. This is what [facades](#facades) use
internally — which is why providers pre-resolve (warm) their singleton in
`onBooted()` before any facade call happens:

```typescript fragment
// in application code
const cache = container.makeSync(CacheManager); // throws if not yet resolved
```

### Safe lookup — tryMake

`tryMake()` resolves a string-keyed binding synchronously, returning `undefined`
instead of throwing when the token isn't registered. Useful for optional
services that exist only in certain runtime modes:

```typescript fragment
// in a ServiceProvider — CommandRunner is only bound in console mode
const runner = container.tryMake("commandRunner");
if (runner) runner.register(MyCommand);
```

## Auto-wiring with @inject

_Auto-wiring_ means: list what a class needs, and the container builds those
dependencies and passes them to the constructor for you — no factory function, no
manual `new`. It's the most common way app code consumes the container, because
the class stays honest about its dependencies (they're right there in the
constructor) while you never have to assemble them by hand.

Pass a class's dependency tokens straight to `@inject(...)`. The container
resolves each token — recursively, and **in parallel** — before constructing the
class:

```typescript fragment
// app/repositories/PostRepository.ts
import { inject } from "zerotal";
import { CacheManager } from "../services/CacheManager.ts";
import { Logger } from "../services/Logger.ts";

@inject(CacheManager, Logger)
export class PostRepository {
  constructor(
    private cache: CacheManager,
    private logger: Logger,
  ) {}
}
```

No registration needed — the container auto-wires on first `make()`:

```typescript fragment
// in application code
const repo = await container.make(PostRepository);
```

The token order must match the constructor parameter order. Any listed token may
itself be auto-wired or bound by a provider. Tokens may be classes, abstract
classes, or string keys from `ContainerBindings`.

## Binding tokens

A token is the key the container resolves against — a class constructor, an
abstract class, or a string key declared in `ContainerBindings`:

```typescript fragment
// in application code
// Class token (most common)
container.singleton(CacheManager, factory);
const cache = await container.make(CacheManager);

// String token (typed via ContainerBindings)
container.value("config", cfg);
const cfg = await container.make("config");
```

Packages extend the `ContainerBindings` interface via declaration merging so
string tokens stay fully type-safe:

```typescript fragment
// in a package's types.ts
declare module "zerotal" {
  interface ContainerBindings {
    db: SQL;
    search: SearchClient;
  }
}
```

## Resolution order

When you call `make(token, consumer?)`, the container walks these steps:

1. **Alias** — follow the alias map to the canonical token.
2. **Deferred** — if a deferred provider is registered for this token, boot it
   now (once), then continue.
3. **Contextual** — if a `consumer` was supplied and has a contextual override
   for this token, use it.
4. **Registry** — otherwise use the registered binding.
5. **Auto-wire** — if nothing is registered but the token is a class with
   `@inject()`, construct it by resolving its dependencies.
6. Otherwise throw `BindingNotFoundError`.

After construction, any [`resolving()`](#resolving-hooks) hooks for the token fire.

## Contextual bindings

Hand a different implementation of the same dependency to different consumers:

```typescript fragment
// in a ServiceProvider or bootstrap bind() callback
// PostController gets the Redis cache; ReportController gets the file cache
container.for(PostController).give(CacheDriver, () => new RedisCache());
container.for(ReportController).give(CacheDriver, () => new FileCache());
```

`for(consumer).give(dependency, factory)` registers a transient contextual
binding. The variants control lifetime:

| Method                        | Lifetime of the contextual instance   |
| ----------------------------- | ------------------------------------- |
| `give(dep, factory)`          | Transient — new instance per resolve  |
| `giveSingleton(dep, factory)` | Singleton within the contextual scope |
| `giveValue(dep, instance)`    | A pre-built value                     |

The `consumer` argument flows automatically when a class is auto-wired — the
container passes the class being constructed as the consumer when resolving each
of its `@inject` tokens.

## Aliases

Bind one token as an alias for another. Resolving the alias returns the target's
instance — handy for binding an interface/contract token to a concrete class:

```typescript fragment
// in a ServiceProvider or bootstrap bind() callback
container.alias(CacheContract, CacheManager);
const cache = await container.make(CacheContract); // → the CacheManager singleton
```

Alias chains are followed to the canonical token, and the resolver guards against
alias cycles.

## resolving hooks

Run a callback every time a token resolves — for post-construction setup without
subclassing or wrapping the factory:

```typescript fragment
// in a ServiceProvider or bootstrap bind() callback
container.resolving(Logger, (logger) => {
  logger.setChannel("app");
});
```

Hooks fire for every binding kind (and for auto-wired classes) right after the
instance is constructed.

## Deferred providers

Register a provider so it boots only when one of its tokens is first resolved —
keeping cold-start fast for services not used on every request:

```typescript fragment
// in a ServiceProvider or bootstrap bind() callback
container.defer(SearchClient, SearchServiceProvider);
```

The first `make(SearchClient)` runs the provider's full
`onRegister → onBooting → onBooted` sequence, then resolves the binding. The
provider is also tracked so its `onStopping`/`onStopped` hooks run at shutdown.
See [The Application](/docs/application#deferred-providers) for the app-level
`defer()` sugar.

## Scoped resolution lifecycle

Each HTTP request runs inside `container.runScoped()`, which creates a fresh
`ScopedResolver`, stores it in `AsyncLocalStorage`, and flushes it when the
request finishes:

- Every `make()` of a scoped binding during the request resolves against **that**
  request's resolver — even across `await` boundaries and concurrent requests.
- There is no shared mutable state on the container, so scoped instances can
  never leak between requests.
- After the response is sent the resolver is flushed; resolving a scoped binding
  afterward throws `ScopedAfterFlushError`.

You rarely call `runScoped()` yourself — the HTTP pipeline does it per request.

## Errors

| Error                       | Thrown when                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `BindingNotFoundError`      | A token has no binding and can't be auto-wired.                      |
| `ScopedOutsideRequestError` | A scoped binding is resolved outside any request scope.              |
| `SyncResolutionError`       | `makeSync()` is used on a non-value / unresolved-singleton binding.  |
| `CircularDependencyError`   | Auto-wiring detects a dependency cycle (clear chain in the message). |
| `ScopedAfterFlushError`     | A scoped binding is resolved after its request scope was flushed.    |
| `ContainerLockedError`      | An `App` registration method is called after `boot()` completes.     |

All extend `ZerotalError`.

## References

Members of the `Container` class:

| Method                      | Signature                                                              | Description                                                          |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `singleton(token, factory)` | `singleton<T>(token: BindingToken<T>, factory: Factory<T>): this`      | Bind a once-per-app instance.                                        |
| `scoped(token, factory)`    | `scoped<T>(token: BindingToken<T>, factory: Factory<T>): this`         | Bind a once-per-request instance.                                    |
| `bind(token, factory)`      | `bind<T>(token: BindingToken<T>, factory: Factory<T>): this`           | Bind a transient (new each time).                                    |
| `value(token, instance)`    | `value<T>(token: BindingToken<T>, instance: T): this`                  | Bind a pre-built value.                                              |
| `make(token, consumer?)`    | `make<T>(token: BindingToken<T>, consumer?: unknown): Promise<T>`      | Resolve asynchronously (preferred).                                  |
| `makeSync(token)`           | `makeSync<T>(token: BindingToken<T>): T`                               | Resolve synchronously (value / resolved-singleton only).             |
| `build(ctor)`               | `build<T>(ctor: new (...args: unknown[]) => T): Promise<T>`            | Auto-wire a class, ignoring any registered binding.                  |
| `tryMake(token)`            | `tryMake<K>(token: K): ContainerBindings[K] \| undefined`              | Sync resolve or `undefined` if unregistered.                         |
| `forget(token)`             | `forget(token: BindingToken): boolean`                                 | Remove a binding; `true` if one existed.                             |
| `alias(from, to)`           | `alias(from: unknown, to: unknown): this`                              | Resolve `from` as `to`.                                              |
| `for(consumer)`             | `for<C>(consumer: BindingToken<C>): ContextualBindingBuilder<C>`       | Begin a contextual binding (`give` / `giveSingleton` / `giveValue`). |
| `resolving(token, hook)`    | `resolving<T>(token: BindingToken<T>, hook: (i: T) => void): this`     | Run a hook after each resolution.                                    |
| `defer(token, Provider)`    | `defer(token: unknown, provider: new (app) => unknown): this`          | Boot a provider lazily on first resolve.                             |
| `runScoped(cb)`             | `runScoped<T>(cb: (scoped: ScopedResolver) => Promise<T>): Promise<T>` | Run `cb` inside a fresh request scope.                               |

## Facades

A facade is a thin static class that resolves a container binding for you, so
consumers write `Cache.get(key)` instead of `await container.make("cache")`.
Facades are sugar over the container — same instance, less ceremony.

They are only usable **after the application has booted** (all providers have run
`onRegister`/`onBooting`/`onBooted`), because they resolve their binding
synchronously via `makeSync`. That's why providers pre-resolve their singleton in
`onBooted()` — it warms the binding so the facade works everywhere afterwards.

> **Warning** — Using a facade at module scope (top-level code that runs on
> import) throws `FacadeAccessedBeforeBootError`, because the container isn't ready
> yet. Move facade calls inside a function, controller method, or provider hook.

### Built-in facades

Core ships a few, importable from `zerotal`:

```typescript fragment
// in application code (after boot)
import { Config, Events, Artisan } from "zerotal";

// Config — read loaded configuration
Config.get("app.name");

// Events — the class-based event bus (events and listeners are plain classes)
Events.on(UserRegistered, SendWelcomeEmail);
await Events.emit(new UserRegistered(user.id, user.email));

// Artisan — invoke a CLI command programmatically
await Artisan.call("migrate");
```

Packages ship their own — for example `Cache` from `@zerotal/cache`, `Auth` from
`@zerotal/auth`:

```typescript
// in application code (after boot)
import { Cache } from "@zerotal/cache";
import { Auth } from "@zerotal/auth";

await Cache.put("key", value, 300);
Auth.check(); // → boolean
Auth.user(); // → AuthenticatedUser (throws if guest)
Auth.userOrNull(); // → AuthenticatedUser | undefined
```

### Defining a facade

Build one with `createFacade<T>(token)`, passing the same token the provider binds:

```typescript fragment
// src/facades/Cache.ts
import { createFacade } from "zerotal";
import type { CacheManager } from "../CacheManager.ts";

export const Cache = createFacade<CacheManager>("cache");
```

Every static call proxies to the resolved instance, so `Cache.get(...)` is exactly
`(await container.make("cache")).get(...)` — just synchronous and terminless. See
[Package Development](/docs/package-development#facades) for where facades
fit in a package, and prefer [`@inject()`](#auto-wiring-with-inject) over facades
inside your own application services where testability matters.

## Next steps

- [Service Providers](/docs/providers) — where bindings are registered and booted.
- [The Application](/docs/application) — the container's owner and lifecycle engine.
- [Request Lifecycle](/docs/lifecycle) — where the per-request scope is opened and flushed.
