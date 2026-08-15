# Changelog — @zerotal/session

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.5.0] — 2026-08-15

### Changed

- **`get` and `pull` take an optional `<T>`.** `SessionManager` implements
  `SessionContract`, and `ctx.session` _is_ typed as that contract — so
  `ctx.session.get<number>("attempts")` was a compile error while
  `ctx.flashed<T>(k)` on the same object was not, and the docs documented the
  form that did not exist. `<T>` defaults to `unknown`, so the read-then-narrow
  form is unchanged and nothing that compiled before stops compiling.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Added a typed error vocabulary (`SessionError` + `E_SESSION_*` codes) for missing secret/driver.
