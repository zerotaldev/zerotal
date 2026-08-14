# Changelog — @zerotal/cache

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
