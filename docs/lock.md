---
title: Locking
description: Coordinate critical sections across processes and servers with atomic, owner-guarded distributed locks.
---

# Locking

`zerotal/lock` provides atomic distributed locks — mutual-exclusion primitives
that stop two processes or requests from running the same critical section at the
same time. Each acquisition carries a unique owner token, so an expired lock can
never be released by a late holder.

## Getting Started

Locking ships as part of `@zerotal/core` — there is nothing extra to install. Import it from the `zerotal/lock` subpath:

```ts
import { Lock, LockProvider } from "zerotal/lock";
```

## Register the provider

Add `LockProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { LockProvider } from "zerotal/lock";

const providers = [
  // …your other providers
  LockProvider,
];

export default providers;
```

Registering the provider switches on the following:

- `onRegister` — binds a `LockManager` as a lazy singleton on the `"lock"`
  container key, selecting the driver from `config/lock.ts`.
- `onBooted` — pre-resolves the manager so the synchronous `Lock` facade works
  immediately after boot.
- `onStopping` — disposes the driver (timers, connections), so nothing leaks
  between boots or test suites.

The provider activates in the `web`, `worker`, `console`, and `test` environments.

## Configuration

Create `config/lock.ts`. Use the `LockConfig()` helper so every field stays
type-checked and unset fields fall back to their defaults:

```ts
// config/lock.ts
import { LockConfig } from "zerotal/lock";

export default LockConfig({
  driver: "memory", // 'memory' | 'sqlite' | 'redis'
  prefix: "zerotal_lock:", // prepended to every lock key
  sqlite: {
    path: ":memory:", // SQLite file path; ':memory:' for in-process
  },
});
```

| Field         | Required | Default           | Description                                            |
| ------------- | -------- | ----------------- | ------------------------------------------------------ |
| `driver`      | no       | `"memory"`        | Storage backend: `memory`, `sqlite`, or `redis`.       |
| `prefix`      | no       | `"zerotal_lock:"` | Key prefix prepended to every lock key.                |
| `sqlite.path` | no       | `":memory:"`      | SQLite file path; `':memory:'` keeps locks in-process. |

The `redis` driver reads its connection from `REDIS_URL` in the environment and
needs no config block of its own.

> **Warning** — SQLite path matters. `path: ':memory:'` is private to a single
> process, so it behaves like the `memory` driver. To coordinate locks across
> processes on one host, point `path` at a **file** (e.g. `storage/locks.sqlite`).

### Which driver should I use?

| Driver   | Scope                   | Use case                                        |
| -------- | ----------------------- | ----------------------------------------------- |
| `memory` | Per-process             | Development, tests, single-instance deployments |
| `sqlite` | Cross-process, one host | Multiple workers on the same server             |
| `redis`  | Cross-host              | Multiple servers — requires `REDIS_URL` in env  |

## Basic usage

The `Lock` facade resolves the live `LockManager` from the container on every
call. `Lock.try` acquires once, runs your callback, and always releases — even if
the callback throws:

```ts
// in a controller or service
import { Lock } from "zerotal/lock";

await Lock.try("invoice:123", 10, async () => {
  // Only one process can run this at a time
  await processInvoice(123);
});
```

The second argument (`10`) is the TTL in seconds — the lock is force-released
after this time even if the callback hasn't finished, preventing deadlocks on
crashes.

## The Lock facade

### Lock.try — fail fast

Acquire once, run the callback, release. Throws `LockNotAcquiredError`
immediately if the lock is already held:

```ts
// in a controller
import { Lock, LockNotAcquiredError } from "zerotal/lock";

try {
  await Lock.try("invoice:123", 10, async () => {
    await processInvoice(123);
  });
} catch (err) {
  if (err instanceof LockNotAcquiredError) {
    // Another process is already handling invoice 123
    return ctx.json({ error: "Processing in progress" }, 409);
  }
  throw err;
}
```

### Lock.block — wait for the lock

