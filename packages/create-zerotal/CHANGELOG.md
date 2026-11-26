# Changelog — @zerotal/create-zerotal

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Changed

- **The starters' project routes save the validated status without a cast.** `in()` now types
  it as `ProjectStatus`, so `data.status as ProjectStatus` is gone from the React, Vue and Flow
  starters.

## [1.18.0] — 2026-11-26

### Added

- **The starters guard a bare `bun test`.** `bunfig.toml` preloads `zerotal/testing/guard`,
  which stops a direct `bun test` from running against the database `.env` points at and says
  to run `bun zt test`. `ZT_DB_URL=:memory: bun test` still runs directly. The `api` starter
  has no guard: its tests all pin an in-memory database, so a bare run there is already safe.

### Changed

- **A new app depends on `~1.18.0`**, so it installs this release.
- **The CI workflow a new app gets pins its actions to commit SHAs** (`actions/checkout`,
  `oven-sh/setup-bun`), with the version in a comment, and declares
  `permissions: contents: read`. A moved tag can no longer change what an app's CI runs.

### Fixed

- **A new app no longer offers its logs and built CSS to git.** Every starter ignores
  `storage/logs/`, where the app writes a log file a day. The React and Vue starters also
  ignore `public/css/`, which `assets:build` writes during a deploy, and leave it out of
  `format:check`, which failed on it after a release build.
