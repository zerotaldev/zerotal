# Changelog — @zerotal/create-zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Changed

- **The `api` template registers `StorageProvider`.** Its absence is invisible until the
  first upload: a `Storage.disk(...)` call usually sits behind auth, a permission check
  and a multipart parse, so every simpler probe returns 401/403 long before reaching the
  line that would fail — and that line is often first reached in production. It costs
  nothing when unused. The `flow`, `react`, `vue` and `admin` templates already had it.

## [1.3.0] — 2026-08-09

### Changed

- **Scaffolded models use the new composition idiom.** Templates now generate
  `class User extends Model.using(Authenticatable)` instead of
  `class User extends BaseModelWith(Authenticatable)`, and plain models extend `Model` rather than
  `BaseModel` — following the base-class rename in `@zerotal/orm`. Affects the `admin`, `api`,
  `flow`, `react` and `vue` templates.

## [1.1.0] — 2026-08-08

### Fixed

- **`StorageProvider` is registered in the scaffold.** `Storage.disk(...)` is used directly in the docs but the facade was unbound, so the first call failed with "Facade [storage] is not bound in the container". The error names the fix precisely; the cost is *when* it appears — a storage call sits behind auth, permission and upload checks, so simpler probes return 401/403 long before reaching it, and the first real upload is often in production. The provider falls back to `StorageConfig()` defaults and mounts no middleware when no disk is servable, so registering it unused costs nothing.
- **A fresh scaffold can run `migrate`.** The flow, react and vue templates shipped `synchronize` on *and* baseline migrations, so boot-time sync created `users` from the model and the first `bun zt migrate` collided with it — on the very first command a new user types. Migrations are now the single source of truth in those templates, as they already were in `api`, and `bun zt migrate` is listed in the scaffold's next steps.
- **The scaffolded test suite builds its schema.** With `synchronize` off, `createTestApp()` hands back a `:memory:` database with no tables; the smoke test now calls `migrateDatabase()`, which also means the schema under test is the schema that ships.
- **Nullable model fields can be cleared.** The templates declared them `?: T` under `exactOptionalPropertyTypes: true`, which means "may be absent, but never `undefined`" — so assigning `undefined` to clear the field, which is the point of a nullable column, did not typecheck. They are now `?: T | undefined`.

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
