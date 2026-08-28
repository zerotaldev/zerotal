# Changelog — zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **`zerotal/shared`** — a browser-safe entry point re-exporting `@zerotal/core/shared`:
  `pluralize`, `singularize`, `snakeCase`, `camelCase`, `tableNameFor`, `Str`, and the
  `formatMoney` / `formatNumber` / `formatDate` formatters. Importing `zerotal` into a client
  bundle drags the server in behind it; this is the subset that has no server in it, so one
  definition of "how this app writes money" can be imported by both the controller and the
  component instead of maintained twice.

## [1.4.0] — 2026-08-10

### Changed

- Version bump in step with the monorepo. The subpath surface re-exports
  `@zerotal/core` and the stable packages, so the changes that matter are in
  their changelogs — notably the ORM's encrypted columns and Flow's
  `preserveScroll`/navigation-scroll fixes this release.

## [1.3.0] — 2026-08-09

### Changed

- Version bump in step with the monorepo. The mixin-composition rename
  (`BaseModelWith(...)` → `Model.using(...)`, `ComponentWith(...)` →
  `Component.using(...)`) lands through the re-exported packages; run
  `bun run scripts/codemod-mixin-composition.ts` when upgrading from 1.1.x.

## [1.1.0] — 2026-08-08

### Changed

- Version bump in step with the monorepo, carrying the 1.1.0 fix wave from the
  first field reports (radio-group bindings, json-cast round-tripping, insert
  defaults, `Schema.alter`, `ctx.param()`, and the rest) through the
  re-exported packages.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Added

- **Initial meta package.** `bun add zerotal` installs the stable set in one
  dependency: the root import re-exports `@zerotal/core`, and each stable
  package is available as a subpath (`zerotal/orm`, `zerotal/auth`,
  `zerotal/cache`, `zerotal/client`, `zerotal/queue`, `zerotal/scheduler`,
  `zerotal/session`, `zerotal/testing`, `zerotal/validator`).
- **Core subpaths mirrored 1:1.** `zerotal/logger`, `zerotal/lock`,
  `zerotal/storage`, `zerotal/config`, `zerotal/view` and the rest of
  `@zerotal/core`'s export map resolve through the meta package, including
  `jsx-runtime` so `"jsxImportSource": "zerotal"` works. Only the
  `macros/config` Bun macro stays core-only. The `create-zerotal` templates
  and the docs app now scaffold and import from `zerotal`.