- **Every starter keeps all `.env.*` files out of git, not only `.env`.** A
  `.env.production` holding real secrets matched nothing in `.gitignore`, so `git add -A`
  committed it (the starter's `.dockerignore` already left it out of the image).
  `.env.example`, the one meant to be committed, still is.
- **`rejectInput()` accepts any route's context** in the React, Vue and Flow starters. It was
  typed for string route params only, so a route with a bound model, such as
  `projects/[project]/…`, could not call it without a type error.

## [1.17.4] — 2026-11-26

### Added

- **Every starter ships with the coding-agent files.** A new app has `AGENTS.md`, a `CLAUDE.md`
  that imports it, `.mcp.json` (and `.vscode/mcp.json` in the starters with `.vscode/`), and
  skills under `.agents/skills/` and `.claude/skills/`. `@zerotal/arch` is a dependency, and
  `app/providers/ArchProvider.ts` registers it, so `zt arch:update` refreshes the files after an
  upgrade and `zt doctor` says when they have drifted. The files are what `arch:install` would
  write into that starter, so a new app's first `arch:update` has nothing to change.

- **`--no-agent`** leaves all of it out, `@zerotal/arch` included. There is no prompt for it.

### Changed

- **A new app depends on `~1.17.4`**, so it installs this release.

## [1.17.3] — 2026-11-25

### Changed

- **A new app depends on `~1.17.3`**, so it installs this release and its fixes.

## [1.17.2] — 2026-11-25

### Changed

- **The React starter is a first app rather than a demo site.** Signed-in pages render in a
  sidebar shell with a slide-out menu on phones, and sign-in screens in a centred card; the public
  pages stay. It lands on `/dashboard` after sign-in, and ships a component set (Alert, Avatar,
  Badge, Checkbox, Dropdown, EmptyState, Input, Modal, Select, Toasts and more) with light, dark
  and system themes.
- **The React starter completes sign-in from `@zerotal/auth`:** email verification (mail is
  printed by the `log` driver until one is configured), a lockout message that says how long to
  wait, password confirmation before sensitive settings, two-factor with QR code and recovery
  codes, a list of signed-in sessions that can sign the others out, and opt-in passkeys and
  GitHub / Google sign-in that switch on when their keys are set.
- **Settings replace `/profile`:** profile, password, appearance, two-factor, passkeys (when on),
  sessions and account deletion.
- **An example `Project` resource** with a model, migration, factory, owner-only policy, searchable
  paginated list and forms, and `bun zt db:seed` creating `demo@example.com` / `password` with
  sample projects. The README says how to remove it.
- **The React starter ships CI, a Dockerfile, `/health`, `.editorconfig`, VS Code
  recommendations and Prettier settings**, with feature tests for every flow. The next steps
  offer the demo seed for the React, Vue and Flow starters.
- **The app name comes from `config/app.ts`** (`APP_NAME`) everywhere the React starter shows it.
- **The Vue starter is the same app as the React one,** page for page, route for route and test
  for test: the same server code, the same tests, and the layouts, components and pages written
  as Vue single-file components. `bun run typecheck` runs `vue-tsc`, so `.vue` files are type
  checked and a route's props are checked against the page's own. A `tests/pages.test.ts` renders
  every page, through a small `tests/render.ts` helper.
- **The Flow starter is the same app as well,** built from Flow pages rendered on the server.
  The server code and the tests are the React starter's, with the page handlers moved into
  `app/flow/pages/` (Flow components) and `routes/web.ts` (one line per page, with its route name
  and middleware). Forms are plain HTML that post to `app/routes/` and redirect; a small browser
  script in `resources/js/` adds menus, dialogs, the theme, passkeys, and PUT / PATCH / DELETE
  forms, which a browser cannot send alone. The project search is a live Flow binding. Where the
  other starters' tests read a page's props, the Flow tests read the rendered page
  (`tests/html.ts`), and `tests/pages.test.ts` builds every page and its layout through
  `FlowTest` (`tests/render.ts`). The old Flow starter's `/profile` page becomes Settings.
  Every page compiles ahead of time, with and without `cspSafe`: a page writes its markup from
  the class lists in `app/flow/lib/ui.ts` instead of calling the components, which the layouts
  use.
- **Dotfiles in templates are renamed from one table** (`RENAMED` in `src/scaffold.ts`), applied
  to the first path segment, so directories such as `_github/` arrive as `.github/`.

### Added

- **`src/manifest.ts`** lists a full-stack kit's pages, layouts, components, named routes and
  tests, independent of the frontend, and `templates.test.ts` checks the React, Vue and Flow kits
  against it. `KITS` says where each kit keeps its pages, layouts and components.

## [1.17.1] — 2026-11-21

### Fixed

- **The admin starter ships migrations for its own tables.** It had a migration only for
  `password_reset_tokens`; `users`, `products` and `settings` were created by `synchronize`,
  which is off when `APP_ENV=production`. There, `bun zt migrate` built one table and
  `bun zt db:seed` then failed with `no such table: users`. The starter now ships
  `0002_create_users_table`, `0003_create_products_table` (with `deleted_at`, as the model
  soft-deletes) and `0004_create_settings_table`, and `0001_create_password_reset_tokens_table`
  keeps its name, so an app that already ran it is not asked to run it again.
- **The admin starter turns `synchronize` off**, as the api, flow, react and vue starters do.
  Migrations now build the schema in development and in production alike, so the next steps and
  the README list `bun zt migrate` before `bun zt db:seed`, and the starter's test suite builds
  its in-memory database with `migrateDatabase()`.

  Apps already scaffolded are not touched. An admin app that relied on `synchronize` can copy the
  three new migrations from this starter for new databases. A database where `synchronize`
  already created those tables would fail on `table users already exists`, so leave
  `synchronize` on for that one.
- **The admin starter's dashboard no longer logs an `NPlusOneError` in development.** The "Active"
  stat and the "Catalogue by status" chart counted products one status at a time, so with the
  sidebar badge one query shape ran five times per load and crossed the detector's threshold. Both
  widgets now read one grouped query (`SELECT status, COUNT(*) … GROUP BY status`), run once per
  request through `RequestContext.remember`. The dashboard shows the same numbers.

  Apps already scaffolded are not touched. To fix one, copy `productsByStatus()` and the two
  widget changes from the template's `app/admin/widgets.ts`.

## [1.17.0] — 2026-11-20

### Fixed

- **The Vue starter registers `StorageProvider`.** It imported the provider but left it out of the
  list, so the first `Storage.disk()` call failed with `Could not resolve the "storage" facade`. The
  other four starters with a database already registered it.
- **Signing in works in the Vue and api starters.** Their `User` model extended a plain `Model`, so
  auth found no user model: in the Vue starter a correct password was refused (and registration
  signed nobody in, then redirected to a guarded page that sent the visitor back to `/login`), and
  in the api starter `GET /me` answered 401 straight after a successful `POST /login`. Both now
  extend `Model.using(Authenticatable)` and add `table.rememberToken()` to the users migration, as
  the flow and react starters do. The Vue starter's register route also checks the sign-in result,
  as the react starter's does.
- A test now names the providers each starter must register, and fails if any starter leaves one
  out, imports a provider it never registers, or has a `User` model without `Authenticatable`.

  Apps already scaffolded are not touched. A Vue app can add `StorageProvider` to
  `bootstrap/providers.ts`. A Vue or api app can change `User` to
  `extends Model.using(Authenticatable)` (imported from `zerotal/auth`), then run `bun zt doctor`,
  which names a migration if the `remember_token` column is missing.

## [1.16.4] — 2026-11-17

### Changed

- **Every starter ships the same baseline.** The Vue starter now depends on `@zerotal/devtools` and
  registers `DevtoolsProvider` last, as the other five do; it was the one starter without the dev
  panel. The admin and api starters now ship `bunfig.toml` with `peer = false` under `[install]`, as
  the four Tailwind starters have since 1.15.6: nothing they install today changes, and a dependency
  added later cannot pull an unlisted peer in. A test checks every template for `zerotal`,
  `@zerotal/devtools`, `DevtoolsProvider` and `peer = false`.
- **The Vue starter lists `@vue/compiler-sfc` under `dependencies`.** It compiles `.vue` files when
  the app builds and when the server renders a page, so a deploy that installs with `--production`
  and then builds had no compiler; `tailwindcss` and `bun-plugin-tailwind` moved for the same reason
  in 1.11.0. A test keeps build-time packages out of every starter's `devDependencies`.

  Apps already scaffolded are not touched. A Vue app can move `@vue/compiler-sfc` itself, and add
  `@zerotal/devtools` and `DevtoolsProvider`; an admin or api app can add the two `bunfig.toml`
  lines.

## [1.15.6] — 2026-10-28

### Fixed

- **The starters really do install one Bun.** 1.15.5 added a `bunfig.toml` with `peer = false` to the
  flow, minimal, react and vue starters, but `bun pm pack` leaves any file of that name out of a
  package, so the published starters had none and still installed Bun as a peer of
  `bun-plugin-tailwind`. The file ships as `_bunfig.toml` and is renamed when an app is scaffolded,
  as `_gitignore` is. A test now checks that every template file reaches the package. An app made
  with 1.15.5 can add the file itself: `[install]` and `peer = false`, then delete `node_modules`
  and run `bun install`. An install over the existing `node_modules` keeps the second Bun.

## [1.15.5] — 2026-10-27

### Added

- **`.gitattributes` pinning line endings to LF**, in every template. On Windows git's default
  rewrote each checkout to CRLF and printed `LF will be replaced by CRLF the next time Git
  touches it` for every generated file on every commit (`types/routes.generated.ts`,
  `resources/js/pages.generated.ts`, anything the framework scaffolds later). The files are LF where
  they are deployed. An existing `.gitattributes` is left alone.

### Changed

- **The React and Vue starters show `warning` and `info` flashes.** Their toast component handled
  `success` and `error`, the two keys the Inertia `flash` prop carried; it now carries four, and the
  toasts render them with an alert and an info icon. A `--warning` colour token (amber, dark enough
  to read as text on its own tint) joins `--success` and `--destructive`; `info` uses the neutral
  border and text colours.

- **Every page of the Flow starter compiles ahead of time.** Five of its eight pages rendered
  through the runtime fallback, because they are styled with the class lists in `ui.ts`
  (`class={CARD}`), which the compiler could not read until now. `reset-password` also returned
  from `render()` twice, which the compiler cannot read either; it returns once now, with the
  confirmation and the form as the two branches of a conditional inside the card. A test checks
  that all of them compile, under `cspSafe` too. Apps already scaffolded are not touched.

### Fixed

- **A new app installs one Bun.** `bun-plugin-tailwind` names Bun itself as a peer dependency, and
  Bun installs peers, so the flow, minimal, react and vue starters put a second copy of Bun in
  `node_modules`, and every `zt` command printed a dozen lines about two runtimes (twice under
  `zt dev`) whenever it differed from the one on `PATH`, which is most of the time. The four starters
  ship a `bunfig.toml` with `peer = false` under `[install]`; everything they use is a direct
  dependency, and every peer a Zerotal package declares is optional. Apps already scaffolded are not
  touched: add the same two lines and run `bun install`.

## [1.15.3] — 2026-10-23

### Changed

- **New apps start on a tilde range.** `bun create zerotal` wrote `^X.Y.Z` into every scaffolded
  app's `zerotal` and `@zerotal/*` dependencies. Under the versioning scheme in the upgrade
  guide a minor is where a break lands, so a caret let the app's next install cross one without
  anyone reading its notes. It writes `~X.Y.Z` now, which takes every patch and stops at the
  minor. Apps already scaffolded keep what they have; changing `^` to `~` in their
  `package.json` gives them the same protection.

### Fixed

- **The README and the terminal now give the same first steps, from one list.** The scaffolder
  printed `bun zt migrate` (or `bun zt db:seed` for the admin template) before `bun zt dev`;
  every README said `bun install` then `bun run dev`. The README is the copy that stays, and
  following it on `api`, `flow`, `react` or `vue` reached a running app with no `users` table.
  Both render from the same step list now, and a test ties them together.

- **The admin template answers `/`.** The dev server prints `http://localhost:3000`, and the app
  had nothing there: a bare JSON `E_NOT_FOUND`, with no hint that the panel is at `/admin`. The
  bare origin now redirects to it, and the template ships a test of that.

- **A new `api` app passes `zt doctor`.** Its `config/app.ts` was a bare object where the other
  five templates use `AppConfig`, which is what fills `allowedOrigins` from `url`. The doctor
  failed an app with no code of its own, and told you to set a `url` that was already set. It also
  read `APP_KEY` with an empty default where the others require one; it now requires it too.

- **`flow` and `react` create `users.remember_token`.** Their `User` uses `Authenticatable`, but
  the migration did not create the column, so `zt doctor` failed between `migrate` and the first
  dev boot, until the boot step added it. The migration creates it now.

Apps already scaffolded keep what they have.

## [1.14.2] — 2026-09-01

### Fixed

- **`bun run dev` was broken in every app scaffolded since 1.13.0.** Each template's
  `package.json` carried `"dev": "bun zt.ts serve --dev"`, and `serve --dev` was retired in
  1.13.0 — deliberately failing loudly rather than silently starting a plain server. So the
  first command a new user runs exited 1 and told them to use something else.

  Retiring it updated the runner, the docs and the `zt upgrade` codemod, and missed the
  templates that *write* new apps. A test now checks the scaffolder against the codemod's
  own list of retired forms, so the thing that generates apps cannot fall behind the thing
  that migrates them.

## [1.11.0] — 2026-08-31

### Added

- **The React scaffold ships a page-render test.** Every generated page is built once,
  to prove it can be. The rest of a starter suite asserts values and status codes, and
  a page can throw on its first paint while all of them pass — which is how a blank
  page reaches production with a green suite. New projects inherited that gap; now
  they inherit the check instead. One line per page.

### Fixed

- **`config/session.ts` is scaffolded environment-aware**, so the first production
  deploy no longer fails. The production config validator refuses to boot without
  `session.secure`, which is right — but the scaffold shipped `secret`, `cookie` and
  `lifetime` only, so every app built from it hit that refusal on its first deploy,
  after uploading, installing and migrating, at the moment it tried to serve. It also
  cannot simply be `true`: development runs on `http://localhost`, where a secure
  cookie is never sent, and the symptom there is a login that appears to succeed and
  bounces back to the sign-in page with nothing in any log. Now
  `secure: env("APP_ENV", "development") === "production"`, with `httpOnly` and
  `sameSite: "Lax"` — `Lax` because invitation and password-reset links arrive from a
  mail client, and `Strict` withholds the cookie on exactly that navigation.

- **`--success` meets WCAG AA.** The light-palette token was `oklch(0.6 0.14 158)`,
  which measures 3.1:1 as status text against the 10% success tint it is drawn on —
  under the 4.5:1 AA needs. Measuring it against the surface *under* the tint is what
  made it look like it passed. Now `oklch(0.504 0.11 158)`.

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