Wait up to `options.timeout` seconds for the lock to become free, then run the
callback:

```ts
// in a service
import { Lock } from "zerotal/lock";

await Lock.block(
  "report:export",
  30,
  async () => {
    await generateReport();
  },
  { timeout: 60, retryDelay: 200 },
); // wait up to 60s, poll every 200ms
```

| Option       | Default | Description                             |
| ------------ | ------- | --------------------------------------- |
| `timeout`    | TTL     | Maximum seconds to wait before throwing |
| `retryDelay` | `100`   | Milliseconds between polling attempts   |

### Lock.make — manual handle

For complex flows where you need explicit acquire/release control. `Lock.make`
returns a `ManagedLock` but does **not** acquire it — call `.acquire()` or
`.block()` yourself:

```ts
// in a service
import { Lock } from "zerotal/lock";

const lock = Lock.make("payment:456", 15); // 15-second TTL

if (await lock.acquire()) {
  try {
    await processPayment(456);
  } finally {
    await lock.release();
  }
} else {
  // Lock is busy
}
```

## How locking works — TTL & ownership

Two mechanisms keep locks safe across crashes and races:

- **TTL** — every lock has a time-to-live (the seconds argument). The backend
  auto-expires it after that, so a process that crashes mid-section can never
  deadlock the key forever.
- **Owner token** — each acquisition gets a unique random token (`crypto.randomUUID()`).
  `release()` only deletes the key if you're _still_ the owner. If your lock
  expired and another process re-acquired it, your release is a guarded no-op —
  you can't free someone else's lock.

