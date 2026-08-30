# Changelog — @zerotal/create-zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **`.env.example` no longer ships the key the project actually runs with.** Both
  files got the same rendered content, so every scaffolded project committed a live,
  working `APP_KEY` — `.gitignore` covers `.env` and not `.env.example`. And
  `cp .env.example .env` is the first line of every deployment guide there is, so the
  published key went on to sign production sessions. One key across a laptop and a
  server is one compromise across both, and no strength check can catch it: as a
  string the value is perfectly strong. The example now carries a placeholder naming
  `key:generate`; `.env` still gets a fresh key, so a new app boots immediately.

- **`.gitignore` covers the SQLite sidecars.** It had `*.sqlite`, which does not match
  `db.sqlite-wal` or `db.sqlite-shm`. WAL mode is on by default so both exist in every
  project, and the write-ahead log holds pages not yet checkpointed into the main
  file — real rows. An app found both in its first commit on a public host, and was
  saved only by the WAL happening to be empty at that moment. Now `*.sqlite*`.

### Changed

- **`bun-plugin-tailwind` is pinned, and it and `tailwindcss` moved to
  `dependencies`.** Pinned because `latest` on a build-critical package whose peer
  declaration can take down a deploy is a combination worth removing. Moved because a
  deploy that installs with `--production` and *then* builds on the server has no
  devDependencies — so no Tailwind, and a page with no CSS.

## [1.7.2] — 2026-08-18

### Added

- **A non-interactive mode, so the scaffolder can be scripted.** Every prompt now has a flag —
  `--template`, `--db`, `--name` — plus `--yes` to take the defaults for anything unset,
  `--no-install`, `--help` and `--version`. `bun create zerotal my-app` is unchanged.

### Fixed

- **With no TTY the scaffolder hung instead of failing.** It read `process.argv[2]` as the project
  name and asked for everything else through `readline`, which waits for a line that never arrives
  in CI, in a pipeline, or under an agent. So it did not error and did not exit — it held the job
  open until something timed it out. The workaround in this repo was to bypass the CLI entirely and
  call `scaffold()` directly, which is the shape of an admission.

  It now detects the absent terminal and refuses, naming the flag that would have answered the
  question, with a non-zero exit code. Unknown flags are refused too rather than dropped: silently
  ignoring `--tempalte=api` means asking again for something the caller thought they had given,
  which in CI is the hang all over again. A failed `bun install` also exits non-zero when there is
  no terminal — a half-built project reported as a success is worse than one that stops.

## [1.6.3] — 2026-08-15

### Added

- **The scaffolder says when it is not the published one.** `bun create zerotal` can serve a
  copy cached from a previous run instead of fetching the current scaffolder, and a stale
  scaffolder is worse than an old one: it stamps the dependency ranges *it* shipped with, so
  the new project is created against versions that were current months ago — while the install
  log shows today's framework resolving happily inside those ranges. Everything reads as
  correct and the wrong packages are installed.

  Observed with a cached 1.5.0, which pinned an Inertia major whose client-side DevTools hooks
  do not exist, on a machine whose registry had 1.6.2. Nothing said so, because nothing was
  looking.

  The check now runs against the registry, and names the fix:
  `bunx create-zerotal@latest <name>`. It costs no perceived time — the request goes out before
  the banner and is read after the prompts — and it is advisory: an offline machine, a
  firewalled registry and a slow network all mean "no answer", and no answer never stops
  anyone creating an app.

## [1.6.1] — 2026-08-15

### Changed

- **The React and Vue templates scaffold Inertia 3.** The DevTools browser extension reads
  client-side hooks — visit options, prefetch-cache entries, and the grouping that tells a
  poll apart from a navigation — that exist only in the version 3 adapters. On 2.x the panel
  fills with requests from the server recorder and then reports the app is not in dev mode,
  which is true and unfixable without the bump.

  Nothing in either template changed: both typecheck and build against 3.6.1 unmodified, and
  the peer requirements were already met — the React template has always pinned React 19,
  and Vue 3.5 satisfies the Vue adapter. Existing apps are unaffected; they pin their own
  versions, and `bun add @inertiajs/react@^3` is the whole upgrade.

## [1.5.0] — 2026-08-15

### Changed

- **Scaffolded apps no longer default CORS to `"*"`.** Every template shipped
  `cors: { origin: env("CORS_ORIGIN", "*") }`, so a new app opted out of the
  framework's own safe default — an empty list, meaning same-origin — without ever
  being asked. `"*"` lets any website read the app's responses out of a visitor's
  browser, and it survived to production in anything that never set `CORS_ORIGIN`.
  The default is now same-origin; name your origins when you need them.
- **Templates declare `secureHeaders.secure`**, the setting that gates HSTS, so
  turning it on for a deployment is a visible one-line change rather than a
  discovery. `zt doctor` fails on a production-like deployment that leaves it off.

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
