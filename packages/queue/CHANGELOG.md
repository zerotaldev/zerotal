# Changelog — @zerotal/queue

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Changed

- **`queue:work` finishes the job in hand when it is asked to stop.** It had no stop handler: a
  `SIGTERM`, a `Ctrl+C` or a `zt dev` restart killed it mid-job, and the job stayed reserved
  until its lease ran out. It now stops taking jobs, lets the current one finish and exits 0; a
  second request exits at once. `zt dev` asks over IPC, so this holds on Windows too.
- **The `queue` tab in `bun zt dev` restarts with the server**, so a job, mailable or
  notification you edit runs as saved instead of the code the worker booted with. It is asked to
  stop first and finishes the job it is running.

## [1.18.4] — 2026-11-27

### Fixed

- **`bun zt doctor`'s Queue worker check no longer counts helper files as jobs.** It counted
  every file in `app/jobs`, so a helper beside the jobs made it say "2 job class(es)" while the
  `app/jobs` check above it said one. It now counts a file only when it defines a job, by the
  rule the `app/jobs` check uses. (The `app/jobs` check still reads only the top level of the
  directory, so a job in a subfolder is counted by the worker check alone.)
- **The web process no longer says it drained jobs it never ran.** Every `bun zt dev` restart
  printed `[QUEUE] Draining in-flight jobs` and `All jobs drained` from the server tab, which
  runs no worker. Only a process that ran jobs, or has one in flight, says so.

## [1.18.1] — 2026-11-26

### Fixed

- **Retrying a debounced job no longer fails on a newer dispatch with its key.** A dispatch made
  while a debounced job ran could not collapse into it, because it was reserved, so it waited as
  a second row. When the running job failed and was retried, releasing it made two pending rows
  share the key, which the debounce index forbids: the retry threw a unique-constraint error on
  SQLite, PostgreSQL and MySQL, and the job stayed reserved until the visibility timeout. The
  retry now yields to the newer dispatch, which carries the latest payload: the failed row is
  deleted and the newer one runs. With nothing newer waiting, the retry is unchanged.
- **`zt doctor`'s queue check counts every queue and the app's job classes.** It looked at the
  `default` queue alone, so jobs waiting on `emails` with no worker went unreported. With nothing
  waiting it said "nothing registered, nothing to run" in an app that had jobs, because job
  classes register when a worker imports `app/jobs/` and the doctor runs in the web process. It
  now says `3 job class(es) defined, none waiting` (or that the app defines none), and counts
  waiting jobs across queues, naming them.

## [1.18.0] — 2026-11-26

### Fixed

- **The database queue runs on PostgreSQL and MySQL 8, not only SQLite.** The driver created
  its table with `INTEGER PRIMARY KEY AUTOINCREMENT`, which both servers reject, so an app on
  either failed on its first dispatch and needed Redis for background jobs. The driver now reads
  the engine from the connection and creates tables, claims jobs and collapses debounced
  dispatches in that engine's SQL. On PostgreSQL and MySQL a worker claims a job with
  `FOR UPDATE SKIP LOCKED`, so any number of workers share the table without double-claiming
  or waiting on each other. A batch's failed-job list is read `FOR UPDATE`, so two workers
  failing jobs of one batch at once no longer lose an id. SQLite's schema is unchanged.
- **A failed table setup is retried, not kept.** The driver created its tables once per
  process and kept the result, so one failure, such as PostgreSQL refusing one of two
  processes' concurrent `CREATE … IF NOT EXISTS` on a fresh database, failed every later
  dispatch in that process until it restarted. The next call now runs the setup again.

### Changed

- **BREAKING (types only): `QueueConfigShape["driver"]` gains `"database"`, and it is the default.**
  `QueueConfig()` now fills in `driver: "database"` where it filled in `"sqlite"`. Both names
  select the same driver, so no queue behaves differently, and no config file needs to change.
  Two kinds of code that read the setting do need a change. An exhaustive `switch` over the union
  stops compiling until it has a `"database"` case. A check of `config.get("queue.driver") ===
"sqlite"` that meant "jobs are in the database" no longer matches the default; test for
  `"database"` as well. `SqliteDriver`'s constructor now takes `DatabaseDriverOptions`, a
  superset of the `{ visibilityTimeout?: number }` it took before, so every existing call still
  compiles.

### Added

- **`driver: "database"`, and `DatabaseDriver`.** The names say what the driver is.
  `"database"` is the new default; `"sqlite"` still works and selects the same driver, and
  `SqliteDriver` is the same class. `DatabaseDriverOptions` adds `dialect`, for a connection
  whose engine cannot be read off it.
- **`queue.visibilityTimeout`**, how long a claimed job stays invisible to other workers
  (default 90 seconds). It existed on the driver but could not be set from config, so a job
  slower than 90 seconds was claimed and run a second time by another worker.
- **`Queue.settle()`** runs every job that is due, and the jobs those jobs dispatch, until none
  is left, and resolves to how many ran. It drains every queue the driver can list (the database
  driver), else `default` (Redis, which cannot list them; pass `queues` there). Tests no longer
  need a loop around `processNext()`. Failures are retried or failed as a worker would handle
  them. It stops with `E_QUEUE_SETTLE_LIMIT` once more than `limit` jobs (default 1000) have run,
  so a job that dispatches itself fails the test instead of hanging it.
- **`QueueFake.settle()`** runs the captured jobs in dispatch order, including what they
  dispatch and the next link of a chain, and keeps every job assertable. If any job throws, the
  rest still run and it then throws `E_QUEUE_SETTLE_FAILED` naming each failure.

## [1.16.2] — 2026-10-30

### Fixed

