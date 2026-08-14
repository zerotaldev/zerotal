# Changelog — @zerotal/queue

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
