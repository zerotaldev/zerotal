---
title: Scheduler
description: Run recurring tasks on a cron-like schedule from class files or a fluent facade, executed in the worker process.
---

# Scheduler

Run tasks on a cron-like schedule without editing the system crontab. Drop a
`Schedule` subclass in `app/schedules/` and it is auto-registered at boot; a
fluent `Scheduler` facade is also available for quick inline definitions.
Schedules fire in the worker process (`bun zt worker`).

## Getting Started

```bash
# in your project root
bun add @zerotal/scheduler
```

## Register the provider

Add `SchedulerProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { SchedulerProvider } from "@zerotal/scheduler";

const providers = [
  // …your other providers
  SchedulerProvider,
];

export default providers;
```

Registering the provider switches on the following, in lifecycle order:

- `onRegister` — registers the `app/schedules/` convention, binds the
  `scheduler` manager and the `scheduler.runs` run store as lazy singletons, and
  contributes the static-config check to `zt doctor`.
- `onBooting` — resolves the `scheduler` binding so it is ready before boot finishes.
- `onBooted` — subscribes the run log to task events and lazily registers the
  `schedule:list` and `schedule:runs` commands (when a command runner is present).
- `onStarted` — calls `scheduler.start()`, arming every registered cron.
- `onStopped` — calls `scheduler.stop()`, so nothing leaks between boots or test suites.

