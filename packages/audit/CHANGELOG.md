# Changelog — @zerotal/audit

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.5.0] — 2026-08-15

### Added

- **Tests for the update path — the one that makes an audit trail worth having.**
  `created` and `deleted` snapshot a single state and are hard to get subtly wrong.
  An update is recorded in two phases, because the previous values only exist until
  the ORM refreshes its snapshot: `saving` stashes them in a WeakMap and `updated`
  consumes them. Every failure there is silent — a stash that read the _new_ values
  would make every row show old and new identical while still looking populated, and
  a stash that was never consumed would attach one edit's history to the next write.
  Now pinned, along with the filters applying to both sides of the record (recording
  an old password while scrubbing the new one would defeat `auditExcept` entirely)
  and two interleaved models keeping their stashes apart. 19 tests → 28.

- **`AuditObserver` and `DatabaseDriver` are documented.** Both were exported and
  neither appeared in the guide; the driver table now names its class so a custom
  driver can wrap it rather than reimplement it.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. All ten exports are documented, the record-producing path is
  covered, and the package depends only on `@zerotal/core` and `@zerotal/orm`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Moved service provider to `src/provider/`.
- Config factory renamed to `AuditConfig` (PascalCase) with a deprecated `auditConfig` alias.
- Added test suite.
