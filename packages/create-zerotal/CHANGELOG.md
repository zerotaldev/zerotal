# Changelog â @zerotal/create-zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.0.4] — 2026-08-07

### Fixed

- **The Flow starter rendered unstyled.** Its layout linked `/app.css` while the
  asset build writes `public/css/app.css`, so every page loaded with a 404 for
  the stylesheet — a one-segment path mismatch that looks like a CSS problem.
  A test now asserts the rendered page names the path the build produces.
- The Flow starter also declares a favicon, so a fresh `serve --dev` no longer
  logs a 404 for `/favicon.ico` on every page load.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.2] — 2026-08-06

### Fixed

- **Templates could not be type-checked and, for two database choices, could not
  boot.** `api` scaffolded with PostgreSQL or MySQL wrote a matching
  `DATABASE_URL` but left the driver at its `sqlite` default — the exact pairing
  boot validation rejects. No template declared `@types/bun`, so `tsc` failed in
  all six; none had a `typecheck` script to reveal it.
- `flow` and `minimal` listed Tailwind as a dev dependency although `zt serve`
  builds their assets at boot, so `bun install --production` broke them.
- Templates imported packages they did not declare, resolving only via hoisting.

### Added

- A README, an `engines` floor, a `typecheck` script and a documented
  `.env.example` in every template.

## [1.0.1] — 2026-08-06

### Fixed

- **Scaffolded apps could not install.** The dependency range stamped into new
  projects was `^1.1.0` while the registry holds 1.0.0, so every
  `bun create zerotal` ended in `No version matching "^1.1.0" found for
  specifier "zerotal"`. The range now tracks this package's own version, and a
  test asserts they agree so it cannot drift again.
- **The startup banner read KULANI**, left over from the rename — the letters are
  drawn in box-drawing characters, so a text search for the old name never
  matched them.

## [1.0.0] — 2026-08-05

_First public release._

### Notes
- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
