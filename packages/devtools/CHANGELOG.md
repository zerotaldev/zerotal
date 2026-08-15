# Changelog — @zerotal/devtools

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.6.2] — 2026-08-15

### Fixed

- **The panel's event stream was abandoned rather than closed on shutdown**, so the browser
  was left holding a truncated chunked response and logged
  `GET /__zerotal/devtools/sse net::ERR_INCOMPLETE_CHUNKED_ENCODING` — under `serve --dev`,
  on every save. Nothing was broken by it (`EventSource` reconnects on its own), but a
  devtools panel that fills the console with network errors is working against its own
  purpose. Shutdown now closes each open stream, which writes the terminating chunk and
  ends the request the way a reader expects.

  On Windows the fix needed [`@zerotal/core`](../core/CHANGELOG.md)'s side too — a worker
  that is terminated outright never reaches this code.

### Added

- **A heartbeat on the event stream.** A comment frame every 25 seconds, which readers
  ignore. Without one an idle stream can be dropped by an intermediary with nothing written
  for either end to notice it by, and the panel goes on reporting a connection it no longer
  has. The timer is unref'd, so it never holds a process open.

## [1.5.1] — 2026-08-15

### Fixed

- **DevTools never activated.** The panel was missing from every app, in every mode,
  however the environment was configured.

  `DevtoolsProvider` gated itself on `isDevSurfaceAllowed(Bun.env["APP_ENV"])`, which fails
  twice over. `APP_ENV` holds the _runtime mode_ by the time a provider boots — `setAppEnv()`
  replaced it — so the check was asking whether `"web"` is a development environment. And it
  was the one dev gate that did not honour `ZT_DEV`, the flag the dev orchestrator sets on
  the server it supervises, so `zt dev` did not rescue it either.

  It asks `devSurfacesEnabled()` now, which reads the preserved deployment name and honours
  `ZT_DEV`. Still fails closed: an unset, `staging` or `production` deployment does not get
  the unauthenticated trace inspector.

## [1.5.0] — 2026-08-15

### Changed

- **Maturity is now `stable`.** The public API is covered by the SemVer promise from
  here: anything importable without an `@internal` marker keeps its shape for the rest
  of the 1.x line, and `api-surface.md` is diffed by CI on every change. The package
  earned it by being small and self-contained — 32 exported symbols, a single dependency
  on `@zerotal/core`, no breaking change since its first release, and the one internal
  seam (`_setTraceStore`) correctly marked. The in-page panel extension API
  (`window.__zerotalDevtools`, used by Flow to contribute its Timeline tab) is part of
  that promise.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Added

- **Extensible panel — other packages can add their own tab.** The injected panel now exposes a global registry, `window.__zerotalDevtools`, that any package's browser code pushes a panel into: `window.__zerotalDevtools?.register({ id, title, badge?, render })` adds a tab alongside Queries/Logs/Request/Mail/Cache/Jobs, and `refresh(id)` pushes a live update (badge + re-render the open tab). Registration is order-independent (the registry is created by whichever runs first) and optional-peer friendly (guard with `?.`; a no-op when devtools isn't present). Panels render into the shared Shadow-DOM content area, so the devtools CSS classes/variables are available and contributed tabs match the panel without shipping styles. The `DevtoolsPanelPlugin` type is exported for TypeScript consumers. First consumer: `@zerotal/flow`'s time-travel Timeline. See [Extending the panel](/docs/devtools#extending-the-panel).

### Changed

- Moved service provider to `src/provider/`.
