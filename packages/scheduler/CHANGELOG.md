# Changelog — @zerotal/scheduler

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
