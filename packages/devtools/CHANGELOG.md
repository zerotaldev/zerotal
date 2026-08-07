# Changelog — @zerotal/devtools

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

### Added

- **Extensible panel — other packages can add their own tab.** The injected panel now exposes a global registry, `window.__zerotalDevtools`, that any package's browser code pushes a panel into: `window.__zerotalDevtools?.register({ id, title, badge?, render })` adds a tab alongside Queries/Logs/Request/Mail/Cache/Jobs, and `refresh(id)` pushes a live update (badge + re-render the open tab). Registration is order-independent (the registry is created by whichever runs first) and optional-peer friendly (guard with `?.`; a no-op when devtools isn't present). Panels render into the shared Shadow-DOM content area, so the devtools CSS classes/variables are available and contributed tabs match the panel without shipping styles. The `DevtoolsPanelPlugin` type is exported for TypeScript consumers. First consumer: `@zerotal/flow`'s time-travel Timeline. See [Extending the panel](/docs/devtools#extending-the-panel).

### Changed

- Moved service provider to `src/provider/`.
