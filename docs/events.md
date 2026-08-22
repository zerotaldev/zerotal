---
title: Events
description: React to things that happen in your app, and observe the framework itself, through two purpose-built event buses.
---

# Events

Zerotal has **two** event systems: one for reacting to things that happen in your
domain, and one for observing the framework's own internals. Almost all of the time
you want just one of them — **application events** — so start there and treat the
other as advanced.

```
your code  ──emit──▶  Events facade (Emitter)  ──▶  listener classes  (async, queueable)
framework  ──emit──▶  FrameworkEvents (bus)     ──▶  handler functions (sync, no I/O)
```

- **Application events** are for things that happen in _your app_: a user signed
  up, an order was placed. You emit them and write listeners that react — send an
  email, grant a bonus. You'll use these through the `Events` facade. **This is the
  one you reach for.** → [jump to it](#emitter-the-events-facade)
- **Framework events** are for _observing the framework itself_: slow queries,
  finished requests, cache hits. The framework emits them and built-in tools (the
  logger, devtools) listen. You only touch these to build your own instrumentation
  — metrics, audit, alerting. → [jump to it](#frameworkevents)

**Which one do I want?** Ask what fired the event:

- Something _you_ did in your domain → **application event**.
- Something the _framework_ did under the hood → **framework event**.

Two rules keep them from blurring: never do I/O (network, disk, DB) inside a
framework-event handler — they run synchronously on the request hot path — and
never use framework events to drive business logic.

If you want the full side-by-side, here it is — but you can skip it and come back
once you've read the section for the one you need:

|               | Framework events                  | Application events          |
| ------------- | --------------------------------- | --------------------------- |
| Purpose       | Observing the framework           | Reacting to your domain     |
| Who emits     | The framework                     | Your code                   |
| Who listens   | Built-in tools (logger, devtools) | Your code                   |
| A listener is | a plain **function**              | a **class** with `handle()` |
| Timing        | **synchronous**, fast, no I/O     | async; can be **queued**    |

## FrameworkEvents

A single synchronous bus, exported as a singleton from `zerotal`. Framework
packages emit lifecycle events into it; infrastructure packages subscribe to react.
It is the reason domain packages never import devtools or the logger — everyone
talks through the bus instead.

### API

```typescript
import { FrameworkEvents, QueryExecuted } from "zerotal";

// Subscribe — returns an unsubscribe function.
const off = FrameworkEvents.on(QueryExecuted, (event) => {
  metrics.observe("db.query.ms", event.durationMs);
});

// Emit (done by the framework; shown for completeness).
FrameworkEvents.emit(new QueryExecuted(sql, bindings, startMs, durationMs, rowCount, ctx));

// Stop listening.
off();

// Test isolation: drop every subscription.
FrameworkEvents.clear();

// How many handlers are currently registered (leak assertions in tests).
FrameworkEvents.handlerCount();
```

### Handler contract

`emit()` runs every handler **synchronously in the caller's stack** and **swallows
handler errors** — a throwing subscriber can never affect the code that emitted the
event. Because emission is on the hot path, handlers must be fast and must not
perform I/O. If you need to do real work, buffer the data and hand it off (e.g.
dispatch a queue job) from outside the handler.

### Subscribing from a provider

Subscribe in `onBooted`, keep the unsubscribe functions, and release them in
`onStopping` so handlers never leak between boots or test suites:

```typescript fragment
import { ServiceProvider, FrameworkEvents, RequestFailed } from "zerotal";

export class MetricsProvider extends ServiceProvider {
  private _unsubs: Array<() => void> = [];

  override async onBooted(): Promise<void> {
    this._unsubs.push(
      FrameworkEvents.on(RequestFailed, (e) => {
        metrics.increment("http.5xx", { path: (e.ctx as any).url?.pathname });
      }),
    );
  }

  override onStopping(): void {
    for (const off of this._unsubs) off();
    this._unsubs = [];
  }
}
```

### Event catalogue

Every event class is exported from `zerotal`. Events carry the active
`RequestContext` as `ctx` where one applies (it is `undefined` outside a request).

**HTTP** (`@zerotal/core`)

| Event               | Fields                                    | Emitted by                               |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `RequestHandled`    | `ctx, startMs, durationMs`                | route dispatcher / server, on success    |
| `RequestFailed`     | `ctx, startMs, durationMs, error, status` | dispatcher / server catch blocks         |
| `MiddlewareSkipped` | `name, reason, ctx`                       | a middleware short-circuits the pipeline |

**ORM** (`@zerotal/orm`)

| Event                   | Fields                                              |
| ----------------------- | --------------------------------------------------- |
| `QueryExecuted`         | `sql, bindings, startMs, durationMs, rowCount, ctx` |
| `NPlusOneDetected`      | `fingerprint, count, ctx`                           |
| `TransactionStarted`    | `txId, ctx`                                         |
| `TransactionCommitted`  | `txId, durationMs, ctx`                             |
| `TransactionRolledBack` | `txId, durationMs, reason, ctx`                     |
| `MigrationRan`          | `name, direction, durationMs, ok, error?`           |

**Mail** (`@zerotal/notifications`)

| Event           | Fields                                             |
| --------------- | -------------------------------------------------- |
| `MessageSent`   | `className, to, subject, html, durationMs, queued` |
| `MessageQueued` | `className, to, subject, queue`                    |
| `MessageFailed` | `className, to, subject, durationMs, error`        |

**Cache** (`@zerotal/cache`)

| Event          | Fields                                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| `CacheQueried` | `op ('hit'\|'miss'\|'write'\|'forget'\|'flush'\|'has'), key, ttl, durationMs` |
| `CacheEvicted` | `key, reason ('ttl'\|'capacity'\|'manual')`                                   |

**Queue** (`@zerotal/queue`)

| Event    | Fields                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| `JobRan` | `className, queue, status ('dispatched'\|'completed'\|'failed'\|'retried'), durationMs, error?` |

**Scheduler** (`@zerotal/scheduler`)

| Event         | Fields                                                              |
| ------------- | ------------------------------------------------------------------- |
| `TaskRan`     | `name, durationMs, ok`                                              |
| `TaskFailed`  | `name, durationMs, error`                                           |
| `TaskSkipped` | `name, reason ('env'\|'window'\|'when'\|'skip'\|'overlap'\|'lock')` |

**Auth** (`@zerotal/auth`)

| Event                 | Fields                           |
| --------------------- | -------------------------------- |
| `LoginAttempted`      | `guard, identifier, ctx`         |
| `LoginSucceeded`      | `guard, userId, ctx`             |
| `LoginFailed`         | `guard, identifier, reason, ctx` |
| `LoggedOut`           | `guard, userId, ctx`             |
| `TokenIssued`         | `tokenId, abilities, userId`     |
| `AuthorizationDenied` | `ability, userId, ctx`           |

### Who already subscribes

- The **logger** auto-logs slow queries, N+1, and 4xx/5xx responses — see [Logger](/docs/logger).
- **Devtools** buffers per-request traces keyed on the request context and streams them to the live dashboard — see [Devtools](/docs/devtools).

You can add your own subscribers (metrics, audit, alerting) the same way, without
the emitting packages knowing you exist.

### Reading the request context in a handler

Some events carry `ctx`; for those that do not (mail/cache/queue happen outside the
HTTP frame of reference), resolve the current request lazily:

```typescript fragment
import { FrameworkEvents, RequestContext } from "zerotal";
import { CacheQueried } from "@zerotal/cache";

FrameworkEvents.on(CacheQueried, (e) => {
  const requestId = RequestContext.tryGet()?.requestId; // undefined outside a request
  metrics.increment(`cache.${e.op}`, { requestId });
});
```

## Emitter / the Events facade

For business events — things that happened in your domain that other parts of your
app should react to. Events are plain classes; listeners are classes with a
`handle()` method. Access the per-application `Emitter` singleton through the
`Events` facade.

### Define an event and a listener

```typescript fragment
// app/events/UserRegistered.ts
export class UserRegistered {
  constructor(
    readonly userId: number,
    readonly email: string,
  ) {}
}

// app/listeners/SendWelcomeEmail.ts
import type { UserRegistered } from "../events/UserRegistered.ts";
import { Notify } from "@zerotal/notifications";
import { WelcomeNotification } from "../notifications/WelcomeNotification.ts";

export class SendWelcomeEmail {
  async handle(event: UserRegistered): Promise<void> {
    await Notify.send({ email: event.email }, new WelcomeNotification(event.userId));
  }
}
```

### Register and emit

```typescript fragment
// usually a provider's onBooted(), or bootstrap code
import { Events } from "zerotal";
import { UserRegistered } from "./app/events/UserRegistered.ts";
import { SendWelcomeEmail } from "./app/listeners/SendWelcomeEmail.ts";

Events.on(UserRegistered, SendWelcomeEmail);

// Later, in a controller or service:
await Events.emit(new UserRegistered(user.id, user.email));
```

`Events` is a facade over the per-application `Emitter` singleton (the `events`
container binding). Whatever you call on `Events` runs against the live emitter.

**What `emit()` actually does:** it looks up every listener registered for the
event's class, **instantiates a fresh listener per dispatch**, and runs them all
**concurrently** with `Promise.allSettled`. That has two consequences worth
internalising:

- **Failures are isolated.** One listener throwing doesn't stop the others, and
  the error is _logged, not rethrown_ — `await Events.emit(...)` never rejects
  because a listener failed. Don't rely on a `try/catch` around `emit()` to catch
  listener errors; it won't.
- **Order is not guaranteed.** Listeners run in parallel, so don't write one that
  assumes another has already finished. If you genuinely need ordered, awaited
  execution, use `Events.emitSync(event)` — it runs listeners one at a time in
  registration order and, unlike `emit()`, **does propagate** the first error.

`await`-ing `emit()` waits for all inline listeners to settle (queued ones return
as soon as the job is dispatched — see [Queued listeners](#queued-listeners)).
To unregister a listener, call `Events.off(EventClass, ListenerClass)`.

### Auto-discovered listeners

You usually don't call `Events.on(...)` yourself. A listener placed in `app/listeners/`
declares the event(s) it handles via `static listens`, and the framework binds it on the
emitter at boot — no registration code required.

```typescript fragment
// app/listeners/SendWelcomeEmail.ts
import { UserRegistered } from "../events/UserRegistered.ts";

export class SendWelcomeEmail {
  static listens = UserRegistered;

  async handle(event: UserRegistered): Promise<void> {
    await Notify.send({ email: event.email }, new WelcomeNotification(event.userId));
  }
}
```

### One listener, several events

`static listens` accepts an array — the listener binds to each event and `handle()`
receives whichever one fired:

```typescript fragment
// app/listeners/GrantWelcomeBonus.ts
import { UserRegistered } from "../events/UserRegistered.ts";
import { UserReactivated } from "../events/UserReactivated.ts";

export class GrantWelcomeBonus {
  static listens = [UserRegistered, UserReactivated];

  async handle(event: UserRegistered | UserReactivated): Promise<void> {
    await Credits.grant(event.userId, 100);
  }
}
```

Multiple listeners can subscribe to the same event; each is instantiated and run with
`Promise.allSettled`, so one failure never blocks the others.

### Queued listeners

Listeners run inline by default. For slow work (sending mail, calling an API), mark the
listener to run on the queue instead — the emitter serialises the event and dispatches a
job, so `emit()` returns without waiting for the work to finish. Set `queue` to `true` for
the default queue, or to a queue name. Two optional fields tune the retry behaviour of the
dispatched job:

```typescript fragment
// app/listeners/SendWelcomeEmail.ts
import { UserRegistered } from "../events/UserRegistered.ts";

export class SendWelcomeEmail {
  static listens = UserRegistered;

  queue = "mail"; // or `true` for the default queue
  maxAttempts = 3; // optional: retry up to 3 times on failure
  retryDelay = 30; // optional: seconds to wait between attempts

  async handle(event: UserRegistered): Promise<void> {
    await Notify.send({ email: event.email }, new WelcomeNotification(event.userId));
  }
}
```

Note `queue` (and the retry fields) are **instance** properties, not `static` — they
describe how _this_ listener runs, whereas `static listens` describes _what_ it listens to.

If no queue manager is registered, a queued listener falls back to running inline, so it's
safe to add before you've configured a queue — it simply runs synchronously until a queue
exists. Requires [`@zerotal/queue`](/docs/queue) for actual deferral.

### Events are auto-discovered too

Event classes are plain data classes — they need no registration. Files in `app/events/`
are imported at boot so their module-level side effects (if any) are in place and a
production manifest can reference them. You can also just import an event class directly
where you emit it; the `app/events/` folder is a convention, not a requirement.

### Reacting to model changes

To emit application events from ORM lifecycle hooks (created / updated / deleted), use a
model's `dispatchesEvents` map — see
[Conventions → Model events](/docs/conventions#model-events).

### Broadcasting an event to the browser

If an event class defines a `broadcastOn()` method, emitting it **also broadcasts it**
over WebSockets to the channels it names — in addition to running any listeners. This is
wired through [`@zerotal/broadcasting`](/docs/broadcasting); core stays broadcasting-free
and calls the hook only when one is registered. Worth knowing here for one subtlety: the
broadcast fires **even when the event has no listeners**, so an event can be purely a
broadcast with no `handle()` anywhere. See [Broadcasting](/docs/broadcasting) for channels,
authorization, and the client side.

### Testing events

Both buses expose a reset so one test never leaks subscriptions into the next:

```typescript fragment
import { Events, FrameworkEvents } from "zerotal";

// Remove every application listener
Events.clear();
// Assert a specific event has a listener wired
Events.hasListeners(UserRegistered); // → boolean

// Drop every framework subscription, and check for leaks
FrameworkEvents.clear();
FrameworkEvents.handlerCount(); // → number of live handlers
```

To assert that emitting an event triggered the right side effect, register a tiny inline
listener (or spy) before emitting and check it ran — `emit()` awaits inline listeners, so a
plain `await Events.emit(...)` is enough to observe their effects.

## References

**`Events` facade** (Tier 2 — application events, from `zerotal`):

| Method                        | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `Events.on(Event, Listener)`  | Register a listener class for an event class.                   |
| `Events.off(Event, Listener)` | Remove a previously registered listener.                        |
| `Events.emit(event)`          | Dispatch concurrently; failures isolated and logged.            |
| `Events.emitSync(event)`      | Dispatch sequentially in order; **propagates** the first error. |
| `Events.hasListeners(Event)`  | Whether any listener is registered for the event class.         |
| `Events.clear()`              | Remove every listener (use in tests).                           |

**`FrameworkEvents`** (Tier 1 — instrumentation, from `zerotal`):

| Method                           | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `FrameworkEvents.on(Event, fn)`  | Subscribe a function; returns an unsubscribe function. |
| `FrameworkEvents.emit(event)`    | Fire synchronously to all handlers; errors swallowed.  |
| `FrameworkEvents.clear()`        | Drop every subscription (use in tests).                |
| `FrameworkEvents.handlerCount()` | Count of live handlers, for leak assertions in tests.  |

**Listener declaration fields** (Tier 2 listener classes):

| Field            | Kind     | Description                                                  |
| ---------------- | -------- | ------------------------------------------------------------ |
| `static listens` | static   | The event class (or array of classes) this listener handles. |
| `handle(event)`  | method   | Runs when a subscribed event fires.                          |
| `queue`          | instance | `true` or a queue name → run on the queue instead of inline. |
| `maxAttempts`    | instance | Optional retry count for a queued listener.                  |
| `retryDelay`     | instance | Optional seconds between retry attempts.                     |

For the full list of Tier 1 event classes and their fields, see the
[Event catalogue](#event-catalogue) above.

## Next steps

- [Conventions](/docs/conventions#events-listeners-appevents-applisteners) — how `app/events` and `app/listeners` are discovered.
- [Queue](/docs/queue) — deferring listener work to background jobs.
- [Logger](/docs/logger) — a built-in FrameworkEvents subscriber.
- [Telemetry](/docs/telemetry) — turn framework events into metrics.
