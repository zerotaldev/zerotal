# Changelog — @zerotal/telemetry

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`**

## [Unreleased]

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Renamed config interface to `TelemetryConfigShape`; added a `TelemetryConfig()` factory.
