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

## 1.8.1 — 2026-08-26

DevTools showed you the wrong request, accurately.

### Fixed

- **A page keeps the DevTools panel while its own assets load.** Opening `/login` selected
  `/login`, then `/favicon.ico` a few milliseconds later, then `/css/app.css`. Live mode
  selected every trace as it arrived and a page's sub-resources arrive right behind it, so the
  bar named a request nobody asked about, the detail below described that request's headers
  and its empty session, and the page you were inspecting had scrolled into the list. Nothing
  shown was wrong; it was all about the wrong request.

  Traces are now classified into three kinds rather than two, because "not the document" would
  have suppressed the form post and the Inertia visit — the requests most worth watching. What
  gets skipped over is narrower: a sub-resource the browser fetched on its own initiative. The
  browser is asked rather than the URL, since an app may serve an API from a `.js` route and a
  build that hashes its asset names has no extension to read; what was actually served is the
  fallback, so a page fetched by `curl` still reads as a page. Anything unclassifiable counts
  as app traffic, never as an asset — being wrong there decides whether a request is skipped,
  and skipping the wrong one is how the panel stops showing what you came to see.

  An asset still takes the selection when nothing else has it, so a panel opened mid-load
  shows a request rather than an empty pane. A paused panel still counts assets toward its
  pending badge.

### Added

- **A `kind` facet on the DevTools All tab**, beside method and status. Assets were never the
  problem, only their claim on the selection, so they are not hidden: pick `page` and `api`
  for a list without fifty stylesheet fetches in it, or `asset` alone for what the browser
  pulled in, what it cost and which of it 404'd — which was not visible anywhere before.

## 1.8.0 — 2026-08-24

The first render mode, the codemod runner 2.0 depends on, and five failures that
each looked like something other than what they were.

### Added

