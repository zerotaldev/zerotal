# Changelog — @zerotal/queue

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
