# Changelog — @zerotal/testing

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.1.0] — 2026-08-08

### Fixed

- **Test files no longer tear the database out from under each other.** Bun runs a whole suite in one process and the ORM connection is process-global, so one file's `afterAll(() => app.close())` closed the connection every later file depended on — and the file that failed was a correct one that merely ran second, dying with "No database connection. Is DatabaseProvider registered?". `createTestApp()` now shares one app per process, keyed by the resolved `Application` (the scaffolded pattern passes a fresh arrow each time, so the callback identity is no key). `close()` on a shared app resets per-test state and leaves it running.

### Added

- `closeSharedTestApps()` — tears the shared app down explicitly, for a global teardown or a suite asserting no timers leak. Passing a `setup` callback still opts out of sharing, since routes cannot be registered twice against a running server.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