> **Note** — The provider itself loads in `web`, `console`, and `worker`, but the
> `app/schedules/` discovery convention runs only in `worker` (to execute the
> tasks) and `console` (so `schedule:list` can enumerate them). It never runs in
> `web`, so your HTTP instances don't fire cron. See
> [Conventions](/docs/conventions#schedules-appschedules).

## Configuration

Create `config/scheduler.ts` with the `SchedulerConfig()` helper so every field
stays type-checked:

```typescript
// config/scheduler.ts
import { SchedulerConfig } from "@zerotal/scheduler";
import { env } from "zerotal";

export default SchedulerConfig({
  timezone: env("APP_TIMEZONE", "UTC"),
});
```

| Field      | Required | Default | Description                                                                             |
| ---------- | -------- | ------- | --------------------------------------------------------------------------------------- |
| `timezone` | no       | `"UTC"` | Informational only — `Bun.cron` uses the system timezone. Set per task with `timezone`. |

> **Note** — The config `timezone` is informational. To evaluate a cron in a
> specific zone, set `timezone` on the `Schedule` subclass or `.timezone(tz)` on a
> facade task; that value is passed through to `Bun.cron`.

## Defining schedules

Create a class that extends `Schedule`, put the work in `handle()`, and declare the
cadence with either a `cron` string or the fluent `frequency()` method. Every
`Schedule` subclass under `app/schedules/` is discovered and registered
automatically — no manual wiring, no central list.

```typescript fragment
// app/schedules/SendDailyReports.ts
import { Schedule } from "@zerotal/scheduler";
import { Queue } from "@zerotal/queue";
import { SendReportsJob } from "../jobs/SendReportsJob.ts";

export class SendDailyReports extends Schedule {
  cron = "0 8 * * *"; // every day at 08:00
  timezone = "Africa/Johannesburg";
  withoutOverlapping = true;

  async handle(): Promise<void> {
    await Queue.dispatch(new SendReportsJob());
  }
}
```

Prefer the fluent frequency builder over a raw cron string when it reads better —
override `frequency()` and return a configured task:

```typescript fragment
// app/schedules/WarmCache.ts
import { Schedule, type SchedulerBuilder } from "@zerotal/scheduler";

export class WarmCache extends Schedule {
  override frequency(every: SchedulerBuilder) {
    return every.everyFiveMinutes();
  }
  withoutOverlapping = true;

  async handle(): Promise<void> {
    await Cache.forget("posts:page:1");
  }
}
```

### Class-based vs the facade — which should I use?

- **Class-based (`Schedule` subclass)** — the default for anything non-trivial.
  It's auto-discovered, testable in isolation, and keeps each task in its own
  file under `app/schedules/`.
- **The `Scheduler` facade** — reach for it for one-liners or inline definitions
  inside a provider (see [Inline schedules](#inline-schedules)).

### Settings reference

Every setting is an optional property (or method) on your `Schedule` subclass:

| Setting                                                        | Type                            | Description                                                                                                   |
| -------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `handle()`                                                     | method (required)               | The work to perform on each run.                                                                              |
| `cron`                                                         | `string`                        | Cron expression (5- or 6-field). Set this **or** override `frequency()`.                                      |
| `frequency(every)`                                             | method                          | Build the cadence fluently; return the task (see helpers below).                                              |
| `name`                                                         | `string`                        | Task name in `schedule:list` and logs. Defaults to the class name.                                            |
| `timezone`                                                     | `string`                        | IANA timezone the cron is evaluated in.                                                                       |
| `withoutOverlapping`                                           | `boolean \| OverlapLockOptions` | Skip a tick while a previous run is active; also takes a cross-process lock when a lock driver is configured. |
| `environments`                                                 | `string[]`                      | Only run when `APP_ENV` is one of these.                                                                      |
| `inBackground`                                                 | `boolean`                       | Run the body without blocking the scheduler tick.                                                             |
| `between`                                                      | `[string, string]`              | Only run between `"HH:MM"` and `"HH:MM"`.                                                                     |
| `unlessBetween`                                                | `[string, string]`              | Never run between `"HH:MM"` and `"HH:MM"`.                                                                    |
| `pingBefore` / `pingAfter` / `pingOnSuccess` / `pingOnFailure` | `string`                        | Health-check URLs fetched at each lifecycle point.                                                            |
| `appendOutputTo`                                               | `string`                        | Append captured console output to a file.                                                                     |
| `emailOutputTo`                                                | `string`                        | Email captured console output (needs an output mailer).                                                       |
| `when()`                                                       | method → `boolean`              | Dynamic guard — run only when truthy.                                                                         |
| `skip()`                                                       | method → `boolean`              | Dynamic guard — skip when truthy.                                                                             |

> **Warning** — These are **instance** properties. `static cron = "…"`
> typechecks (it merely declares a new static member) but registers nothing —
> unlike `static fillable` on a model or `static layout` on a Flow component.
> Discovery warns at boot when it sees static schedule config, and
> `bun zt doctor` reports it.

```typescript fragment
// app/schedules/NightlyBackup.ts
import { Schedule, type SchedulerBuilder } from "@zerotal/scheduler";

export class NightlyBackup extends Schedule {
  frequency(every: SchedulerBuilder) {
    return every.dailyAt("02:30");
  }
  environments = ["production"];
  between: [string, string] = ["00:00", "05:00"];
  pingOnSuccess = "https://hc-ping.com/abc";

  async handle(): Promise<void> {
    /* … */
  }
  when() {
    return featureFlags.backupsEnabled;
  }
}
```

### Frequency helpers

The `frequency(every)` builder (and the [`Scheduler` facade](#inline-schedules))
expose fluent cadence methods. Each returns the configured task.

| Method                            | Cron expression       | Description                    |
| --------------------------------- | --------------------- | ------------------------------ |
| `.everySecond()`                  | `* * * * * *`         | Every second (6-field)         |
| `.everyFiveSeconds()`             | `*/5 * * * * *`       | Every five seconds             |
| `.everyThirtySeconds()`           | `*/30 * * * * *`      | Every thirty seconds           |
| `.everyMinute()`                  | `* * * * *`           | Every minute                   |
| `.everyFiveMinutes()`             | `*/5 * * * *`         | Every five minutes             |
| `.everyFifteenMinutes()`          | `*/15 * * * *`        | Every fifteen minutes          |
| `.everyThirtyMinutes()`           | `*/30 * * * *`        | Every thirty minutes           |
| `.hourly()`                       | `0 * * * *`           | Top of every hour              |
| `.hourlyAt(15)`                   | `15 * * * *`          | A specific minute each hour    |
| `.daily()`                        | `0 0 * * *`           | Midnight every day             |
| `.dailyAt("13:30")`               | `30 13 * * *`         | A specific time daily          |
| `.twiceDaily(1, 13)`              | `0 1,13 * * *`        | Two specific hours daily       |
| `.weekly()`                       | `0 0 * * 0`           | Midnight every Sunday          |
| `.mondays()` … `.sundays()`       | `0 0 * * N`           | A specific weekday at midnight |
| `.weekdays()` / `.weekends()`     | `0 0 * * 1-5` / `6,0` | Mon–Fri / Sat–Sun              |
| `.days([1, 4])`                   | `0 0 * * 1,4`         | Specific weekdays              |
| `.monthly()`                      | `0 0 1 * *`           | Midnight on the 1st            |
| `.twiceMonthly(1, 16)`            | `0 0 1,16 * *`        | Two days each month            |
| `.lastDayOfMonth("23:00")`        | guarded               | Last calendar day of the month |
| `.quarterly()` / `.quarterlyOn()` | `0 0 1 1,4,7,10 *`    | First day of each quarter      |
| `.yearly()` / `.yearlyOn()`       | `0 0 1 1 *`           | Once a year                    |
| `.cron("0 9 * * 1")`              | custom                | Any raw cron expression        |

> **Warning** — Sub-minute cadences use a 6-field cron (`sec min hour day month weekday`).
> They only make sense in a long-lived worker process — don't pair them with
> inline polling. `.lastDayOfMonth()` schedules a daily check (`28-31`) guarded by
> a `when()` that fires only on the actual last day.

## Inline schedules

For quick, in-code definitions (e.g. inside a provider) use the `Scheduler` facade,
which exposes the underlying manager fluently:

```typescript fragment
// in a provider's onBooted()
import { Scheduler } from "@zerotal/scheduler";

Scheduler.job("cleanup-sessions", () => Session.prune()).daily();
Scheduler.job("warm-cache", () => Cache.forget("posts:page:1")).cron("*/5 * * * *");

// Or register a task directly:
Scheduler.add("rotate-logs", "0 */6 * * *", () => rotateLogs());
```

`job()` returns a `SchedulerBuilder`; each cadence method returns the
`ScheduledTask`, so you can chain the same fluent tuning the class form exposes
declaratively:

```typescript fragment
// in a provider's onBooted()
Scheduler.job("nightly-backup", () => runBackup())
  .dailyAt("02:30")
  .timezone("Africa/Johannesburg")
  .withoutOverlapping({ expiresAfterMinutes: 30 })
  .environments(["production"])
  .between("00:00", "05:00")
  .onSuccess(() => logger.info("backup ok"))
  .onFailure((err) => logger.error("backup failed", err))
  .pingOnSuccess("https://hc-ping.com/abc");
```

| Tuning method                                            | Effect                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| `.timezone(tz)`                                          | Evaluate the cron in an IANA timezone.              |
| `.withoutOverlapping(opts?)`                             | Skip a tick while a prior run is active.            |
| `.environments([...])`                                   | Only run in the listed `APP_ENV`s.                  |
| `.between(s, e)` / `.unlessBetween(s, e)`                | Time-window guards (`"HH:MM"`).                     |
| `.when(fn)` / `.skip(fn)`                                | Dynamic run / skip guards.                          |
| `.runInBackground()`                                     | Don't block the scheduler tick.                     |
| `.onStart/onSuccess/onFailure(fn)`                       | Lifecycle callbacks (failure receives the `Error`). |
| `.pingBefore/pingAfter/pingOnSuccess/pingOnFailure(url)` | Health-check pings.                                 |
| `.appendOutputTo/sendOutputTo/emailOutputTo`             | Capture console output (see below).                 |

> **Tip** — Prefer class-based schedules for anything non-trivial — they're
> discoverable, testable, and keep each task in its own file. Reach for the facade
> for one-liners.

## Listing schedules

```bash
# in your project root
bun zt schedule:list
```

Prints every registered task with its cron expression, a human-readable
description of the cadence, and the next computed run time:

```text
Scheduled tasks (2)
  Name         SendDailyReports
  Expression   0 8 * * *
  Description  At 08:00 every day
  Next run     2026-06-22T06:00:00.000Z
```

## Run history

Every completed execution — success or failure — is recorded to a capped JSONL
file under `storage/framework/`, so the history survives restarts. "Did the
retention sweep run last night?" is answered from the record, not from memory:

```bash
# in your project root
bun zt schedule:runs                  # recent runs, newest first
bun zt schedule:runs popia:sweep      # one task's runs
bun zt schedule:runs --limit 50
```

```text
Recent runs (2)
  Task      popia:sweep
  Started   2026-08-10T03:00:00.000Z
  Duration  5210 ms
  Result    OK
```

Configure it under `runLog` in `config/scheduler.ts` — `enabled` (default: on,
except under `APP_ENV=test`), `path`, and `keep` (records retained after
compaction, default 500). The store is bound in the container as
`scheduler.runs`; rebind it to keep the history somewhere else, such as Redis.
The [monitoring panel's](monitor.md) scheduled-tasks section reads the same
record, so a task that last ran before a deploy shows that run — marked
"(recorded)" — instead of "Never run".

Skipped ticks (environment, time window, `when()`/`skip()` guards, overlap) are
deliberate non-runs and are not recorded.

## Preventing overlapping runs

A long task can still be running when its next tick fires. `withoutOverlapping`
skips the new tick while the previous run is active:

```typescript
// app/schedules/RebuildSearchIndex.ts
import { Schedule } from "@zerotal/scheduler";

export class RebuildSearchIndex extends Schedule {
  cron = "*/5 * * * *";
  withoutOverlapping = true; // in-process guard

  async handle(): Promise<void> {
    /* … */
  }
}
```

The `true` form always guards **within a single process**, and — when a lock driver
is configured (Redis or SQLite via the [lock primitive](/docs/lock)) — also takes a
**cross-process lock** so only one worker runs the task per tick across all your
machines. Cross-process locking is **on by default**; pass `{ crossProcess: false }`
to guard within this process only:

```typescript fragment
// app/schedules/RebuildSearchIndex.ts
withoutOverlapping = { expiresAfterMinutes: 30 }; // cross-process (default)
// withoutOverlapping = { crossProcess: false };        // in-process guard only
```

With no lock driver registered it degrades to the in-process guard. A skipped tick
emits a `TaskSkipped` event with reason `"overlap"` (in-process) or `"lock"`
(cross-process).

**`expiresAfterMinutes` is a recovery time, not a duration budget.** The lock is
refreshed while the task runs — see
[Long-running work](/docs/lock#long-running-work) — so it only has to outlive a
missed heartbeat. It answers "how long after this host dies before another may
take the task over", and defaults to 5 minutes.

That is a change in meaning worth knowing if you set it before: it used to have to
cover the longest the task might ever run, which is why it defaulted to 24 hours
and why a crashed scheduler could block a task until the next afternoon. A
long-running task no longer needs a long value here — set one only if you want a
crash to take _longer_ to recover from.

Pass `{ refresh: false }` for the old behaviour, where the task must finish inside
`expiresAfterMinutes` or lose its lock.

## Capturing output

Anything the task writes to `console.log` can be persisted or emailed:

| Setting / method | Behaviour                                                 |
| ---------------- | --------------------------------------------------------- |
| `appendOutputTo` | **Append** captured output to a file (keeps history).     |
| `sendOutputTo`   | **Overwrite** a file with the latest run's output.        |
| `emailOutputTo`  | Email the output — requires an output mailer (see below). |

> **Note** — `sendOutputTo` is a facade-only tuning method; on a `Schedule`
> subclass, use the `appendOutputTo` or `emailOutputTo` properties.

```typescript fragment
// app/schedules/GenerateSitemap.ts
import { Schedule } from "@zerotal/scheduler";

export class GenerateSitemap extends Schedule {
  cron = "0 3 * * *";
  appendOutputTo = "storage/logs/sitemap.log";

  async handle(): Promise<void> {
    console.log(`Sitemap generated with ${count} URLs`); // captured to the log
  }
}
```

`emailOutputTo` needs a mailer wired once at boot — set `ScheduledTask.outputMailer`,
a `(email, subject, body) => void | Promise<void>` function, in a provider's
`onBooted()` (without it, the output is logged with a notice instead of sent):

```typescript
// in a provider's onBooted()
import { ScheduledTask } from "@zerotal/scheduler";
import { Notify } from "@zerotal/notifications";

ScheduledTask.outputMailer = async (email, subject, body) => {
  // ScheduleOutputNotification implements toMail() from subject/body.
  await Notify.send({ email }, new ScheduleOutputNotification(subject, body));
};
```

## Observability — task events

Every run emits a framework event you can listen for to feed metrics, logs, or
alerts. Subscribe in a provider's `onBooted()`:

```typescript fragment
// in a provider's onBooted()
import { FrameworkEvents } from "zerotal";
import { TaskRan, TaskFailed, TaskSkipped } from "@zerotal/scheduler";

FrameworkEvents.on(TaskRan, (e) => metrics.timing(`schedule.${e.name}`, e.durationMs));
FrameworkEvents.on(TaskFailed, (e) => logger.error(`schedule ${e.name} failed: ${e.error}`));
FrameworkEvents.on(TaskSkipped, (e) => logger.debug(`schedule ${e.name} skipped (${e.reason})`));
```

| Event         | Fields                        | Emitted when                                 |
| ------------- | ----------------------------- | -------------------------------------------- |
| `TaskRan`     | `name`, `durationMs`, `ok`    | A run finishes (success or handled failure). |
| `TaskFailed`  | `name`, `durationMs`, `error` | The handler throws (`error` is the message). |
| `TaskSkipped` | `name`, `reason`              | A tick is skipped before running.            |

`TaskSkipped.reason` is one of `"env"`, `"window"`, `"when"`, `"skip"`,
`"overlap"`, or `"lock"` — matching each guard.

### In the monitoring panel

A cron task that silently stops firing is one of the harder failures to notice:
nothing errors, work just stops happening. When [`@zerotal/monitor`](/docs/monitor)
is installed, the scheduler contributes a **Scheduled tasks** section to it — no
configuration, just both providers registered.

It leads with counts of tasks that are currently running, failing, or have never
run at all, then lists every task with its cron expression, last result, run
duration and next due time. The "never run" count is the one worth watching: a
task that has been registered but never fired usually means a guard or an
environment filter is excluding it.

The scheduler does not depend on the monitor package to do this — it resolves the
panel's contribution surface from the container at boot and describes the section
as data. To keep the scheduler but drop the section, set
`sections: { scheduler: false }` in `config/monitor.ts`.

## Testing

`ScheduledTask` exposes introspection getters and a `runNow()` that executes the
handler immediately, bypassing the cron/time-window guards — ideal in tests:

```typescript fragment
// in a test
import { Scheduler } from "@zerotal/scheduler";

const task = Scheduler.job("report", () => generateReport()).dailyAt("08:00");

await task.runNow(); // run the body now, ignoring the schedule
expect(task.lastOk).toBe(true);
expect(task.lastRunAt).toBeInstanceOf(Date);

// Assert the cadence without waiting for the clock
const next = task.nextRunAt(new Date("2026-06-21T09:00:00Z"));
expect(next?.toISOString()).toBe("2026-06-22T08:00:00.000Z");
```

## Running the worker

Schedules fire in **worker mode** — a separate Bun process started by the CLI. When
`bun zt worker` boots, the framework sets `APP_ENV=worker`.

```bash
# in your project root
bun zt worker       # starts the queue worker + scheduler
```

For simpler deployments, `AppServiceProvider.onStarted()` can run inline polling
instead of a dedicated worker process (skip it when this IS the worker):

```typescript fragment
// app/providers/AppServiceProvider.ts (onStarted)
override async onStarted(): Promise<void> {
  if (Bun.env.APP_ENV === "worker") return; // dedicated worker handles it

  setInterval(async () => {
    if (Queue.isShuttingDown) return;
    await Queue.processNext("default").catch(console.error);
  }, 500);
}
```

For production, run the worker as a separate process so it can be scaled, restarted,
and monitored independently of the web server.

## References

The `Scheduler` facade resolves the `scheduler` container binding — a
`SchedulerManager`. `job()` returns a `SchedulerBuilder`; cadence methods return a
`ScheduledTask`.

### Commands

`@zerotal/scheduler` ships one command:

| Command                       | What it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `bun zt schedule:list`        | List scheduled tasks with their next run time          |
| `bun zt schedule:runs [name]` | Recent recorded runs, newest first (`--limit` to page) |

### SchedulerManager

| Method  | Signature                                                          | Description                                        |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `add`   | `add(name: string, cron: string, cb: TaskCallback): ScheduledTask` | Register a task from a raw cron expression.        |
| `job`   | `job(name: string, cb: TaskCallback): SchedulerBuilder`            | Start a fluent definition; pick a cadence next.    |
| `start` | `start(): void`                                                    | Arm every registered task (called in `onStarted`). |
| `stop`  | `stop(): void`                                                     | Stop every running task.                           |
| `tasks` | `get tasks(): ReadonlyMap<string, ScheduledTask>`                  | The registered tasks, keyed by name.               |

### ScheduledTask introspection

| Member             | Signature                                   | Description                                       |
| ------------------ | ------------------------------------------- | ------------------------------------------------- |
| `runNow()`         | `runNow(): Promise<void>`                   | Runs the handler now, skipping all guards.        |
| `nextRunAt(from?)` | `nextRunAt(from?: Date): Date \| null`      | Next fire time after `from` (or `null` if never). |
| `lastRunAt`        | `get lastRunAt(): Date \| undefined`        | When the task last ran, or `undefined`.           |
| `lastOk`           | `get lastOk(): boolean \| undefined`        | Whether the last run succeeded.                   |
| `lastDurationMs`   | `get lastDurationMs(): number \| undefined` | Duration of the last run in ms.                   |
| `isRunning`        | `get isRunning(): boolean`                  | `true` while a run is in flight.                  |

## Types

| Type                                    | What it is                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CronExpression`                        | The schedule string a task declares.                                                         |
| `TaskGuard`                             | A condition deciding whether a due run actually happens — a feature flag, a leader election. |
| `TaskHook`                              | What runs before or after a task.                                                            |
| `ScheduleRunRecord`, `ScheduleRunStore` | One recorded run, and where the log is kept.                                                 |
| `RunLogConfig`                          | How much of that log is retained.                                                            |
| `OutputMailer`                          | Sending a task's output somewhere when it finishes.                                          |

## Next steps

- [Queue](/docs/queue) — schedules typically dispatch jobs; the worker runs both.
- [Conventions](/docs/conventions#schedules-appschedules) — how `app/schedules/` is discovered.
- [Events](/docs/events) — the `FrameworkEvents` bus the task events flow through.
- [Notifications](/docs/notifications) — wire the output mailer for `emailOutputTo`.
