# Changelog — @zerotal/session

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **`ctx.session.intended()` reads the URL `AuthMiddleware` stored.** It did not.
  `captureIntended()`/`intended()` used the session key `intended` while
  `AuthMiddleware`, `ConfirmPasswordMiddleware` and `redirect().intended()` used
  `intended_url`. Each pair was internally consistent and separately tested, so every
  test passed — and an app that mixed them, which the documentation invites by
  describing both, got the fallback every time from a session that had the value
  sitting in it under the other name. Nothing failed; the user was simply always sent
  to `/` after signing in, which from the outside reads as the intended URL not
  surviving login.

  Both APIs now use `intended_url`. The old key is still read, so a session captured
  before the upgrade and consumed after it still lands where it should.

- **`ctx.session.intended()` refuses a cross-origin URL**, the guard
  `redirect().intended()` already applied. Which of two APIs for one job you happened
  to reach for should not decide whether an open redirect is possible.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

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
