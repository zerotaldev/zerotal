# Changelog — @zerotal/flow-ui

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `experimental`**

## [Unreleased]

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Fixed

- **`Dialog`/`Sheet` resolve their `show` binding from the compiler's `__flowBinds`.** They now consult `_injectedBindKey(props, "show")` before value-based resolution, so a dialog or sheet with bound children (e.g. a `Checkbox`/`Input` inside) binds reliably instead of degrading to unbound when the bound props share a value. Matches the flow bind-name injection pass; no API change.

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
