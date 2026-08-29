# Changelog — @zerotal/telemetry

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.5.0] — 2026-08-15

### Added

- **Tests for the exporters and the request middleware — the package's entire
  output path.** Spans, context propagation and the event bridge were all covered,
  which left the untested part the part that actually produces something. Both of
  its failure modes are quiet:

  - **A mistyped attribute.** OTLP types each value (`stringValue`, `intValue`,
    `doubleValue`, `boolValue`), and a backend indexes on that type — an integer
    sent as a string still shows in the trace but stops being aggregatable. Now
    pinned per type, along with millisecond→nanosecond conversion (sending
    milliseconds puts every span in 1970 with no error raised) and the empty
    `parentSpanId` a root span needs, since a null there makes a collector drop
    the batch.
  - **An exporter that throws.** A collector being down must never surface as a
    500 on a user's request; that the `fetch` failure is swallowed is now a test
    rather than a comment.

  `TelemetryMiddleware` gained coverage for the root span every child span
  attaches to: the `http.*` attributes, 5xx as error while 4xx stays ok (marking
  404s as errors makes an error-rate dashboard useless), the span ending even when
  no response was produced, and staying inert when no tracer is configured.
  35 tests → 56.

### Changed

- **`NoopSpan` and `_randomHex` are marked `@internal`** — a null-object span and a
  hex generator for trace ids, neither of them API. The promise is 12 exports, not 14.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Every promised export is documented, the output path is covered,
  and the only dependency is `@zerotal/core`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Renamed config interface to `TelemetryConfigShape`; added a `TelemetryConfig()` factory.
