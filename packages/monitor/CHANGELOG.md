# Changelog — @zerotal/monitor

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.5.1] — 2026-08-15

### Fixed

- **Open-by-default access in development never applied.** The predicate read `APP_ENV`,
  which holds the runtime mode once the app has booted, so the panel demanded an explicit
  `auth` predicate even on a developer's machine. It asks `devSurfacesEnabled()` now — and
  still requires one anywhere that is not explicitly a development environment.

## [1.5.0] — 2026-08-15

### Added

- **Tests for the three riskiest untested modules**, chosen by consequence rather
  than by coverage percentage:

  - **`MonitorAuthMiddleware`** — the only thing between the public internet and a
    page showing recent requests, their users, their IPs and the SQL the app ran.
    Pinned against the two ways a gate fails open without anyone noticing: a
    forgotten `await` on an async predicate (a promise is always truthy, so a
    denying predicate would admit everyone) and a predicate that throws. Also pins
    that the _default_ predicate survives config merging as a callable — `deepMerge`
    cannot carry a function through, and the reattach only fires when the caller
    supplied one.
  - **`RingBuffer` / `TimeWindow` / `percentile`** — the bounded structures that
    keep monitoring memory from growing without limit. A buffer that quietly stops
    evicting is a memory leak in the observability layer, and an off-by-one
    percentile misreports latency in the direction nobody checks.
  - **`renderPrometheus`** — the one output a machine parses rather than a person
    reads, where a scraper rejects a malformed response without telling the
    application. Covers label escaping for route paths carrying a quote, a
    backslash or a newline, and metric-name sanitisation for display-string gauge
    labels — all of which come from application data, so none are hypothetical.

  Monitor's suite goes from 49 tests to 81.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Both gates are closed: `@zerotal/flow` and `@zerotal/flow-ui` (which
  the panel renders through) are themselves stable now, and the coverage gap is closed
  where it mattered.

  Worth stating plainly, since the surface looks larger than it is: of 685 lines of
  public API, 65 entries are type definitions describing the snapshot shape and only
  11 are callable entry points — every one of which is documented.

## [1.1.0] — 2026-08-08

### Fixed

- **The reported framework version follows the release.** Two hardcoded version strings in `sources/live.ts` and `sources/system.ts` meant a monitored app reported whatever version was current when those lines were last edited. They now read the package's own manifest, which the lockstep release keeps correct.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.2] — 2026-08-06

### Fixed

- Reported framework version was stale again; it now matches the release.

## [1.0.1] — 2026-08-06

### Fixed

- Reported framework version was pinned at the pre-release `1.1.0` in the health
  report and the system-meta fallback, so a monitored app advertised a version
  that was never published.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
