# @zerotal/scheduler

> Cron-style task scheduling with class-based schedules and a fluent facade.

Run tasks on a cron-like cadence. Drop a `Schedule` subclass in `app/schedules/` for auto-registered, testable tasks, or use the `Scheduler` facade for quick inline definitions. Schedules run in the worker process (`bun zt worker`).

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/scheduler
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { SchedulerProvider } from "@zerotal/scheduler";
```

## Usage

The recommended approach is class-based — extend `Schedule`, declare the cadence, and put the work in `handle()`. Every subclass under `app/schedules/` is discovered automatically:

```ts
import { Schedule } from "@zerotal/scheduler";
import { Queue } from "@zerotal/queue";

export class SendDailyReports extends Schedule {
  cron = "0 8 * * *"; // every day at 08:00
  withoutOverlapping = true;

  async handle(): Promise<void> {
    await Queue.dispatch(new SendReportsJob());
  }
}
```

Prefer the fluent frequency builder when it reads better — override `frequency()`:

```ts
import { Schedule, type SchedulerBuilder } from "@zerotal/scheduler";

export class WarmCache extends Schedule {
  override frequency(every: SchedulerBuilder) {
    return every.everyFiveMinutes();
  }
  async handle(): Promise<void> {
    await Cache.forget("posts:page:1");
  }
}
```

For one-liners, use the `Scheduler` facade — `job()` returns the `ScheduledTask` for fluent tuning:

```ts
import { Scheduler } from "@zerotal/scheduler";

Scheduler.job("nightly-backup", () => runBackup())
  .dailyAt("02:30")
  .timezone("Africa/Johannesburg")
  .withoutOverlapping({ expiresAfterMinutes: 30 })
  .environments(["production"]);
```

In tests, `runNow()` executes the handler immediately, bypassing the cron/time guards:

```ts
const task = Scheduler.job("report", () => generateReport()).dailyAt("08:00");
await task.runNow();
expect(task.lastOk).toBe(true);
```

## Exports

| Export                                                                        | Description                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Scheduler`                                                                   | Fluent inline scheduling facade.                                       |
| `Schedule`                                                                    | Base class for convention-based schedules in `app/schedules/`.         |
| `SchedulerManager`, `SchedulerBuilder`                                        | The manager and the cadence builder.                                   |
| `ScheduledTask`                                                               | A single registered task — introspection, `runNow()`, lifecycle hooks. |
| `CronExpression`                                                              | Cron expression parser / next-run calculator.                          |
| `schedulesConcern`, `registerSchedule`                                        | Convention loader hooks.                                               |
| `SchedulerProvider`                                                           | Service provider — register in `bootstrap/providers.ts`.               |
| `SchedulerConfig`, `SchedulerConfigShape`                                     | Config factory and its type.                                           |
| `TaskCallback`, `TaskGuard`, `TaskHook`, `OutputMailer`, `OverlapLockOptions` | Supporting types.                                                      |

## Documentation

- [Scheduler](../../docs/scheduler.md)
