---
title: Release Notes
description: What changed in each tagged Zerotal release, and the steps needed to upgrade.
---

# Release Notes

Releases are recorded below, newest first. The `@zerotal/*` packages share a
single version line and follow [semantic versioning](/docs/upgrade#versioning).
Each package also keeps a detailed `CHANGELOG.md` of its own; this page is the
summary across the suite.

> **Tip** — For the mechanics of moving between versions — bumping packages, running migrations, and re-checking config — see the [Upgrade Guide](/docs/upgrade).

## How to read these notes

Each version lists changes under three headings:

- **Added** — new features and APIs (safe to adopt incrementally).
- **Changed** — behavior changes; **breaking** ones are called out explicitly, in
  bold, as **BREAKING**.
- **Fixed** — bug fixes.

Breaking changes belong in major releases, and while the 1.x line is young they may
also land in a minor or a patch — always labelled, always with migration steps. Read
the section for every version you cross and apply its migration notes, not only the
majors. [Releases and versioning](/docs/support-policy#releases-and-versioning) explains
when that carve-out ends.

## 1.7.2 — 2026-08-18

Realtime that works without being wired up, and three ways a socket could go quiet without
saying so.

### Changed

- **BREAKING — Flow's `@on` broadcast listeners use a `socket:` prefix.** `echo:`,
  `echo-private:` and `echo-presence:` are now `socket:`, `socket-private:` and
  `socket-presence:`; the browser global is `window.Socket`, not `window.Echo`. There is no
  alias — an unrenamed listener never matches, and never subscribes.

  ```diff
  - @on("echo-private:issues.5,CommentPosted")
  + @on("socket-private:issues.5,CommentPosted")
  ```

  Shipped in a patch release deliberately, on the judgement that the old prefix has no
  meaningful use in the wild. If you are on it, the upgrade is a find-and-replace of `echo:`
  → `socket:` in your `@on` listeners and `window.Echo` → `window.Socket` in any client code.

### Added

- **Flow bundles the socket client into its runtime.** A page that declares a `socket:`
  listener is live with no script of your own. Flow apps own no bundle entry, so the contract
  used to be "publish `window.Socket` yourself" — and when you didn't, the listeners were
  _silently inert_: no error, no warning, no subscription, so a live feature with no script
  looked exactly like a live feature that was never written. An app that needs a configured
  client still assigns `window.Socket` before the runtime loads and that one is used as-is; a
  page with no listeners opens no connection at all.

### Fixed

- **A patch no longer writes back into a file input.** A file input's `value` belongs to the
  user agent, and assigning anything but `""` throws `InvalidStateError`. The write was legal
  while the bound property was empty and threw on the very patch carrying an upload's result
  — and the throw escaped the frame handler, so the DOM never updated _and_ the action's ack
  never resolved. Since frames are chained per component, every later action queued behind a
  promise that would never settle: the page rendered correctly and ignored every click for
  the rest of its life.

- **WebSocket connections get an explicit 120s `idleTimeout`.** Bun closes an idle socket
  after 10 seconds; the client pings every 30. A connection that was merely quiet got cut
  before it had reason to speak, taking its channel subscriptions with it — so anyone who had
  been reading a page for more than ten seconds silently stopped receiving broadcasts.

## 1.7.0 — 2026-08-16

The agent surface, a DevTools panel that shows the framework and not just the last request,
and the repayment of four things the 1.x line had promised without delivering.

### Added

- **`@zerotal/arch` — an MCP server that hands a coding agent the framework's own truth.**
  Not a documentation search over prose about an API: `api_surface` returns the exact
  TypeScript signature of every export, read from the version installed in your project and
  diffed by CI on every change. Alongside it, `search_docs` over the documentation that
  shipped with that same version, `routes` and `schema` read from the live router and the
  models' own metadata, `logs`/`last_error` from the app's structured trail, `baselines`, and
  `doctor` — the one an agent is meant to finish a task with, because every finding carries
  its fix.

  ```bash
  bun add -d @zerotal/arch
  bun zt arch:install          # writes .mcp.json, AGENTS.md, and a CLAUDE.md shim
  ```

  Re-running is safe: every generated region is marker-fenced, so `arch:update` on your next
  upgrade replaces what it wrote and leaves anything you added around it alone. Ships `beta`.
  See [Agent Surface](/docs/arch).

- **DevTools grew an App section.** Every surface until now read the request stream — what one
  request did. Six new tabs behind a **Requests | App** switch answer what the app _is_:
  routes, resolved config with secrets masked, container bindings and which provider bound
  each, provider boot cost, event listeners, and console commands with scheduled tasks. Every
  location in the panel is now a link into your editor.

- **Security headers cover static files.** Files under `public/` are handed to Bun as
  pre-registered responses and served without entering JavaScript, so no middleware ever ran
  for them — every asset went out with no `X-Content-Type-Options: nosniff`, the response
  class sniffing protection exists for. The header set is baked into the compiled response, so
  Bun still serves the file natively.

- **`zt doctor --url` reports security headers sent twice.** A header your app sets and your
  proxy also sets is invisible from inside the process. Conflicting values fail the check —
  browsers do not agree which copy applies, so the control is enforced inconsistently —
  and identical duplicates warn.

- **`DeepPartial<T>`**, exported from the kernel. `deepMerge` does a deep merge and its
  parameter said `Partial<T>`, which only makes the top level optional — so overriding one
  field of a nested config block was a type error against a merge that handles it perfectly.

### Fixed

- **Migrations are now actually transactional.** The runner wrapped each `up()` in a
  transaction and the docblock promised all-or-nothing, but the wrapper governed nothing:
  `Schema` resolved the _global_ connection, so a migration's DDL ran on a pooled connection
  and committed independently. On PostgreSQL, a migration failing on its third statement left
  the first two behind and the `ROLLBACK` had nothing to undo. DDL now joins the enclosing
  transaction, the tracking-table row is written inside it, and rollback carries the same
  guarantee. MySQL has no transactional DDL, so the runner no longer opens one there and
  `zt migrate` says so before it starts. See
  [Migrations → What happens when a migration fails](/docs/migrations#what-happens-when-a-migration-fails).

- **`BaseMiddleware.with()` type-checks its options.** Its options type was inferred from the
  object literal it was handed rather than from the middleware class, so the literal was
  checked against itself: every callback parameter arrived implicitly `any`, and a misspelled
  option was accepted in silence.

- **SPA navigation no longer leaks the outgoing page's state script.** The swap removed the
  first `flow-state-*` element in document order, which on any page with a child island was
  the island's, not the page's. The orphans accumulated one per navigation for as long as the
  tab stayed open.

### Changed

- **DDL issued inside `DB.transaction()` now joins that transaction.** Previously
  `Schema.create()` and friends resolved the global connection and committed separately. This
  is the fix above, and it applies to any code — not only migrations — that issues DDL inside
  a transaction.

- **`Component._skipMount` is gone** (`@internal`). It was written by `hydrate()` and read by
  nothing; mount-skipping is structural, and `$refresh`/`$mount` deliberately re-mount a
  hydrated page, so honouring the flag would have broken both. `hooks.test.ts` pins the real
  guarantee — mount runs exactly once per session.

## 1.6.3 — 2026-08-15

Two guards against the same failure: an upgrade sitting on disk while something older keeps
running, with nothing on screen to say so.

### Added

- **`serve --dev` reports a framework upgrade it has not picked up.** A running dev server
  holds the code it imported at boot, so `bun add zerotal@latest` in another terminal changes
  `node_modules` and nothing else — a save restarts only the worker, against the same
  in-memory framework. The upgrade therefore appears to do nothing. The supervisor now names
  both versions and says to restart, and the dev banner carries the version it is running:
  `Zerotal v1.6.3 › dev`.

- **`create-zerotal` says when it is not the published scaffolder.** `bun create zerotal` can
  serve a copy cached from an earlier run, and a stale scaffolder stamps the dependency ranges
  _it_ shipped with — so a brand-new project is created against versions that are no longer
  current, while the install log shows today's framework resolving inside those ranges. It now
  checks the registry and names the fix: `bunx create-zerotal@latest <name>`. Advisory only —
  offline, firewalled and slow all mean "no answer", and no answer never stops anyone creating
  an app.

## 1.6.2 — 2026-08-15

### Fixed

- **`serve --dev` now stops its worker on Windows instead of killing it.** Restarting sent
  `SIGTERM`, which Windows has no way to deliver — there the call terminates the process
  where it stands, so on every save no provider drained, no open response was finished and
  no database handle was closed. The supervisor asks over an IPC channel now and only kills
  if that goes unanswered. Nothing changes on macOS or Linux beyond the mechanism.

- **The devtools panel no longer fills the console with network errors.** Its event stream
  was abandoned on shutdown rather than closed, leaving the browser with a truncated
  response and a `net::ERR_INCOMPLETE_CHUNKED_ENCODING` for every reload. The stream is
  closed properly now, and a heartbeat keeps an idle one from being dropped with nothing
  written for either end to notice by.

## 1.6.1 — 2026-08-15

### Fixed

- **The Inertia DevTools panel said the app was not in dev mode**, and suggested starting a
  Vite dev server — advice that cannot be followed in a Zerotal app. The cause was real
  though: the Inertia adapter turns its client-side hooks on from a `dev` option that
  defaults to `import.meta.env.DEV`, a Vite convention that Bun's bundler leaves alone, so
  it survived into the bundle and evaluated to `false` on every build.

  Zerotal now defines `import.meta.env` — `DEV`, `PROD` and `MODE` — for every bundled
  browser build. Nothing to configure and no `dev` option to pass by hand; rebuild and the
  panel works. See [Inertia DevTools](/docs/inertia/devtools).

### Changed

- **New React and Vue apps scaffold Inertia 3.** The panel's client half — visit options,
  prefetch-cache entries, and the grouping that tells a poll apart from a navigation — exists
  only in the version 3 adapters, and neither template needed a single edit to build against
  it. Existing apps are unaffected; `bun add @inertiajs/react@^3` (or `@inertiajs/vue3@^3`)
  is the whole upgrade if you want the client half.

## 1.6.0 — 2026-08-15

### Added

- **`route()` works in the browser.** The typed helper now has a twin at `zerotal/routes`.
  Hand it the table `bun zt route:types` already generates, once, at your entry point, and
  `route("posts.show", { slug })` works in a component exactly as it does in a controller.
  `hasRoute(name)` answers the conditional-link question without a try/catch.

  The two are one implementation, not two that agree today: param encoding, catch-all
  handling and every error message live in a shared builder, and only the table lookup
  differs — the live router on the server, the generated map in the browser. A parity test
  asserts they emit byte-identical URLs and identical error text. See
  [Routing](/docs/routing).

- **`$route()` in Flow's Alpine expressions** — `<a :href="$route('posts.show', { slug })">`,
  with nothing to install. Inertia apps import their table; `/__flow/runtime.js` is built by
  the framework rather than your app, so the runtime handler serialises the table onto the
  bundle it serves instead. Same builder as the server, so a link written in an Alpine
  expression and one written in JSX cannot disagree about encoding.

- **Inertia DevTools.** A server-side recorder for the Inertia DevTools browser extension:
  requests, resolved props, and which wrapper produced each one. Off unless the process
  already exposes dev surfaces — the same gate as the stack-trace error page — and an app
  that enables it without saying who may read it gets a 403 rather than an open endpoint.
  Redaction runs before storage, so a withheld value is never written down. See
  [Inertia DevTools](/docs/inertia/devtools).

### Fixed

- **Ten more places asked `APP_ENV` a question it cannot answer**, found by auditing every
  reader rather than waiting for the next report. `APP_ENV` holds the runtime mode once the
  app has booted, so a check comparing it against a deployment name was asking whether
  `"web"` is production. The consequences were real:

  - **auto-`synchronize` was never hard-off in production** — the only thing between a
    production database and boot-time schema sync was the config default;
  - **the Flow client bundle was never minified in production**, shipping ~183 KB
    unminified to every visitor;
  - **`forceState()`** did not refuse to run on live data;
  - **environment-scoped scheduled tasks never ran** — `.environments(["production"])`
    matched nothing, silently;
  - the admin environment badge showed `web` on every screen, so the one mistake it exists
    to prevent — editing production believing it is staging — was exactly what it could not
    prevent.

  All read the deployment name now, and every one still fails closed. Reading `APP_ENV`
  directly is a lint error from this release, because fourteen instances of one mistake
  across seven packages were each found separately.

- **`useOnce()` no longer demands a cast.** Registering middleware from a provider required
  `useOnce(Middleware as never)` in all eight packages that do it — a cast the framework was
  asking for. Twelve of them are gone, and the casting-debt baseline came down with them.

## 1.5.1 — 2026-08-15

### Fixed

- **Development surfaces were switching themselves off.** A scaffolded app with
  `APP_ENV=development` in its `.env` got **production error pages** from `bun zt serve`, and
  **DevTools never appeared at all** — in any app, in any mode. The admin panel's development
  bypass and the monitor's open-by-default access were dead for the same reason.

  All of them asked `APP_ENV` whether this was a development environment, but `setAppEnv()`
  replaces that variable with the runtime mode (`web`, `console`, `worker`) before the app is
  created — so the question being asked was whether `"web"` is development. They read the
  preserved deployment name now. Production and staging are unaffected: every one of these
  gates still fails closed, and an unset environment still fails closed.

  If you upgrade and suddenly see the DevTools panel, that is the fix, not a new feature.

## 1.5.0 — 2026-08-15

The largest release of the 1.x line: a new package, three features, a batch of
production-hardening work that came out of a real deployment, and the last of the
packages reaching `stable`. Of the 26 published packages, **25 are `stable` and one
is `experimental`** (`@zerotal/ai`); none is `beta`.

### Added

- **`bun zt deploy:<env>` — a release that refuses to finish when something is wrong.**
  Four phases, ordered so that **everything that can refuse runs before anything that
  mutates**: preflight (is this really that environment, would this config refuse a
  production boot, does `zt doctor` pass), build, migrate, verify. It exits non-zero and
  does not restart your service — systemd or your container runtime owns that, and this
  gives it a gate to restart behind. Every environment gets its own command;
  `production` and `staging` exist without configuration, and `config/deploy.ts` declares
  more. The target name is checked against the deployment the process was started as, so
  `deploy:production` on a staging box stops before it migrates the wrong database.
  `--dry-run`, `--skip-migrations` and `--probe` are there. See
  [Deployment](/docs/deployment).
- **`zt doctor` checks CORS and HSTS.** `app.cors.origin: "*"` lets any site read your
  responses out of a visitor's browser; `app.secureHeaders.secure` gates HSTS and
  defaults to off. Both now fail on a production-like deployment.
- **`@zerotal/ai` — a typed agent loop, shipping `experimental`.** One loop shared by every
  driver, so switching models is a config change rather than a rewrite. A `pause_turn` is
  resumed rather than mistaken for an answer; a refusal is a typed outcome checked before
  anything reads the content; schema translation decides what a provider can express instead
  of hoping. Named agent runs take a refreshable lock, spend ceilings and prompt redaction are
  first-class, and `AiFake` makes the whole thing testable without a network. It ships
  `experimental` deliberately — the surface is expected to move inside 1.x, and the
  [support policy](/docs/support-policy) says what that means. See [AI](/docs/ai).
- **Typed route names — `bun zt route:types`.** The command boots the app, reads the routes it
  actually registered, and writes `types/routes.generated.ts`. With it, `route("psots.show")` is
  a compile error and `route("posts.show", {})` names the `slug` it wants. Params come from the
  pattern, so adding a segment updates every call site. It boots rather than scanning `routes/`
  because a route name comes from three places and only one of them is a file path. See
  [Routing](/docs/routing).
- **Typed Inertia pages.** `Inertia.render(component, props)` is checked against the page
  component's own props, and the prop wrappers (`defer`, `optional`, `always`) are generic, so a
  renamed or retyped prop fails at the render call rather than in the browser. See
  [Inertia](/docs/inertia).
- **The development error page can say what to do, not just what broke.** `no such table: assets`
  is exact about the failure and useless about the cause — every frame in its stack sits inside
  the SQL driver. `registerErrorDiagnoser()` lets the package that owns an error contribute a
  diagnosis above the stack; `@zerotal/orm` registers the first one, turning a missing table into
  the list of migrations that have not run, with a button to run them. See [Errors](/docs/errors).
- **`bun zt dev` — the server and every companion process in one terminal**, with the Deck, a
  tabbed dev UI that adds no dependency. The queue worker runs as its own tab. A service provider
  contributes its own checks through `doctorChecks()`. See [Devtools](/docs/devtools).
- **Flow: `<ErrorBoundary>`, `stream`, `<SectionContent>` / `<SectionOutlet>`, and `<Virtualize>`.**
  A failing child now costs that child rather than the page; a slow child no longer holds up the
  shell; a page can fill a region its layout owns; and a collection too large for the DOM gets a
  scrolling window over it. `@zerotal/flow/browser` drives a real browser against a running app,
  and a compiled-versus-runtime parity suite keeps the two renderers honest. See
  [Flow](/docs/flow).
- **ORM: `migrate:refresh`, and `--seed` on `migrate` / `migrate:fresh`.** See
  [Migrations](/docs/migrations).
- **Queue: debounced jobs.** `debounce` on a `Job` collapses repeated dispatches into one run.
  See [Queue](/docs/queue).
- **Scheduler: durable run history**, so the monitor panel survives a restart. See
  [Scheduler](/docs/scheduler).
- **Media: `allowEnlargement` on a conversion, and `@zerotal/media/testing`.** `ImageDriver` is
  frozen, with its growth rule written down. See [Media](/docs/media).

### Changed

Most of this section is one body of work: the response to a Flow field report, hardening the path
from a local machine to a deployed box.

- **`app.allowedOrigins` is declared config and defaults to the origin of `app.url`.** The
  common deployment no longer needs to configure it at all, and the setting is visible where the
  rest of the app's URL configuration lives rather than being implied.
- **`bun zt doctor --url=…` probes a deployed transport from the outside.** It reports what each
  transport path actually answers over the wire, which is the question a failing WebSocket
  upgrade in production actually raises. `Application.declareWebSocketPath()` / `webSocketPaths()`
  let a package declare its own path so the probe covers it, and Flow declares `/__flow/ws` at
  registration. See [Deployment](/docs/deployment).
- **`serve` no longer rebuilds assets at boot in production**, and Flow no longer rebuilds its
  CSS/JS bundles at boot, when the output directory is read-only. A read-only tree is normal for
  a container image, and building at boot turned it into a crash. `bun zt assets:build` is the
  explicit build step to run before deploying. See [Assets](/docs/assets).
- **The Flow client says which transport failure it hit** rather than failing the same way for
  every cause, and `data-flow-connection` is stamped on a page that connected normally — so
  "is it live?" is answerable from the DOM.
- **`route()` takes query values as a third argument** — `route(name, params, query)` — and
  `route.dynamic(name, params?, query?)` covers a name that is not known at compile time.
- **`ctx.user` is typed as `UserModel`**, the same interface `Auth.user()` returns.
- **`SessionContract.get` and `pull` take an optional `<T>`.**
- **`withoutOverlapping`'s cross-process lock defaults to 5 minutes, not 24 hours.** A worker
  killed mid-run used to block its own schedule for the rest of the day.
- **`app/commands/` is auto-discovered**, and boot warns about a `routes/` directory nothing
  routes.
- **Thirteen packages reached `stable`** — `admin`, `audit`, `broadcasting`, `devtools`, `flow`,
  `flow-ui`, `i18n`, `inertia`, `media`, `monitor`, `notifications`, `telemetry` and `tenancy`
  — each after documenting its remaining exports and marking its plumbing `@internal`. The
  component reference now documents all 53 `flow-ui` components and cannot drift again.

### Fixed

- **Flow: a decorator could be registered against the wrong component.** Field decorators cannot
  see their own class, so each registration is buffered and matched to a class afterwards — and
  the match searched one flat buffer by field name. A component that declares a field and is never
  rendered leaves its entry there for the life of the process, so an unrelated component with a
  field of the same name could claim it and never receive its own. It showed up as `@reactive`
  silently failing to register, which remounts the child on every parent-pushed change rather than
  updating it in place. Matching is now per declaring class, and on the fields a class declares
  rather than everything on an instance.
- **Flow: a keyless child in a list was identified by its position.** Reordering a list without
  keys reused the wrong DOM node, so state attached to a row followed the position rather than
  the row.
- **Flow: a client expression that writes an `@expose` prop now syncs to the server.**
- **ORM: a `Date` in a query-builder write was silently discarded.**
- **ORM: altering a Postgres column silently dropped its `NOT NULL` and `DEFAULT`**, and SQLite
  now refuses an impossible `dropColumn` before applying anything rather than partway through.
- **ORM: the N+1 detector reads the bindings, not just the SQL text**, so it stops missing
  queries that differ only in their parameters.
- **Cache: stampede protection survives a compute slower than 30 seconds.**
- **Media: `fit: "cover"` works on the default driver**, `fit: "inside"` returns the dimensions
  it promised, and `fit: "fill"` with a single dimension behaves as `inside`. Both shipped
  drivers are held to one parity suite.
- **`serve --dev` built a Flow app's bundles three times on every start**, and dev asset builds
  are now skipped when nothing changed.
- **A weak `APP_KEY` never refused a production boot**, and **N+1 detection ran in
  production**. Both asked `Bun.env.APP_ENV` whether this was production — but that
  variable holds the runtime mode (`web`, `console`, `worker`) by the time anything
  reads it, so both always got "no". The deployment name is now preserved and read
  back through `deployEnv()`.
- **`staging` was production for some things and not others** — config validation
  refused an insecure staging boot, while assets went out unminified and were rebuilt
  at boot, which is exactly the combination that restart-loops on a hardened unit.
- **`app.secureHeaders` only allowed `frameOptions` to be configured**, so there was
  no supported way to turn HSTS on. Every option the middleware reads is now typed.
- **`setAppEnv("dev")` resolved to `console` rather than `web`.**

## 1.4.0 — 2026-08-10

### Added

- **ORM: encrypted columns.** A column can hold ciphertext at rest and plaintext on the model,
  keyed by `APP_KEY` with AES-256-GCM — `@column("encrypted") idNumber?: string`, or
  `static encryptable = ["idNumber", "passportNumber"]` for several at once. Unlike `hashable`
  this is reversible and does not touch the instance, so the property still reads as plaintext
  after `save()`. `where()` on an encrypted column throws rather than matching nothing (a fresh
  IV per write means the ciphertext never repeats), and a value the key cannot open fails the
  read rather than arriving somewhere as ciphertext. See [Casts & Mutators](/docs/orm/casts).
- **Auth: `TwoFactor.getQrCodeSvg()`** renders the two-factor enrolment QR code as an inline
  `<svg>`, drawn in-process. The `otpauth://` URI carries the TOTP secret, so the previous advice
  — hand it to a QR image service — posted the second factor to a third party. `encodeQr()` and
  `qrSvg()` are exported for drawing the symbol yourself. See [Roles & 2FA](/docs/roles-and-2fa).
- **Flow: `preserveScroll`** on `<Link>` and `navigateCurrent()`, for a sort header, filter or tab
  strip partway down a page that should not jump to the top.

### Fixed

- **Flow: `flow:navigate` did not scroll.** The SPA swap replaced the page under a stationary
  viewport, so following a link from near the bottom of a long list landed you halfway down the
  next page — which reads as the page having failed to load. A navigation now goes to the top (or
  to the URL's fragment), and Back and Forward restore where you were.
- **Flow: `focusOnError` did nothing on a runtime-rendered page.** The JSX runtime rewrote the
  hyphen in `flow:focus-error` to a dot, so the attribute never matched the selector the client
  looks for. It worked on a compiled page and silently did not on one the compiler bailed out of.
  `sortGroupId` was affected the same way.
- **Docs: two column examples named the wrong TypeScript type.** `@column("date")` hydrates a
  native `Date`, not a `Carbon`, and `decimal:N` surfaces as a `string` — the ORM overview typed
  both the other way, which `tsc` cannot catch because the decorator does not constrain the
  property type.

## 1.3.0 — 2026-08-09

### Changed — BREAKING

- **Mixin composition is now a static on the base class.** `ComponentWith(...)` and
  `BaseModelWith(...)` are removed; write `Component.using(Pagination)` and
  `Model.using(Authenticatable, Roles)` instead. A codemod ships in the repository
  (`scripts/codemod-mixin-composition.ts`) that rewrites call sites and imports. How mixins are
  _authored_ is unchanged. `using` also composes onto intermediate bases
  (`AdminPage.using(Pagination)`) and chains (`.using(a).using(b)`), neither of which the old
  helpers could express.
- **`Model` is the canonical ORM base-class name.** `BaseModel` remains exported as an alias for
  the same class, so existing code keeps working; docs and scaffolding now say
  `class User extends Model`.

### Added

- **`@zerotal/media`** — attach files to models with `Model.using(Media)`: collections with
  acceptance rules and retention, image conversions on `Bun.Image` (or `sharp`), responsive
  `srcset()` ladders with inline placeholders, queued conversion jobs, `MediaFake` test
  assertions, and `media:clean` / `media:regenerate` commands. See [Media Library](/docs/media).

### Fixed

- **Flow: an `@expose`d action on a shared page base could vanish from the action allowlist**
  (and be fatally rejected at runtime) whenever a subclass declared a decorated field — a Bun
  1.3.x decorator defect, worked around in the framework. `@expose`, `@task`, `@renderless`,
  `@on` and `@computed` were all affected.

## 1.1.0 — 2026-08-08

### Changed

- `FlowTest.call()` rethrows action errors and `FlowTest.set()` re-renders, so tests fail on
  broken actions instead of passing silently. A handler pointing at an un-`@expose`d method is
  now a build error (fatal at boot in CSP-safe mode).
- `@column("text")` maps to a real `TEXT` type rather than `VARCHAR` — affects newly generated
  tables and migrations only.

### Fixed

- Radio-group binding, reactive sibling attributes suppressing `value` bindings, modifier click
  handlers, `request().ip()` inside actions, a data-corrupting `json` cast on numeric-looking
  strings, and an unparseable `make:model` stub.

## 1.0.4 — 2026-08-07

- Fixed the Flow starter rendering unstyled (stylesheet path mismatch) and its missing favicon.

## 1.0.3 — 2026-08-06

- Re-released so npm build provenance resolves against the renamed repository.

## 1.0.2 and earlier — 2026-08-06

- First published versions of Zerotal.

## Next steps

- [Upgrade Guide](/docs/upgrade) — apply the migration notes for a new release.
- [Contributing](/docs/contributing) — how changes land before they reach this list.
