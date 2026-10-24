# Changelog — @zerotal/cache

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **`Cache.increment()` and `Cache.decrement()`: a counter that several processes can share.**
  Adding to a number with `get()` and `set()` loses an update whenever two processes interleave,
  which for a spend ceiling or a rate counter is always an under-count. `increment(key, by = 1,
ttl?)` does the addition inside the driver (an upsert on SQLite, `INCRBYFLOAT` on Redis, one
  step in memory) and returns the new total. An absent, expired or non-numeric key counts as 0,
  and `ttl` applies when the call creates the entry, so a daily counter expires with its day.
  `CacheDriver.increment` is optional; a driver without it gets a read-then-write fallback.

### Fixed

- **The cache is available in the worker, so the scheduler's heartbeat reaches `zt doctor`.**
  `CacheProvider` was registered in web, console, test and repl but not in the worker, which is
  where the scheduler runs. Its heartbeat resolved no cache and did nothing, as a heartbeat
  should rather than take a worker down, and `zt doctor` reported a worker that was running
  every schedule as one that had never checked in: the failure the check exists to catch,
  raised about a healthy process. Code that uses `Cache` in a worker had no cache either. With a
  file-backed or Redis cache the heartbeat is shared with doctor; with the in-memory driver
  doctor still says it cannot verify, as before.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.5.0] — 2026-08-15

### Fixed

- **Stampede protection survives a compute slower than 30 seconds.** `remember()`'s
  recompute lock had a fixed 30s TTL and no way to extend it, so a factory that ran longer
  silently dropped its lock and let a second node in — and an expensive query is the only
  kind anyone bothers caching, so the protection failed precisely where it was needed. The
  lock now refreshes for as long as the factory runs. A lock lost anyway falls back to
  re-checking the cache and recomputing, which is what a timed-out waiter already did:
  caching is best-effort here, not a correctness boundary.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Added a typed error vocabulary (`CacheError`/`CacheSerializationError`/`CacheDeserializationError`, `E_CACHE_*` codes).