- **`static interactive = false` — the first rung of Flow's render modes.** Every component
  until now was maximally interactive: rendered on the server, dehydrated into a snapshot,
  tracked by the client, reachable over a socket. Right for a counter, wasteful for a nav rail.
  A static component is rendered in full by its parent and nothing else — no `onDehydrate`, no
  snapshot, no `<script type="application/json">`, no entry in the client's registry, and no
  `data-flow-root`, which would freeze it at its first render since its only route to an update
  is the parent re-rendering it. It takes no place in `_childIds` and does not shift its
  interactive siblings' ids, so no sibling remounts and loses its state when a static one
  appears above it. `lazy`, `defer` and `stream` throw rather than being ignored: each waits
  for the client to ask for the real render, and a static child never registers to do the
  asking.

  Opt-in — nothing existing changes. `this.isInteractive` reports the mode from inside the
  component, and being a new public member it takes that name away from applications; it is on
  the documented reserved list. See [Static children](/docs/flow/layouts#static-children).

- **`zt upgrade` — the codemod runner.** The 2.0 ledger's rule is that every entry that can
  have a codemod has one before 2.0 ships, and until now nothing had been built, which made
  the ledger a list of changes nobody could afford to make.

  **Dry by default**, which is backwards from most tools and deliberate: it rewrites source
  across a whole project, and the first run should be something you can read and disagree with.
  `--write` applies it. Nothing is written until the whole plan is known, so a run that fails
  halfway leaves no half-upgraded tree, and `--dry` exercises the same code path as the real
  thing rather than a parallel one that can drift from it. Codemods see each other's output,
  because two of them touching one file across a version range is ordinary.

  **What it could not do is the headline.** A codemod that walks past what it does not
  understand is worse than none, since the changes it _did_ make imply the job is finished. So
  every codemod returns two lists and the runner prints the second last and loudest, with file,
  line and a reason. The first codemod covers the deprecated aliases — `BaseModel` → `Model`,
  `routes:types` → `route:types`, `serve --dev` → `dev`. See [Commands](/docs/commands).

- **`--clean` on `assets:build` and `inertia:build`.** Pruning is conservative by default:
  chunk-shaped filenames, plus whatever the last build on this machine recorded in `.zerotal/`.
  That cannot recognise output some other naming produced. `--clean` needs no record — the
  output directory belongs to the build, and what the build did not write does not belong in
  it. It refuses `public/` and the project root, where deleting what was not rebuilt takes the
  app's images and favicon with it, which is the one failure here that building again cannot
  undo. Pruning stays the default; only you can say the directory holds nothing else.

- **Agent skills, from `@zerotal/arch`.** `AGENTS.md` is short because every prompt it lands
  in pays for its whole length, so it points rather than teaches. That has a cost: an agent
  gets a map and no detail, and the detail is where the expensive mistakes live. A skill is a
  file with a one-line description that costs nothing until an agent decides it is relevant,
  so a procedure can be written out in full. Two ship — one on changing the schema (who owns
  it in your app, the mixin columns nothing declares, and why an unguarded `ALTER TABLE`
  collides during a release's `migrate`) and one on shipping a release (naming your own deploy
  steps, replacing the asset directory rather than merging into it, `trustedProxies` behind a
  proxy, and the pipe that hides a test suite's exit status).

  Written to `.agents/skills`, plus `.claude/skills` when that agent is detected. To replace
  one this ships, edit it and delete its marker line — a `SKILL.md` without the marker is
  yours and is never rewritten. `ArchConfig({ skills: false })` turns the feature off. Run
  `zt arch:update` to install them.

- **`zt doctor` reports agent instructions that no longer describe your project.** Every fact
  in the generated block moves without anyone thinking about the file: add a migrations
  directory, turn `synchronize` off, install a package. It goes on reading as current while
  describing the app you used to have, and guidance that is confidently out of date gets
  followed rather than questioned. Skills rot the same way and are easier to miss, since
  nothing reads one until an agent decides it is relevant — by which point it is being acted
  on. The check regenerates both and compares, and names `zt arch:update` as the fix. A
  warning, not a failure: it misleads a reader, it does not stop the app working.

### Changed

- **A Flow page with nothing interactive on it opens no socket.** Every page connected at
  boot, unconditionally — so a marketing page, a docs article or a rendered report held a
  WebSocket per visitor, open on both ends for the life of the visit, to carry nothing. Both
  paths that write to the socket take a `FlowComponent`, so with none registered there was not
  a frame that _could_ be sent. The connection is made when something needs it now: after the
  initial scan, after an SPA navigation, after a patch registers a child. `<Link navigate>`
  fetches over HTTP, so a static page with links stays disconnected. A routed page honours the
  same static, which is the half that matters — a page is a component, and one whose children
  are static but which is interactive itself still connects.

- **The `@zerotal/arch` agent block describes how your app is set up, not only what it
  installed.** A package list answers "what is available here", which is not the question that
  decides what an agent should write: the framework's contracts are not uniform across
  projects, and the places they differ are the places where guessing wrong compiles cleanly and
  fails at runtime. `AGENTS.md` now states the four facts that change an instruction — who owns
  the schema, whether route names are typed, whether `exactOptionalPropertyTypes` or
  `noUncheckedIndexedAccess` are on, and whether there are tests to run. Read off disk rather
  than from a booted app, because a project that will not boot is often why the agent surface
  is being installed. `.env` is deliberately not among the files read: this output is committed
  and pasted into prompts, and a detector that reads secrets is one refactor away from emitting
  them. Re-run `zt arch:update` to pick it up.

### Fixed

- **No mail could be sent over port 587.** A STARTTLS upgrade hands back a new socket and
  leaves the old one attached, still firing its callbacks — and what that one delivers from
  then on is the undecrypted TLS stream. Both sets of handlers appended to a single reply
  buffer, so handshake records and ciphertext sat in the middle of the server's replies and no
  line in the buffer matched a reply any more: the driver waited out its timeout without ever
  parsing the `250`, and the server logged a connection lost after STARTTLS. Measured, 1,737
  bytes of ciphertext went into the discarded socket's handler while the TLS handler received
  the replies.

  `close` and `error` were worse than `data`. The plaintext socket ending is a normal part of
  handing over to TLS, and it marked the live connection closed — rejecting whatever was
  waiting on the session that had just replaced it. Each set of callbacks now captures the
  generation it was installed for, and an upgrade bumps it.

- **An Inertia `303` redirect left the browser doing nothing at all.** `X-Inertia: true` was
  set inside the 302-to-303 conversion, so it only ever reached a redirect that arrived as a
  301 or 302 from a non-GET handler. A handler returning the 303 the protocol asks for skipped
  the only line that marked its response — and `redirect(to, 303)` is what
  [Authentication](/docs/authentication) tells people to write, in eight places. The form
  submitted, the row was written, the mail went out, and the fields stayed filled in: a hang
  from both ends, which is the worst shape a failure can take. Marking now happens for every
  redirect status on an Inertia request, with the conversion a separate decision on top of it.
  `307` and `308` are marked but left alone, since preserving the method is the whole reason to
  choose them.

- **Answering the busy-port menu killed `serve --dev` on the spot.** The banner printed, then
  `exited with code 1`, and nothing said why. Reading a prompt locks Bun's stdin stream, and
  the lock is deliberately held for the life of the command so a second prompt can still read —
  so the dev deck taking the terminal over threw `ReadableStream is locked`. It died inside the
  alternate screen buffer, and restoring the terminal on the way out erased the error along
  with everything else drawn there, which is why this was reported as "it just exits" rather
  than as the error it was. The prompt hands stdin back where it took it; a deck that still
  cannot have stdin degrades to streaming rather than dying, and a dev-mode failure stops the
  deck before it reports.

- **Two builds sharing an output directory deleted each other's files.** Nothing forbids
  `inertia:build` and `assets:build` writing to the same place, and the defaults invite it: one
  writes to `public/assets`, `app.assets.outDir` often names the same directory, and the
  default release pipeline runs them one after the other. The record of what to prune was one
  flat list per directory, so each build read the other's files as its own previous build and
  removed them. The release ended with whichever ran last and nothing reported a problem — the
  build that lost still said "Build complete" on its way out, and the page it served then 404'd
  its own script. The record is keyed by entry point now: a file another build claimed is not
  this one's to remove, while chunks nobody claims are still swept.

- **`zt doctor` failed a schema configuration that works.** Sync on plus migrations present
  read as "the schema needs exactly one source of truth", which misses the documented
  arrangement where sync builds the schema from the models so a fresh clone runs without a
  migration step, and `synchronize` is an expression that is false in production, where the
  deploy runs `migrate`. The two never apply in the same environment. It fails in production
  now, where the deploy really does run both, and warns elsewhere. A check that cries wolf
  against a correct configuration is what stops `zt doctor` ever being trusted to gate a
  deploy.

### Documented

- **Replace a release directory, do not merge into it.** Chasing 195 orphaned chunks on a
  server showed the build was never the problem — ten releases of a code-split app into one
  directory hold steady at the build's own output, and every one of the reporting app's 68
  chunks is referenced. What accumulates is the _release_: the archive is extracted over the
  running directory, so every file in it is written and every file not in it is left alone, and
  nothing on that machine ever runs a build. They stay publicly fetchable at their
  content-hashed URLs, which is how copy that was taken down went on being served.
  [Deployment](/docs/deployment) now gives the two spellings that replace the directory.

## 1.7.5 — 2026-08-23

Two bugs that shipped to every deployed app, a package promoted to `stable`, and
the gates that would have caught both.

### Changed

- **`@zerotal/arch` is `stable`.** Reviewed ahead of its 1.9.0 date. The API follows
  SemVer strictly from here, and that promise covers the **MCP tool contract** — tool
  names, their arguments, and the shape of what they return. That is what an agent
  client is configured against, and nothing type-level can see it: `archTools` has the
  same signature however the tools are named. `mcp-surface.md` records all nine and CI
  diffs it on every change. The protocol revision the server speaks is not covered; it
  follows the protocol.

- **INTERNAL — the writers behind `arch:install` are no longer public API.**
  `detectAgents`, `applyMcpConfig`, `applyBlock`, `buildGuidelines` and the rest are
  `@internal`: still exported, still working, no longer promised. Their only caller is
  the install command, and freezing them would have committed the shape of `.mcp.json`
  writing to the rest of the 1.x line on behalf of a caller who never arrived.

- **INTERNAL — `api-surface.md` honours `@internal` across every package.** The
  contract has always read "anything importable without an `@internal` marker keeps its
  shape", and the generator did not read the tag — so symbols already marked internal
  were recorded as though promised. 374 entries across 13 packages are omitted now,
  every one verified marked. Nothing changes at runtime or in the types; the file
  listing the promises now lists the promises.

- **A modal locks the page behind it.** `<Modal>` and `<Drawer>` trapped focus
  correctly while the page underneath kept scrolling, which on a phone reads as the
  dialog having broken the page.

- **Flow marks the active nav link for everyone.** `<Link navigate>` set
  `data-current`, which styles a link, and nothing that announces it. It sets
  `aria-current="page"` alongside now, so a screen reader can tell which of thirty nav
  items is the current page.

### Fixed

- **Assets were cache-busted in development and not in production.** `asset()` appended
  `?v=` only when a dev version was set, so every deployed Zerotal app served the
  previous build's JavaScript and CSS to anyone with a warm cache — indefinitely, since
  the URL never changed. The version is now derived from the built files themselves, so
  it is stable across restarts and moves when the files do.

- **DevTools mounted on production pages.** The provider is gated on the environment, so
  the endpoints are absent outside development — and the client took that to mean it
  could start anyway, pinning a floating panel to the page whose tabs read
  `Could not read the map — HTTP 404`. It now mounts only when the server half says it
  is there, via a `<meta>` the middleware writes, and makes no request at all on a
  public hostname.

- **Browser tests drove an unstyled site.** `Router.static("/", public)` is registered
  only for the `web` environment, and a test app is not one — so every `FlowBrowser`
  suite served pages without their stylesheet. Invisible to assertions that read text;
  fatal for anything measuring layout.

### Documented

- **Every TypeScript example in the documentation is compiled against the real
  packages**, on every pull request. 1,593 blocks. The gate found examples importing
  symbols that do not exist (`currentUser`, `Layout` from the wrong package), calling
  methods that were renamed (`Cache.put`), and configuring fields with `env()` where the
  type is a literal union. Blocks deliberately written as fragments say so in their
  fence and are recorded by key, so a new one is a deliberate act rather than a silent
  exemption.

- **A break cannot ship without a release note.** `api:surface:check` demands a
  regenerated snapshot when an export changes and then goes quiet, so the changelog was
  defended by remembering — and 1.7.3 shipped the removal of Flow's `this.title(…)` with
  no BREAKING entry. That entry is now in 1.7.3's notes, the support policy counts three
  breaks rather than two, and `breaking:check` reads the snapshot diff so the next one
  cannot pass silently.

- **A maturity label falls due.** The review release for a package below `stable` lives
  in its `package.json` as `maturityReview`, and the package-conventions gate fails once
  the version reaches it.

## 1.7.4 — 2026-08-21

A debug panel that was reaching production, a column type MySQL would not index, and
2,060 icons.

### Fixed

- **DevTools no longer appears on a production page.** The provider is gated on the
  environment, so in production its routes are absent — and the browser client took that as
  permission to start anyway and "connect to nothing". It did not: it mounted the panel first
  and discovered the absence afterwards, so an app calling `DevTools.start()` unconditionally
  served a floating DevTools bar to every visitor, its tabs reading
  `Could not read the map — HTTP 404`.

  `start()` now probes for the routes and builds nothing unless they answer — no shell, no
  shadow root, no `EventSource`, no listeners. Any failure (404, offline, CSP) is read as
  absent. **If your app calls `DevTools.start()`, take this release.**

- **A string column could not carry an index on MySQL.** `table.string()` compiled to `TEXT`
  on every engine and discarded its `length`, and MySQL refuses to key a TEXT column without
  a prefix length — so `table.string("email").unique()` failed at `CREATE TABLE`. MySQL now
  gets `VARCHAR(length)`; SQLite and PostgreSQL keep `TEXT`. `char()` had the same bug and the
  same fix. Found by the new MySQL suite on its first run against a real server.

### Added

- **`<Icon name="inbox" />` — 2,060 icons, bundled, typed by name.** The set ships inside
  `@zerotal/flow-ui`, so there is nothing to install and no generator to run: a fresh app gets
  autocomplete over every name and a compile error on a typo. Rendered on the server as inline
  SVG, so there is no icon font, no sprite, no request per glyph, and nothing for a strict CSP
  to block. Four icons are drawn for sign-in flows the set has no name for — `passkey`,
  `two-factor`, `otp`, `magic-link` — and three brand marks ship for the social-login providers
  `@zerotal/auth` supports. See [Icons](/docs/flow/icons).

- **The ORM suite runs against MySQL 8 in CI, and the job blocks merges.** The same smoke
  suite that covers PostgreSQL — schema DDL and `ALTER`, identity columns, CRUD, type
  round-trips, unique and NOT NULL enforcement, row locks, transaction rollback. MySQL moves
  from _experimental_ to _supported, hardening_; see the
  [Support Policy](/docs/support-policy).

### Changed

- **The starters link by route name.** Every hard-coded `href="/about"` in the React and Vue
  templates now goes through `route()`, and the templates ship the generated route table so a
  freshly scaffolded app type-checks before its first `zt dev`.

### Documented

- **The HTTP client guide is one page.** Eight pages became one, written from where the
  package is used — your app calling somebody else's service — with straight URLs instead of
  a route map threaded through every example. See [HTTP Client](/docs/client).

- **`route()` in Inertia**, for links and for form submissions, including the one thing Inertia
  adds: a page renders in two processes, so `defineRoutes()` has to run in the SSR entry too.
  See [Building URLs](/docs/inertia/rendering#building-urls-with-route).

- **Every package changelog has the release headings it was missing.** `[Unreleased]` had
  accumulated four releases of shipped work — `@zerotal/flow-ui`'s newest heading read
  `[1.5.0]` while 1.7.3 was on npm. Cutting a release now moves them.

## 1.7.3 — 2026-08-20

Two fields that accepted input and threw it away, a CI job that was testing nothing, and a
name given back to applications.

### Changed

- **BREAKING — `this.title(…)` is removed from Flow components.** Declare `static title`
  instead, as a string or a function of the component:

  ```ts fragment
  // Before
  override async mount(): Promise<void> {
    this.title(`Search: ${this.query}`);
  }

  // After
  static title = (c: SearchPage) => (c.query ? `Search: ${c.query}` : "Search");
  ```

  The instance method held a name four separate components wanted for their own data — a
  media row, a guide, a review, an issue — for a one-line accessor that belongs on the class.
  The static form is also the better one: it is resolved on the server for every render and
  every patch, so a title that depends on state follows it without an action remembering to
  update it.

  A call to `this.title(…)` on a component that declares its own `title` field now sets that
  field instead of the document title, which is silent. Search your components for
  `this.title(` before upgrading; every hit is either a migration or was already shadowed.

### Fixed

- **A boolean column could not hold a boolean on PostgreSQL.** `table.boolean()` compiled to
  `INTEGER` on every engine — right for SQLite, which has no boolean type, and rejected by
  PostgreSQL, which has a real one:

  ```text
  column "active" is of type integer but expression is of type boolean   (42804)
  ```

  Every insert of `true` failed, and so did every `where("active", true)`. The storage type
  now comes from the dialect, as the auto-increment column already did. SQLite and MySQL are
  unchanged — MySQL's `BOOLEAN` is a synonym for `TINYINT(1)` and `INTEGER` takes 0/1 either
  way, so there was nothing broken there to fix.

  **Existing PostgreSQL tables keep their integer columns.** New tables get `BOOLEAN`; a table
  already created needs an `ALTER` if you want the column converted:

  ```sql
  ALTER TABLE posts ALTER COLUMN active TYPE boolean USING active <> 0;
  ```

- **A bound password field discarded every keystroke.** Flow's client-writable set was
  `fillable` minus `hidden`, which conflates two allow-lists answering different questions:
  `fillable` governs what may be _written_, `hidden` governs what may be _shown_. A password
  is in both, so subtracting made it unwritable — `<input type="password"
value={this.user.password} blur />` accepted typing and dropped it on arrival.

  `hidden` is no longer subtracted. It is still never sent: the stored hash does not leave the
  server and the field arrives empty. A hidden value **the client supplied** survives until
  save; one **the server produced** is never echoed back, and a half-typed one is stripped
  from the durable snapshot before it is persisted.

### Changed

- **The PostgreSQL CI job blocks merges.** It had been running the ORM suite beside a Postgres
  container without connecting to it, so it reported success without testing anything. A smoke
  suite now exercises schema DDL, identity columns, CRUD, type round-trips, row locks and
  transaction rollback against a real PostgreSQL 16, and a failure fails the build. The
  boolean defect above is what it found on its first real run.

### Documented

- **Flow pages take their model from the route, not from a query.** The docs opened every
  model example by fetching the record in `onMount()`, which predates a route being able to
  hand a component the record. `models.md` leads with the bound form; `lifecycle.md` no longer
  presents the old id-plus-`onHydrate`-re-query as the correct pattern. The old shape still
  works — it is simply two fields and a query doing what one field now does.

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