> **Danger** — Choose a TTL longer than the work. If the callback runs longer
> than the TTL, the lock expires _while you're still working_, a second worker
> can acquire it, and you lose mutual exclusion. Set the TTL above your worst-case
> duration (and add headroom). When you genuinely can't bound the duration, use a
> short TTL with a manual [`ManagedLock`](#lockmake-manual-handle) and re-acquire
> periodically.

The owner guard also means **`Lock.try` / `Lock.block` release automatically** even
when the callback throws — the `finally` runs `release()`, which is owner-checked.

## Common patterns

### Idempotent job processing

```ts
// app/jobs/ProcessOrderJob.ts
import { Lock } from "zerotal/lock";

export class ProcessOrderJob extends Job {
  async handle() {
    await Lock.try(`order:${this.orderId}`, 60, async () => {
      const order = await Order.findOrFail(this.orderId);
      if (order.processed) return; // already done — exit early
      await fulfillOrder(order);
      await order.update({ processed: true });
    });
  }
}
```

### Rate-limited report generation

```ts
// app/controllers/ReportController.ts
import { Lock, LockNotAcquiredError } from "zerotal/lock";

export class ReportController {
  async generate(ctx: HttpContext) {
    try {
      await Lock.block(
        `report:${ctx.user.id}`,
        300,
        async () => {
          const report = await buildReport(ctx.user);
          await report.save();
        },
        { timeout: 5 },
      ); // tell the user within 5s if it's busy
      return ctx.json({ status: "done" });
    } catch (err) {
      if (err instanceof LockNotAcquiredError) {
        return ctx.json({ error: "Report already generating" }, 429);
      }
      throw err;
    }
  }
}
```

## Error handling

Contention surfaces as a single typed error, `LockNotAcquiredError`:

- It carries the contended `key` (`err.key`).
- Its HTTP status is `409 Conflict`, so if it bubbles up to the framework error
  handler unhandled, the client gets a 409 automatically.

The `Lock` facade re-exports it as `Lock.NotAcquired` for terse catch blocks:

```ts
// in a controller
import { Lock } from "zerotal/lock";

try {
  await Lock.try("invoice:123", 10, () => processInvoice(123));
} catch (err) {
  if (err instanceof Lock.NotAcquired) {
    return ctx.json({ error: "Already processing", key: err.key }, 409);
  }
  throw err;
}
```

## Custom drivers

A driver is any object implementing the `LockDriver` contract — each method must
be atomic at the backend level:

```ts
// app/lock/MyLockDriver.ts
import type { LockDriver } from "zerotal/lock";

export class MyLockDriver implements LockDriver {
  acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    /* … */
  }
  release(key: string, owner: string): Promise<boolean> {
    /* owner-guarded */
  }
  forceRelease(key: string): Promise<void> {
    /* … */
  }
  exists(key: string): Promise<boolean> {
    /* … */
  }
  dispose?(): void {
    /* release timers / connections */
  }
}
```

Bind a `LockManager` built around it in a provider that runs **after**
`LockProvider` (last write wins on the `"lock"` key):

```ts
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";
import { LockManager } from "zerotal/lock";
import { MyLockDriver } from "../lock/MyLockDriver.ts";

export class AppServiceProvider extends ServiceProvider {
  override onRegister(): void {
    this.app.container.singleton("lock", () => new LockManager(new MyLockDriver()));
  }
}
```

## Testing

Use the `memory` driver in tests — no external dependencies needed:

```ts
// config/lock.ts
import { LockConfig } from "zerotal/lock";

export default LockConfig({
  driver: Bun.env.APP_ENV === "test" ? "memory" : "redis",
});
```

`memory` is per-process, which is exactly what a test run wants: each test process
sees an isolated, deterministic lock table with no network or file I/O.

## References

`Lock` facade — static entry point resolved from the container on each call:

| Method        | Signature                                                                        | Description                                                     |
| ------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `try`         | `try<T>(key: string, ttlSeconds: number, cb: () => Promise<T> \| T): Promise<T>` | Acquire once, run `cb`, always release. Throws if held.         |
| `block`       | `block<T>(key, ttlSeconds, cb, options?: BlockOptions): Promise<T>`              | Wait up to `options.timeout` seconds, run `cb`, always release. |
| `make`        | `make(key: string, ttlSeconds: number): ManagedLock`                             | Build a manual handle. Does **not** acquire.                    |
| `NotAcquired` | `typeof LockNotAcquiredError`                                                    | Re-export of the contention error for catch blocks.             |

`ManagedLock` — a single named lock instance returned by `Lock.make`:

| Member           | Signature                                                     | Description                                         |
| ---------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `acquire()`      | `acquire(): Promise<boolean>`                                 | Try once — `true` if acquired.                      |
| `block()`        | `block(timeoutSeconds: number, retryDelayMs?): Promise<void>` | Wait up to `timeoutSeconds`, throws on timeout.     |
| `release()`      | `release(): Promise<void>`                                    | Release — no-op if not acquired or already expired. |
| `forceRelease()` | `forceRelease(): Promise<void>`                               | Unconditionally remove, regardless of owner.        |
| `key`            | `get key(): string`                                           | The lock key.                                       |
| `isAcquired`     | `get isAcquired(): boolean`                                   | Whether this instance currently holds the lock.     |

`LockDriver` — the contract a storage backend must implement (all methods atomic):

| Method           | Signature                                                                   | Description                                         |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| `acquire()`      | `acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean>` | `true` when acquired, `false` if held.              |
| `release()`      | `release(key: string, owner: string): Promise<boolean>`                     | Owner-guarded delete; `true` when released.         |
| `forceRelease()` | `forceRelease(key: string): Promise<void>`                                  | Unconditional delete.                               |
| `exists()`       | `exists(key: string): Promise<boolean>`                                     | `true` if the lock is currently held.               |
| `dispose?()`     | `dispose?(): void`                                                          | Release background resources (timers, connections). |

## Next steps

- [Scheduler](/docs/scheduler#preventing-overlapping-runs) — `withoutOverlapping` builds on the same idea for cron tasks.
- [Queue](/docs/queue) — pair locks with jobs for idempotent processing.
- [Cache](/docs/cache) — same driver story (memory / sqlite / redis) for cached values.
