# Changelog — @zerotal/inertia

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **Tests for `PrecognitionMiddleware`.** A precognitive request validates a form
  without running the controller's side effects, answering 204 or 422 instead of the
  real response — so those answers must never be confused with real ones by a cache.
  Without the `Vary`, a shared cache can serve a precognitive 204 to an actual form
  submission, and the user's data silently never reaches the controller. Pinned:
  the header is added only for `Precognition: true` (not `1`, not `TRUE`), it is
  appended to an existing `Vary` rather than replacing it — replacing would discard
  the app's own content negotiation — it is not duplicated when already present, and
  the decorated response keeps its status and body. 76 tests → 84.

- **The prop wrapper classes, the error classes and `SsrHandler` are documented.**
  `OptionalProp`, `AlwaysProp`, `DeferProp`, `MergeProp` and `InfiniteScrollProp` are
  what the prop helpers return; the reference now says so, and names `InertiaProp` as
  the type to accept for "any wrapped prop". `InertiaError`, `InvalidComponentError`
  and `InertiaTemplateNotLoadedError` gained a table of what throws each.

### Changed

- **`detectVuePlugin` is marked `@internal`** — build plumbing for `inertia:build`,
  reached only by the build command. With the eight markers already present the
  promise is 30 exports, not 39.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Every promised export is documented across seven guide pages, and
  the only dependency is `@zerotal/core`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.2] — 2026-08-06

### Fixed

- Type-checking a Vue app no longer fails on React. React is an optional peer
  and is imported dynamically at runtime, but the literal specifiers were still
  resolved by TypeScript, so Vue projects were asked for modules they never
  install.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
