# Changelog — @zerotal/scheduler

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.13.3] — 2026-08-31

### Added

- **A `zt doctor` check for schedules with nothing running them.** Schedules register in
  `worker` and `console`, not `web` — the right design, and it means a second process is
  required that the framework starts happily without.

  Registered and never seen is a **failure**; registered and stale is a warning, because a
  worker mid-restart is not a missing one. The scheduler beats every minute while running.

## [1.10.0] — 2026-08-30

### Fixed

- **A task with a `timezone` no longer takes the whole scheduler down.** The code
  passed croner's options form — `Bun.cron(schedule, { run, timezone })` — on the
  belief that Bun accepted it at runtime and only the types disagreed. It does not:
  it throws, and it throws during _registration_, so the worker died on boot and
  restart-looped. One task with a timezone stopped **every** task in the app,
  including the ones that release inventory holds and chase deposits. Setting a
  timezone is the obvious thing to do for a business that operates in one country and
  is not on UTC, which is most of them.

  Zerotal evaluates the zone itself now. A zoned task registers a minute tick and runs
  on the ticks where its expression matches the wall clock in its own zone — minute
  granularity being the finest `Bun.cron` accepts anyway, so nothing is given up, and
  comparing against the zone's local time rather than an offset computed once is what
  keeps it right across a daylight-saving change. `nextRunAt()` reads the same zone,
  so `schedule:list` and the monitor agree with when the task will actually run.

  The test that covered this asserted the broken behaviour against a mock that
  accepted anything. It now runs against the real `Bun.cron`.

- **A task that cannot register takes only itself out.** Registration throws for
  exactly the reasons that are one task's problem — an expression the runtime
  rejects, a zone it does not know — and letting one propagate meant a typo in one
  schedule stopped every schedule in the app, from a crash loop that named none of
  them. The others start now, and the log names the one that did not.

### Changed

- **`scheduler.timezone` does something.** It was documented as informational and read
  by nothing. It is now the zone every schedule is evaluated in unless the task sets
  its own — one line instead of a `.timezone()` on every task. Its default changed
  from the literal `"UTC"` to **the system zone**, so an app that never set the key
  keeps doing exactly what it did; only an app that explicitly asked for a zone gets
  a change, which is the change it asked for.

### Added

- `UnknownTimeZoneError` (and the `SchedulerError` base it extends) — raised at
  registration and naming the task, rather than a `RangeError` thrown once a minute
  from inside a cron tick with nothing to say which schedule it came from.
- `wallClockIn`, `isValidTimeZone`, `CronExpression.matchesIn` and
  `CronExpression.nextRunAfterIn` — the zone arithmetic the scheduler now uses,
  exported because an app doing its own time-window logic needs the same answers.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.6.0] — 2026-08-15

### Fixed

- **Environment-scoped tasks never ran.** `.environments(["production"])` compared against
  `APP_ENV`, which holds the runtime mode (`web`, `worker`, `console`) once the app has
  booted — so a task restricted to any deployment matched nothing and was skipped silently,
  every time. It reads `deployEnv()` now.

## [1.5.0] — 2026-08-15

### Changed

- **`withoutOverlapping`'s cross-process lock defaults to 5 minutes, not 24 hours.** The
  lock could not be extended, so its TTL had to cover the longest the task might ever run
  — and a scheduler that died mid-run therefore blocked that task for a full day. The lock
  is now heartbeated while the task runs, so the TTL only has to outlive a missed beat.

  `expiresAfterMinutes` keeps working and **changes meaning**: it is now "how long after a
  crash before another host may take this task over", not "how long the task may take". A
  long-running task no longer needs a long value; set one only if you want a crash to be
  slower to recover from. `{ refresh: false }` restores the old behaviour.

  A failed heartbeat does not kill the run. It is logged and the handle dropped — the task
  is already in flight, and stopping it half-finished because another host may now also be
  running does not un-overlap anything, it just adds a second failure.

### Added

- **Durable run history.** Every completed execution (success or failure) is appended to
  a capped JSONL file under `storage/framework/`, so "did the retention sweep run last
  night?" has an answer that survives a restart — previously the only record was
  in-memory task state and whatever the log rotation kept. Read it with the new
  **`bun zt schedule:runs [name]`** (`--limit` to page), through the monitor panel, or
  via `ScheduleRunStore.recent()`. The store is bound as `scheduler.runs` — rebind it to
  move the history elsewhere. Configured under `scheduler.runLog` (`enabled`, `path`,
  `keep`); on by default except under `APP_ENV=test`. A torn tail from a crash
  mid-append is repaired on the next write instead of eating the following record.
- **The monitor panel survives restarts.** The scheduled-tasks section now falls back to
  the recorded history when the in-memory state is empty, marking those values
  "(recorded)", and gained a "Recent runs" table — a task that ran an hour ago no longer
  reads "Never run" after a deploy.
- **Static schedule config is called out.** `static cron = "…"` typechecks (it merely
  declares a new static) and registers nothing, while `static` is exactly the convention
  models (`static fillable`) and Flow components (`static layout`) use — the natural
  first attempt fails silently. Convention discovery now warns at registration, names
  the misdeclared keys, and the finding is surfaced by `bun zt doctor` too
  (`staticScheduleConfigKeys` is exported for reuse).

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
