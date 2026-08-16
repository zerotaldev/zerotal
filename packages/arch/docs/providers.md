---
title: Service Providers
description: Register a feature's bindings and hook into the application boot and shutdown sequence.
---

# Service Providers

A service provider is a **feature's setup script**. When the app boots, each
provider gets a turn to register its bindings into the container, wire up the
things that feature needs, and (optionally) hook into later stages of startup and
shutdown. Every framework feature — ORM, sessions, mail, queues — ships as a
provider, and your own app can add as many as it needs.

The mental model: the [container](/docs/container) holds the _services_, the
[Application](/docs/application) runs the _boot sequence_, and a provider is how a
feature plugs into that sequence. The two methods you'll use most are
`onRegister()` (bind things) and `onBooted()` (use things) — the rest of this page
is mostly about those two and when each runs.

> **Note** — Do you even need a provider? Often not. Registering a single binding
> or two doesn't justify a whole class — use the bootstrap [`app.bind()`](/docs/application#registering-services-without-a-provider)
> callback or the [`app/services` convention](/docs/container#the-appservices-convention)
> instead. Reach for a provider when there's real _bootstrapping_ involved:
> lifecycle hooks, config-driven wiring, middleware registration, or a feature
> that spans several bindings.

## Mental model

A provider extends `ServiceProvider` from `zerotal` and overrides only the
hooks it cares about. The framework drives every provider through the same boot
sequence in list order:

```
register all providers   onRegister()   ← bind, no resolving yet
        │
        ▼
boot (sequential)        onBooting()     ← prepare a service a later provider needs
        │
        ▼
boot (parallel)          onBooted()      ← resolve and use, including from other providers
        │
        ▼
server binding           onStarting / onStarted
        │
        ▼
graceful shutdown        onStopping / onStopped
```

```typescript
// in a provider
import { ServiceProvider } from "zerotal";
```

## Anatomy of a provider

```typescript
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";
import { PaymentGateway } from "../services/PaymentGateway.ts";
import { StripeGateway } from "../services/StripeGateway.ts";

export class AppServiceProvider extends ServiceProvider {
  /**
   * Register bindings into the container.
   * Called synchronously before boot. No resolved bindings are available yet.
   */
  onRegister(): void {
    this.app.container.singleton(
      PaymentGateway,
      () => new StripeGateway({ key: Bun.env.STRIPE_KEY! }),
    );
  }

  /**
   * Called after all providers have registered.
   * Safe to resolve bindings from other providers here.
   */
  async onBooted(): Promise<void> {
    const gw = await this.app.container.make(PaymentGateway);
    await gw.ping(); // verify connectivity at startup
  }
}
```

## How it works

A provider boots in three ordered steps. The golden rule lives here: **bind in
`onRegister()`, resolve in `onBooted()`.** Trying to resolve a binding too early
is the most common provider mistake.

| Hook           | Runs                              | You should…                                        |
| -------------- | --------------------------------- | -------------------------------------------------- |
| `onRegister()` | sync, before anything is resolved | _bind_ services — nothing is resolvable yet        |
| `onBooting()`  | async, sequentially in list order | prepare a service a _later_ provider needs         |
| `onBooted()`   | async, in parallel once all bound | _resolve_ services, including from other providers |

Why the order matters: during `onRegister()` no binding has been resolved yet, so
you can only register. By `onBooted()` every provider has registered, so resolving
across providers is safe. `onBooting()` sits between them for the rarer case where
one provider must be fully prepared before another even registers. There are also
`onStarting`/`onStarted` (around the server binding) and `onStopping`/`onStopped`
(graceful shutdown), plus per-request hooks (`onRequestReceived`,
`onRequestProcessed`, `onResponseSent`) — see [the full phase list](/docs/lifecycle#provider-lifecycle-hooks).

## Registering providers

List providers in `bootstrap/providers.ts`. Order matters — a provider can
only resolve bindings registered by providers that appear earlier in the list:

```typescript
// bootstrap/providers.ts
import { DatabaseProvider } from "@zerotal/orm";
import { CacheProvider } from "@zerotal/cache";
import { AppServiceProvider } from "../app/providers/AppServiceProvider.ts";

const providers = [
  DatabaseProvider, // registers DB bindings
  CacheProvider, // may depend on DB
  AppServiceProvider, // can use both DB and Cache
];

export default providers;
```

> **Note** — `app/providers/*` are auto-discovered. Your own providers (e.g. `AppServiceProvider`) don't
> need to be listed — any `ServiceProvider` under `app/providers/` is registered automatically and
> runs its full lifecycle, appended after the explicitly-listed providers (so framework providers
> boot first). List a provider explicitly only to control its order relative to others. See
> [Conventions](/docs/conventions#providers-appproviders).

## Declaring dependencies

Listing providers in the right order works, but it's fragile — it asks every app to
remember that, say, `AdminProvider` needs `FlowProvider`'s `Router.flow()` macro to
exist first. Instead, a provider can declare what it needs on the class itself with
`static dependsOn`, and the framework pulls that dependency in and boots it first:

```typescript
// packages/admin/src/provider/AdminProvider.ts
import { ServiceProvider } from "zerotal";
import { FlowProvider } from "@zerotal/flow";

export class AdminProvider extends ServiceProvider {
  static dependsOn = [FlowProvider];
}
```

`dependsOn` holds **provider classes** — real imports, not magic strings — so it's
type-checked and survives renames. It does two jobs at once:

- **Pulls the dependency in.** You register only the feature you want —
  `AdminProvider` — and `FlowProvider` comes along automatically, even when it
  isn't listed in `bootstrap/providers.ts`. You list the _features_ your app uses,
  not the plumbing they each need.
- **Orders it first.** A dependency always boots before the provider that declared
  it, regardless of where either sits in the list.

So an app that uses the admin panel only needs the panel itself:

```typescript
// bootstrap/providers.ts — FlowProvider arrives via AdminProvider.dependsOn
const providers = [AdminProvider];

export default providers;
```

### Registration is idempotent

You can list a provider explicitly _and_ have it pulled in through someone's
`dependsOn` — it still boots exactly once. Registration is idempotent by class
identity, and the first registration keeps its position, so explicit and automatic
registration safely overlap. Listing `FlowProvider` yourself while `AdminProvider`
also depends on it is harmless, not a double-boot.

### The priority tiebreak

`dependsOn` orders a provider relative to the ones it names. Providers with _no_
dependency relationship fall back to `static priority` (lower boots earlier;
defaults to `0`), then to registration order. It's a coarse knob — useful for a
framework-core provider that should generally boot ahead of everything else,
without every other provider having to name it explicitly:

```typescript
export class CoreProvider extends ServiceProvider {
  static priority = -100; // boots before ordinary (priority 0) providers
}
```

Reach for `dependsOn` to express a real, specific dependency; reach for `priority`
only for broad "this should come early/late" ordering.

### Cycles and environments

The dependency graph is resolved once, at boot, with a few guarantees worth knowing:

- **Transitive.** A dependency's own `dependsOn` is pulled in too, recursively, and
  de-duplicated.
- **Environment-aware.** A dependency excluded by its own `static environments`
  isn't dragged in where it doesn't belong — a `web`-only provider won't be pulled
  into a `console` boot just because a console-active provider lists it.
- **Cycle-checked.** A circular `dependsOn` throws at boot with the offending path
  (`Circular provider dependency: A → B → A`), failing fast rather than booting in a
  surprising order.

> **Note** — your explicit list is never reshuffled. `dependsOn`/`priority` order the
> providers that are _pulled in_; the providers you list by hand in
> `bootstrap/providers.ts` keep their authored order, with dependencies slotted in
> ahead of the providers that need them.

## onRegister — bind things

Register container bindings, named middleware groups, and router macros. This hook
is **synchronous** — no `await` — and runs before any binding is resolved, so
treat it as pure wiring. The factory closures you pass don't run yet; they run
_later_, when the binding is first resolved.

```typescript
// inside a ServiceProvider
onRegister(): void {
  // Singleton — one shared instance per app lifetime
  this.app.container.singleton(AnalyticsService, () =>
    new AnalyticsService({ apiKey: Bun.env.ANALYTICS_KEY! })
  );

  // Per-request scoped binding. The factory may be async — `make()` returns a
  // promise, so await it inside the factory.
  this.app.container.scoped(CartService, async (c) =>
    new CartService(await c.make(DB))
  );

  // A named middleware group usable in Router.group({ middleware: ['api'] })
  Router.middlewareGroup('api', [ThrottleMiddleware, JsonMiddleware]);

  // Extend the Router with a custom route method (macro)
  Router.macro('webhook', webhookRoute);
}
```

## onBooting — prepare in order

`onBooting()` runs **sequentially**, in provider-list order, between register and
booted. Reach for it only when one provider must finish preparing before the next
one even registers — most providers skip it entirely. It's async, so you can
`await`:

```typescript
// inside a ServiceProvider
async onBooting(): Promise<void> {
  // e.g. open a connection pool that a provider listed after this one
  // expects to already exist when its own onRegister() runs.
  const db = await this.app.container.make(DB);
  await db.connect();
}
```

## onBooted — use things

By `onBooted()` every provider has registered, so this is the safe place to
_resolve_ bindings (including from other providers), start background work, and
register event listeners. It runs in parallel across all providers:

```typescript
// inside a ServiceProvider
async onBooted(): Promise<void> {
  // Resolve a binding from another provider
  const db = await this.app.container.make(DB);

  // Register global event listeners
  Events.on(UserRegistered, async (event) => {
    await sendWelcomeEmail(event.user);
  });

  // Start a background polling loop (only in the 'web' runtime)
  if (this.app.environment === 'web') {
    startHealthMonitor();
  }
}
```

## this.app API

`this.app` is the [Application](/docs/application) instance. The members you'll
use from inside a provider:

| Property / Method             | Description                                                  |
| ----------------------------- | ------------------------------------------------------------ |
| `this.app.container`          | The IoC [container](/docs/container) — bind and resolve here |
| `this.app.environment`        | `'web' \| 'console' \| 'worker' \| 'test' \| 'repl'`         |
| `this.app.useOnce(mw)`        | Add a middleware to the global pipeline exactly once         |
| `this.app.registerConcern(d)` | Contribute an auto-discovery concern (see below)             |

To read configuration, resolve it from the container or use the `Config` facade
— `this.app.container.makeSync('config').get('app.name')`, or simply
`Config.get('app.name')` once booted.

### Contributing a convention

A provider can add its own auto-discovered directory by registering a concern descriptor in
`onRegister()`/`onBooting()`. The framework scans the directory at boot and calls `register()`
for each file's exports:

```typescript
// inside a ServiceProvider
onRegister(): void {
  this.app.registerConcern({
    name: "validators",
    order: 60,            // models=10, observers=20, policies=30, listeners=40
    dir: "app/validators",
    register(mod, ctx) {
      for (const exported of Object.values(mod)) {
        /* register exported as needed */
      }
    },
  });
}
```

A `run(ctx)` hook (without `dir`) defines a one-shot step instead of a directory scan. See
[Conventions](/docs/conventions#custom-concerns).

## Deferred providers

When a provider registers something that's rarely needed at boot — a search
engine, a payment SDK — you can **defer** it so it doesn't run until one of its
bindings is first resolved. This keeps cold-start fast.

Deferral takes two parts. First, the provider declares which tokens it provides:

```typescript
// app/providers/SearchProvider.ts
import { ServiceProvider } from "zerotal";

export class SearchProvider extends ServiceProvider {
  static provides = ["search.engine"] as const;

  onRegister(): void {
    this.app.container.singleton(
      "search.engine",
      () => new MeilisearchEngine({ host: Bun.env.MEILISEARCH_URL! }),
    );
  }
}
```

Second — and this is the part that actually defers it — register it with
`app.defer()` instead of the normal providers array. `static provides` on its own
is just metadata; it's `defer()` that wires the lazy boot:

```typescript
// bootstrap/app.ts
const app = Application.create({ providers });
app.defer([SearchProvider]); // array form reads each provider's `static provides`
```

The first `make("search.engine")` runs the provider's full
`onRegister → onBooting → onBooted` sequence, then resolves the binding.

> **Warning** — A deferred provider must _not_ also sit in the eager providers list
> or in `app/providers/*` auto-discovery, or it would boot at startup anyway,
> defeating the deferral. See [The Application](/docs/application#deferred-providers)
> for the `defer()` overloads.

## Environment-specific registration

A provider runs in every runtime by default. Branch on `this.app.environment` to
bind a different implementation per environment — a fake mailer under `test`, the
real one everywhere else:

```typescript
// inside a ServiceProvider
onRegister(): void {
  if (this.app.environment === 'test') {
    this.app.container.singleton(Mailer, () => new FakeMailer());
  } else {
    this.app.container.singleton(Mailer, () => new SmtpMailer());
  }
}
```

To skip a provider entirely outside certain runtimes, set `static environments`
on the class (e.g. `static environments = ['web']`) — the Application filters it
out before it's ever instantiated.

## Auto-registering middleware

Providers can push middleware into the global pipeline via `this.app.useOnce()` —
the framework guarantees it's added exactly once, even if the same middleware is
registered by several providers:

```typescript
// inside a ServiceProvider
onBooting(): Promise<void> {
  this.app.useOnce(SessionMiddleware);
  this.app.useOnce(AuthMiddleware);
}
```

This is how framework packages (e.g. `@zerotal/session`) inject their middleware
transparently, without the app developer needing to add it manually.

## Which hook should I use?

- **`onRegister`** — for _binding_ services into the container, registering
  middleware groups, and router macros. Nothing is resolvable yet, so never call
  `make()` here.
- **`onBooting`** — only when one provider must be fully prepared before a later
  provider registers, or to auto-register middleware via `useOnce()`. Most
  providers skip it.
- **`onBooted`** — for _resolving_ services (including across providers), starting
  background work, and registering event listeners.
- **No provider at all** — for one or two bindings with no lifecycle needs, prefer
  the bootstrap [`app.bind()`](/docs/application#registering-services-without-a-provider)
  callback or the [`app/services` convention](/docs/container#the-appservices-convention).

## References

The lifecycle hooks a provider may override, in boot order:

| Hook                 | Signature                                             | When it runs                                                      |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `onRegister`         | `onRegister(): void`                                  | Sync, before any binding is resolved. Bind here.                  |
| `onBooting`          | `onBooting(): Promise<void>`                          | Sequentially in list order, after all providers registered.       |
| `onBooted`           | `onBooted(): Promise<void>`                           | In parallel once every provider has booted. Resolve here.         |
| `onStarting`         | `onStarting(): Promise<void>`                         | Just before the app starts accepting work (e.g. the HTTP server). |
| `onStarted`          | `onStarted(): Promise<void>`                          | Once the app has started.                                         |
| `onStopping`         | `onStopping(): Promise<void>`                         | When graceful shutdown begins. Release resources here.            |
| `onStopped`          | `onStopped(): Promise<void>`                          | Once shutdown is complete.                                        |
| `onRequestReceived`  | `onRequestReceived(ctx: HttpContext): Promise<void>`  | Before the middleware pipeline runs, per request.                 |
| `onRequestProcessed` | `onRequestProcessed(ctx: HttpContext): Promise<void>` | After the pipeline completes and `ctx.response` is set.           |
| `onResponseSent`     | `onResponseSent(ctx: HttpContext): Promise<void>`     | After the response has been sent to the client.                   |
| `replContext`        | `replContext(): Record<string, unknown>`              | Returns variables to expose in `bun zt repl`.                     |

Static members on the provider class:

| Member                | Type                                   | Description                                                                                                                                |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `static environments` | `AppEnvironment[]`                     | Runtimes the provider participates in. Defaults to all five.                                                                               |
| `static provides`     | `readonly (keyof ContainerBindings)[]` | Tokens this provider registers. Required for the array form of `app.defer([Provider])`.                                                    |
| `static dependsOn`    | `ProviderClass[]`                      | Providers this one needs — pulled in automatically and booted first. See [Declaring dependencies](/docs/providers#declaring-dependencies). |
| `static priority`     | `number`                               | Boot-order tiebreak among providers with no `dependsOn` relationship. Lower boots earlier; default `0`.                                    |

## Next steps

- [Container](/docs/container) — the IoC container providers bind into.
- [Lifecycle](/docs/lifecycle) — when `onRegister` and `onBooted` run during boot.
- [Conventions](/docs/conventions) — auto-discovery of providers and concerns.
- [Application](/docs/application) — the `this.app` instance and its environment.