- **A retried, chained or batch-callback job runs under its own `queue`, `maxAttempts` and
  `retryDelay`.** These are the three places the queue pushes a job from a stored class name
  rather than from an instance, and each made the numbers up: `retryFailed()`, behind the admin
  and monitor retry buttons, used three attempts and no delay; the next job in a chain inherited
  the previous job's queue and policy; and a batch's `then`, `catch` and `finally` jobs went to
  `default` with three attempts and one second. A job that declared one attempt, a minute between
  attempts or its own queue did not get them. All three now resolve the class the way
  `queue:retry` always did, through one helper that the command uses too. A retry still goes back
  on the queue it failed on. A failed job whose class is not registered is no longer requeued with
  invented numbers: `retryFailed()` throws a `QueueError` (`E_QUEUE_UNKNOWN_JOB`) and leaves the
  failed row, which the admin panel and the monitor show. A chain link or batch callback whose
  class is not registered, or whose `fromPayload()` throws, has no policy to read either; it is
  queued with the numbers that path used before, with a warning in the log, so the worker moves it
  to the failed jobs where it can be seen and retried, and the job that just finished is not
  retried for it.

## [1.13.3] — 2026-08-31

### Added

- **A `zt doctor` check for jobs waiting with no worker.** The same failure as an unrun
  schedule, one layer over: the queue fills, nothing errors, and you find out when a
  customer asks where their email went.

  Keyed on the pending depth rather than on whether any job class is registered — an app
  with an empty queue and no worker may be perfectly fine, and a doctor that says otherwise
  is one people scroll past.

## [1.13.1] — 2026-08-31

### Added

- **`Job.jobName`** — a declared name for the queue payload, so renaming a job class is free.

  A queued job is a persisted reference to a class: the payload carries a string and the
  worker resolves the class by it, so a job enqueued yesterday is looked up by today's
  process. The class name was therefore a compatibility surface that nothing said was one —
  renaming a job class silently invalidated every job already enqueued under the old name,
  and the failure landed on the deploy rather than on the change. A test never sees it,
  because a test enqueues and runs in the same process.

  `static jobName` decouples the stored identity from the class, exactly as `Migration.id`
  does for a migration's filename, and for the same reason. It defaults to the class name, so
  a job that declares nothing behaves as before.

  Found while sizing a suite-wide rename of `@internal` exports: three `Job` classes were on
  that list, and renaming them would have been a data migration wearing a refactor's clothes.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.7.2] — 2026-08-18

### Fixed

- **`queue:work` listened on one hardcoded queue, so queued notifications were never sent.**
  The `--queue` flag defaulted to the literal string `"default"` and the command never read
  `queue.queues` — the key `QueueProvider`'s in-process pool has always used. A job may pin its
  own queue, and `SendNotificationJob` sets `"notifications"`, so following both documented
  steps — `Notify.queue(user, notification)`, then `bun zt queue:work` — put the mail on a queue
  nobody was reading. Nothing errored. The job sat as pending forever and the worker reported
  "Queue is empty."

  With no `--queue`, the worker now drains every queue in `queue.queues`, falling back to
  `["default"]`. The flag still overrides it and now accepts a comma-separated list
  (`--queue=emails,reports`) in priority order, so one worker can take a subset without a second
  process. `--once` stops at the first queue with a claimable job rather than taking one job per
  queue, and the idle sleep is only taken when _no_ queue had anything — sleeping after the first
  empty one would leave a busy second queue waiting out the poll interval.

## [1.5.0] — 2026-08-15

### Added

- **Debounced jobs — `debounce` on a `Job` collapses repeated dispatches into one run.**
  A document saved eight times in a minute rebuilt its search index eight times, seven
  of them wasted, and the eighth was the only one whose result anybody saw.

  It is a **trailing** debounce and the name is accurate: each dispatch pushes the run
  further out, and the job runs once, after the dispatches stop. The surviving job
  carries the **newest** payload, because the premise is that the earlier ones are stale.

  The default key is the class name plus the serialised payload, so `ReindexDocument(1)`
  and `ReindexDocument(2)` never collapse into each other and the common case needs no
  configuration. Override `debounceKey()` when two payloads mean the same work — a job
  carrying a timestamp is unique on every dispatch and would otherwise collapse with
  nothing.

  **The key lives in the queue's backing store, so it is stable across processes.**
  Collapsing has to be atomic or two processes dispatching at the same instant both find
  nothing pending and both enqueue, which is the failure the feature exists to prevent:
  `sqlite` does it as one `INSERT … ON CONFLICT` against a partial unique index covering
  only unreserved rows, `redis` as one `EVAL`. A driver that cannot promise atomicity
  throws `E_QUEUE_DEBOUNCE_UNSUPPORTED` rather than degrading to a per-process debounce —
  which would appear to work in development and do nothing in production.

  A job a worker has already claimed is never collapsed into: it is running, so the next
  dispatch is genuinely new work. `sync` ignores `debounce`, because every job runs inline
  and there is no window for a second dispatch to arrive in.

### Added

- **The worker runs under `bun zt dev`, in its own tab.** An app with a queue needed
  a second terminal and the discipline to restart the right one after a change; now
  `QueueProvider` registers `queue:work` as a dev process and the runner supervises
  it beside the server, restartable on its own with `r`.

  It declines to appear when it would have nothing to do — under the `sync` driver,
  where every dispatched job runs inline on the request, and when `queue.workers` is
  set, where the server's own thread pool is already draining the queue. A tab that
  polls an empty queue forever is worse than no tab, because it looks like it is
  working.

  Drop it with `app.dev.disable: ["queue"]`, or replace it by registering `queue`
  yourself in `app.dev.processes`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Added a typed error vocabulary (`QueueError` + `E_QUEUE_*` codes) for init/shutdown/batching failures.
