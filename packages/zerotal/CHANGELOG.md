# Changelog — zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
