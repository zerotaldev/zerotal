# Changelog — @zerotal/core

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **A `_layout` file that could not apply rendered its pages without one.** The same
  fail-open the `_middleware` loader had, one function up in the same file, and found by
  looking for the shape rather than by hitting it: an import error was swallowed together
  with the not-found case under "component resolution is best-effort". Best-effort is
  right for _absence_ and wrong for a file that exists and threw — a `_layout.tsx` with a
  typo rendered every page beneath it without its chrome, with no error and no log, and on
  a hot-reload without chrome it had a moment earlier.

  Absence stays silent and the walk continues outward, as before. An import error stops
  the boot with the path and the original error, and a `_layout` that default-exports no
  component now says so rather than silently handing those pages an outer directory's
  layout instead.

  Worth noting alongside the `_middleware` fix in 1.15.0: these two sibling conventions
  disagreed about export shape — `_layout` reads `default` and ignored a named export,
  `_middleware` read the named export and ignored `default` — and each failed open on the
  other's spelling. That disagreement is why `export default` was the natural guess in a
  `_middleware.ts` to begin with.

- **`zt doctor` says when its outside-in probes did not run.** The response-header and
  WebSocket-transport probes only run with `--url`, and they are the two checks that can
  see what no in-process check can. Being silent about skipping them meant the people who
  most needed them were the ones with no way to learn they existed — a team running
  `doctor` after every deploy for months never saw the duplicate-header check.

  A line, not a new default: auto-probing `app.url` would print "✓ No duplicated security
  headers" for a site that was merely unreachable, which is the same false confidence the
  secure-headers check was fixed for in 1.15.0.

## [1.15.0] — 2026-09-04

### Changed — **BREAKING**

- **BREAKING: a `_middleware.ts` that cannot apply now stops the boot.** Two ways one could
  fail were silent, and both left the routes it was written to guard live and unguarded.
  An app where either was happening will now refuse to boot until the file is fixed —
  which is the point: it was not guarding anything before, and nothing said so. A directory
  with no `_middleware` file is unchanged and stays silent. See the
  [Upgrade Guide](/docs/upgrade#114-to-115).

### Fixed

- **A `_middleware.ts` that default-exported its list left the subtree unguarded.** The
  loader read only `export const middleware`, so `export default [EmployerMiddleware]` was
  ignored — no warning, no boot error, nothing in `route:list`. The app started, the routes
  answered, and the directory the file was written to protect served to anyone. `export
default` is the natural guess: every route file in the same directory default-exports its
  handler.

  The file now has to export a `middleware` array, and boot fails naming the file and the
  fix when it does not. Nothing rejected here has ever applied, so no working app changes.

- **An import error in a `_middleware.ts` was swallowed with the missing-file case.** Both
  shared one `catch`, so a typo, a bad import path, a circular import or a `SyntaxError` all
  read as "this directory has no middleware" and the routes beneath went on serving — on a
  hot-reload, a guard that had been there a second earlier.

  Absence and failure are now separate: no file is silent, as the convention intends, and a
  file that threw stops the boot with the original error and its path. Under `zt dev` the
  reload aborts and the previously compiled routes keep serving, so the guard never drops.

- **`zt doctor`'s secure-headers check failed on any app behind a reverse proxy.** It read
  `app.secureHeaders.secure` and inferred the response from it, so a deployment where Caddy
  or nginx terminates TLS and sets HSTS — the most common production topology for a Bun app
  — was reported as downgradeable while `curl -I` showed the header present. A check that is
  wrong on the ordinary case is one people learn to skip.

  It now makes one request to `app.url` on a deployment and reports what came back. When it
  cannot reach the site, it warns with what it actually knows — the app does not send HSTS,
  confirm the proxy does — instead of asserting a header is missing. Unreachable is no
  longer reported as absent.

### Added

- **`zt route:types` regenerates every type file the app generates from its file tree**, not
  only `types/routes.generated.ts`. `@zerotal/inertia` registers its page registry through
  the new `registerTypeGenerator`, so adding a page and running the command whose name says
  it generates types now does. Previously it regenerated the routes half, `Inertia.render`
  still failed with `TS2345: … not assignable to 'PageName'`, and the error reads as a typo
  in the page name rather than a registry that has not been rebuilt. `--check` gates on all
  of them.

- **`zt test` no longer inherits `.env`'s mail, queue, session and cache drivers.** Bun loads
  `.env` into every process, so a developer with `MAIL_DRIVER=smtp` pointed at a local
  Postfix got a suite where every path that sends mail opened a real SMTP connection — one
  test going from milliseconds to a five-second timeout, failing only when run with its
  siblings, and invisible to anyone without a mail server configured.

  These four now get their in-process defaults (`log`, `sync`, `cookie`, `memory`), which is
  what the app's own config already defaults to. A value set in the shell still wins, so
  `MAIL_DRIVER=smtp bun zt test` works; `.env.test` is read and merged last; `--keep-env`
  turns the whole thing off. The command prints what it changed.

## [1.14.3] — 2026-09-01

### Fixed

- **`zt upgrade` never offered the 1.13.0 migrations.** `deprecated-aliases` bundled two
  retirements that shipped in 1.13.0 — `serve --dev` and `routes:types` — with the
  `BaseModel` rename that has not shipped and is scheduled for 2.0. A codemod carries one
  version, so it took the later one, and `zt upgrade --to 1.13.0` selected nothing at all.
  The migration for the release that broke `serve --dev` was unreachable by every app
  crossing it.

  Split into `deprecated-aliases` at 1.13.0 and `base-model-rename` at 2.0.0. An app moving
  to any 1.13+ release now gets the command rewrites, and one crossing to 2.0 no longer has
  `BaseModel` renamed as a side effect of a command alias.

## [1.14.2] — 2026-09-01

### Fixed

- **`zt upgrade` now rewrites `zt.ts serve --dev`.** The `deprecated-aliases` codemod
  anchored on `zt` followed by whitespace, so it matched `zt serve --dev` and missed
  `bun zt.ts serve --dev` — the form in every scaffolded `package.json`, and the one an app
  runs as `bun run dev`. The codemod reported nothing to do on the file that needed it most.

## [1.14.1] — 2026-09-01

### Fixed

- **A command that declares `needsApp = false` no longer boots the application.**
  `CommandRunner.boot()` booted unconditionally, so `zt version`, `key:generate`, every
  `make:*` scaffolder and the gate commands all paid for providers, a database connection
  and a schedule registry they never touch — and could not run at all when booting was the
  thing that was broken. A CLI you cannot reach when the app is down is missing exactly
  when it is wanted.

  Config is still bound, via the new `Application.bindConfig()`: `needsApp = false` is a
  claim about the _application_, not about configuration, and every scaffolder reads config
  for its output paths.

  This also makes `zt version --json` pipeable, which previously needed the `--version`
  form to avoid the boot log on stdout.

## [1.13.4] — 2026-09-01

### Fixed

- **The site gate's staff bypass was a denylist, and failed open.** 1.13.3 admitted any
  authenticated user whose role was not literally `"customer"`. In an app whose roles are
  `user` and `admin` — which is most of them — that is every signed-in visitor, so a
  private preview showed the site to anyone with an account. A gate that fails open is
  worse than no gate, because it reports success while doing nothing.

  It is now an allowlist: `gate.staffRoles`, defaulting to `["admin"]`. An app whose staff
  role is named something else gets no bypass and notices, which is the safe direction to
  be wrong in. The token path is unchanged.

- **The same code broke `tsc` for apps that do not use the gate.** `role !== "customer"`
  is a type error when an app's role union has no such member, and the framework ships TS
  source, so the error landed on a feature the app never touched. The role is read as
  `string` now, because the framework cannot know an app's role names and must not narrow
  to them.

## [1.13.3] — 2026-08-31

### Added

- **`Heartbeat` — which background processes are actually running.** An app could say what
  it _registered_ and nothing could say whether any of it ever _ran_.

  The failure this exists for was reported from production: an app shipped with no worker
  process, and every scheduled task silently did not execute for weeks. No hold was
  released, no reminder was sent, and nothing logged, because from the web process's point
  of view nothing was wrong. They found it by going looking.

  `@zerotal/core/heartbeat` — `beat()`, `start()`, `lastSeen()`, and `workerLivenessCheck()`
  for building the doctor check.

  The beat lives in the **cache**, because the reader is a different process from the
  writer and often a different machine, and the app has already chosen where its shared
  state goes. `sqlite` (the default) is shared across processes on one box, `redis` across
  machines, `memory` with nobody — which is why `lastSeen()` returns a distinct
  `"unknown"` rather than `"never"`. A check that reported a missing worker on every app
  using the memory driver would be wrong more often than right, and a check that is
  usually wrong is one people learn to skip.

### Added

- **A site gate — maintenance, and private preview.** From a proposal by the Trekly team,
  who were running a hand-edited `basic_auth` block in a reverse proxy, deliberately kept
  out of version control so it could not be deployed and forgotten into a live shop.

  Two states that look alike and are not. **Maintenance** means the site is down —
  everyone refused, staff included, because the usual reason a site is down is that its
  database is being changed underneath it. **Private preview** means the site is up and
  working, for the people invited to it, for weeks.

  `zt down`, `zt preview`, `zt up`, `zt gate:status`, and a `Gate` API at
  `@zerotal/core/gate` so an app can build its own switch. See
  [the guide](https://zerotal.dev/docs/site-gate).

  The details that are the reason this belongs in the framework rather than in each app:

  - **Maintenance is always `503` with `Retry-After`, and is not configurable.** A
    maintenance page at `200` tells a search engine the apology is your homepage.
  - **A preview token is stripped from the URL on first use**, via a redirect to a cookie.
    Left in the address bar it travels into `Referer`, analytics and screenshots.
  - **Webhook paths must be declared** in `gate.allow`. A payment provider posting a
    settlement into a maintenance window otherwise gets a 503, and that is a retry, a
    dropped callback, or a payment your books never learn about.
  - **The state is a file, and the token is stored hashed.** A flag in the database is
    unreadable exactly when the database is what you are working on; a token in a file is
    a credential in something every backup copies.
  - **It covers `Router.raw()` routes.** Found while testing: this framework's own docs
    site serves every `/docs/*` page from a raw route, so an early build gated the front
    page — which is what a person checks — and left all the content public.
  - **`zt doctor` reports a gate left on**, and a preview whose `until` has passed.
  - **The state file is gitignored** by the scaffold, which is the whole point.

### Fixed

- **`secureHeaders: false` no longer empties the kernel.** It set the kernel middleware to
  `[]`, which was the same thing as removing the headers until the gate joined that layer —
  at which point opting out of security headers would silently have taken the site gate
  with it. One feature's opt-out disabling another's is the failure the gate is otherwise
  about.

## [1.13.0] — 2026-08-31

### Changed — **BREAKING**

- **`LockDriver.extend()` is required.** Only affects a custom driver; all three built-in
  ones implement it.

  It shipped optional in 1.5.0 with `acquire(key, owner, ttl)` as the fallback, and the
  fallback was correct only by coincidence — `acquire` happens to be an owner-guarded refresh
  on every built-in driver, and nothing in the interface said it had to be. A third-party
  driver whose `acquire` takes a _free_ lock, which is the ordinary reading of the word, would
  have had `refresh()` silently take a lock another holder owned. That is the one thing a lock
  exists to prevent, and the contract was quietly assuming its way past it.

- **`routes:types` and `serve --dev` are retired**, in favour of `route:types` and `dev`.
  `zt upgrade` rewrites both.

  `serve --dev` **fails with a message** rather than being ignored. The flag is still declared
  for that reason alone: flag parsing runs non-strict, so deleting it would have left
  `serve --dev` starting a plain server with no watcher and no explanation — a retired flag
  that silently changes what a command does is worse than one that is still there.

### Added

- **The `client-tagged-template` codemod**, for the Flow removal above.

## [1.11.1] — 2026-08-31

### Added

- **`zt version`** — which Zerotal, which Bun, which app. The first question anyone
  asks when filing a bug, and the CLI had no answer: `zt version` was an unknown
  command, so the version had to be dug out of `package.json` or `node_modules` —
  both of which report what is _installed_ rather than what is _running_, and those
  differ for any process that has been up since before an upgrade.

  `--version` and `-v` are answered earlier still, before the runtime check, the
  config load and the app import, because those are the things someone is asking the
  version _about_. A version flag that only works when the app already boots answers
  a question nobody has. Add `--json` for a script.

  Two notes on the output. It is uncoloured, unlike every other `Command` helper,
  because it gets pasted into bug reports and piped into parsers more than it is read
  on a terminal. And prefer `zt --version --json` over `zt version --json` in a
  script: the application's boot log is written to stdout, so the second form emits a
  log line ahead of the JSON while the first never boots at all.

## [1.11.0] — 2026-08-31

### Fixed

- **A command can fail without throwing.** `CommandRunner` ran an unconditional
  `process.exit(0)` the moment `run()` returned and never read `process.exitCode` —
  which is the idiomatic way to fail a Bun/Node CLI without an exception, and what
  most people reach for. An app's `release:check` printed six blockers, set the code,
  and exited **0**; their deploy script read success and would have restarted a broken
  production deployment. `zt deploy` gates on the same value through
  `callInProcess`, so its own preflight had the hole too. A gate that cannot fail is
  not a gate, and this one failed _open_.

  `callInProcess` saves and restores the code around each command, because it runs
  them in-process and the value is global. Note for anyone doing the same:
  `process.exitCode = undefined` is a **no-op in Bun** — the previous value survives —
  so clearing it takes `0`.

- **A Bun the project never asked for is a warning, not a refusal.**
  `bun-plugin-tailwind` declares `bun` as a _required_ peer, so `bun install` fetches
  the Bun npm package as a second, newer runtime — and the runtime guard refused to
  boot. An app took two production outages on this: the first crash-looping behind a
  502, the second because the obvious fix (removing `node_modules/bun` after install)
  cannot work — that package's postinstall runs _during_ install, so deleting it
  leaves the tree incomplete.

  Nothing about that is two runtimes in play; nobody executes the stray copy. The
  guard now asks whether the project _declared_ `bun` in its own dependencies. If it
  did, the refusal stands. If it did not, it warns and names the likely culprit, the
  fix that works (`bun install --omit=peer`) and the one that does not.

## [1.10.0] — 2026-08-30

### Changed

- **Optional properties in public option shapes are declared `?: T | undefined`.**
  The generated `tsconfig.json` turns on `exactOptionalPropertyTypes`, under which
  `image?: string` and `image?: string | undefined` are different types: only the
  second accepts a key that is present and holds `undefined`. So an app with the
  strictness the framework shipped it could not write the most ordinary thing there
  is — `{ image: candidate ?? undefined }` — and had to spell every conditional field
  `...(x ? { x } : {})` instead. An options bag exists to be spread into; one built by
  spreading has conditionally-absent keys.

  438 properties across 115 files, applied by `scripts/exact-optional.ts` and checked
  by `bun run exact:optional:check` so the convention holds for shapes written later.
  Scoped to exported `*Options` / `*Config` shapes — what an app constructs — rather
  than every optional property in the codebase. Nothing changes for a reader: an
  absent optional property already read as `undefined`.

### Added

- **`zt assets:prune`** — remove the chunks an earlier release left behind, on the
  machine that never ran a build. `assets:build --clean` cleans the directory it
  _builds into_, which does nothing for the common release shape: build here, tar the
  output, extract it over `public/` there. Extracting merges — nothing removes a file
  the new release does not contain — so every deploy adds another set of
  content-hashed chunks. One app reached 225 chunk files for the 49 its entry point
  references. Ship `.zerotal/` with the release and this removes what the build record
  does not claim; without a record it says so and removes nothing rather than guessing.

- **`definedOnly` (`@zerotal/core/helpers`) and the `Resolved<T>` type.** Widening the
  option shapes moves a problem to the merge, and both of these are that problem's
  answer. Object spread copies own properties even when their value is `undefined`,
  so `{ ...DEFAULTS, ...options }` now lets an explicit `undefined` overwrite a
  default; `definedOnly` drops those keys, turning "supplied as undefined" back into
  "not supplied". (`deepMerge` already did this at every depth.)

  `Resolved<T>` is what a defaults-applied object is. **`Required<T>` is not**, which
  is the trap: `-?` removes the optionality a `?` introduced but not an `undefined`
  written into the type, so `Required<Options>` quietly stopped meaning "the defaults
  have been applied".

- **`zt deploy:<env> --check`** — the preflight gate on its own. A release script has a
  moment where the new code is on disk and the service has not restarted yet, and that
  is where a gate belongs: exit 0 and restart, exit non-zero and keep serving the
  previous release. Everything that can refuse already runs by the end of preflight and
  none of it mutates, so stopping there is a complete answer rather than half a deploy.
  A workspace that has lost its banking details, or had its mail driver knocked back to
  `log`, never goes live broken.

- **`engines.bun` is enforced.** Every generated app writes a floor and nothing had
  ever read it. `runtimeMismatch` did not cover this: it compares the running Bun
  against an _installed_ one, and most projects do not install Bun as a package, so
  it correctly says nothing about most of them. `startZerotal()` now refuses to run
  below the declared floor, so every `zt` command is covered.

  The failure it catches is narrow and expensive. `Intl` output moves between Bun
  releases, so a suite with currency or date assertions goes red on a runtime that is
  otherwise fine, the failures name the code they touch, and the version is the last
  thing anyone checks. `ZT_ALLOW_RUNTIME_MISMATCH=1` downgrades it to a warning.

- **`@zerotal/core/runtime`** (`zerotal/runtime`) — a subpath exporting the checks
  themselves: `runtimeBelowFloor`, `declaredBunFloor`, `runtimeMismatch`, `bunBinary`
  and the messages that go with them, so a script or a test can make the same
  assertion. A subpath rather than the main barrel, which is deliberately lean.

- **A boot line when a convention is skipped in this environment.** An env-restricted
  concern is skipped by _not looking_, which is correct and completely silent: from a
  web process's point of view nothing is wrong, because from a web process's point of
  view nothing exists. An app ran for weeks in production with `app/schedules` full
  and no worker process — no inventory hold released, no payment reminder sent, and
  nothing logged, because there was nothing to log. It was found by going looking.

  `runConventions` now says so once, at boot, and only when the directory actually
  holds files:

      Skipping 3 file(s) in app/schedules — the "schedules" convention does not run in env=web (it runs in: worker, console).

  "Skipping 0 schedules" on every boot of every app would be noise, and noise is how
  the line that matters gets scrolled past.

### Fixed

- **Named rate limiters honour `trustedProxies`.** `ThrottleMiddleware` resolves the
  client address from the socket unless told how many proxies sit in front — that was
  fixed, documented and covered by a doctor check. `RateLimiter`'s `.byIp()`,
  `.byUser()` and `.byApiKey()` did not: they used a private resolver that read the
  socket address and fell back to the **leftmost** `X-Forwarded-For` entry, with no
  proxy count anywhere in it. A `keyResolver` replaces the middleware's own
  proxy-aware path entirely, so the sibling API kept the bug the middleware had shed.

  Two consequences, in opposite directions. Where there was no socket address a client
  picked its own bucket by writing the header, which is the part of it the client
  controls. Behind a real reverse proxy — where there _is_ a socket address — it was
  the proxy's, so **every visitor shared one bucket**: the documented
  `RateLimiter.for("login").limit(5).every(60)` was five attempts a minute across the
  entire user base, and one attacker locked everybody out.

  All three now resolve through the same proxy-aware function, and
  `.trustedProxies(n)` is on the builder. The strategy is recorded and the resolver
  built at the end, so `.byIp().trustedProxies(1)` and `.trustedProxies(1).byIp()`
  mean the same thing.

- **`zt doctor` audits named limiters.** Its `trustedProxies` check exempted any
  throttle with a custom `keyResolver` — right for one keyed on a user id, where no
  proxy can affect the answer, and exactly wrong for `RateLimiter`'s built-ins, which
  _are_ custom resolvers and do key on an address. The check that exists to catch this
  skipped the whole API that still had it. The built-in resolvers mark themselves now;
  an app's own `.by(fn)` stays exempt, which is the point of the exemption.

- **The build record is portable.** Its filename was hashed from the output
  directory's _absolute_ path, so the same project built at `/home/me/app` and
  unpacked at `/opt/app` wrote and looked for two different files. A record shipped
  with a release matched nothing at the other end — which is why a server could not
  say which files belonged to the current release — and moving a checkout silently
  orphaned it. It is keyed on the path relative to the project now.

## [1.9.0] — 2026-08-29

### Added

- **`@zerotal/core/env` is documented.** A whole subpath — a strict, fully typed environment
  schema — had no page. `EnvSchema.define()` with the `t` field builders reports **every**
  failing variable at once rather than one per restart, which is the difference between one fix
  and three round trips through a deploy. See
  [Configuration](/docs/config-system#declaring-the-whole-environment--envschema).

- **`negotiate()` is documented.** One route, three audiences: a browser, an API client and the
  console, without three copies of the logic. It is what the framework's own error handler uses,
  which is why a 422 is a redirect-with-errors for a form post and a JSON body for a fetch.

- **The hashing helpers get the paragraph `safeEqual` deserves.** `a === b` on a token returns as
  soon as two bytes differ, and how long it took measures how much of the prefix was right —
  enough, over many attempts, to recover a secret a character at a time.

- Routing, config, cookie, view, storage and Carbon types are named.

### Changed

- **INTERNAL: 58 exports are marked `@internal`** — the file-routing internals, the router's
  compiled state, the context registry, the metrics instrumentation hooks, the view component
  symbols, and the config map/path types. Still exported, still working; none is something an
  app constructs.

### Changed

- **INTERNAL: the dev orchestrator's 26 exports are marked `@internal`.** `DevSupervisor`,
  `DevChild`, `DevSpawnFn`, `StreamDeck`, `TabsDeck`, `createDeck`, `collectDevProcesses`,
  `buildCssBundle`, `buildJsBundle`, `bootBuildDecision`, `detectCssPlugins`, `isWritableDir`,
  `startDevMode`, `registerDevHtmlSnippet`, `DEV_RELOAD_CLIENT`, `SERVER_PROCESS_NAME` and their
  option/result types.

  **Nothing is removed and nothing breaks** — they are still exported and still work. What
  changes is the promise: they leave the recorded API surface, because an app never constructs
  any of them and the only callers outside `@zerotal/core` are sibling framework packages wiring
  their own dev-time build. `DevProcessDefinition` — the one a package author actually writes —
  is unaffected and stays documented.

### Added

- **One project, one Bun.** `engines.bun` is a floor and nothing enforces it, so a project
  can end up serving its app with one runtime and running its suite with another — the
  shell's `bun` and a `node_modules/bun` put there by a transitive peer dependency nobody
  declared. Nothing announces that, and a green suite is then evidence about a binary the app
  is not served by. `startZerotal()` now compares `Bun.version` against the installed
  manifest and refuses on a mismatch, naming both versions and the two ways out. It is not a
  pin: the version to agree on is whichever one the project installed, so `bun update bun`
  moves it. `ZT_ALLOW_RUNTIME_MISMATCH=1` downgrades the refusal to a warning.

- **`DeployTarget.preflight`** — a slot for the app's own release gate, run after the config
  validators and `doctor` and before anything is built or migrated. A command named
  `release:check` is found by convention with nothing to wire up. A declared name that is not
  registered **fails** the deploy rather than being skipped: a missing `inertia:build` means
  the app has no Inertia, but a missing gate means the gate is not running, which is the
  state the feature exists to prevent.

- **`zerotal/shared`** — the helpers that are safe to import from a browser bundle:
  `pluralize`, `singularize`, `snakeCase`, `camelCase`, `tableNameFor`, `Str`, and new
  `formatMoney` / `formatNumber` / `formatDate`. Everything reachable from it is pure, and a
  test bundles the entry point for the browser to keep it that way. Without it a page that
  wants the framework's `pluralize` gets a second implementation written by hand, and the
  second copy is always the worse one — `"supplier line"` pluralises to `"supplier lines"`,
  and the naive rule gives `"suppliers line"`.

- **`doctor` check: rate-limit identity.** `ThrottleMiddleware` keys on the socket address
  unless told how many proxies sit in front of the app. That default is right and it is the
  wrong answer the moment you deploy behind one: the socket address is then the proxy's for
  every request, everybody shares a bucket, and the limiter inverts into a way for one
  attacker to lock out the rest. Nothing observable says so. A production-like deployment
  with a registered throttle and no `trustedProxies` is now reported.

### Changed

- **`zt test` spawns the binary running it**, not the name `bun` for the OS to resolve
  against `PATH`. A command whose job is to run this app's tests was handing them to whatever
  the shell happened to offer, so `node_modules/.bin/bun zt test` satisfied every check in
  the parent process and still ran the suite on a different runtime.

- **`BaseMiddleware.with()`** now documents that each call creates a distinct class and any
  per-class state goes with it — so re-using one `.with()` export on two routes shares that
  state. For `ThrottleMiddleware` that state is the hit counter, and on a sign-in flow it
  means a handful of fumbled passwords can spend the allowance a legitimate person needs to
  answer their second factor.

## [1.8.0] — 2026-08-24

### Added

- **`zt upgrade`** — the codemod runner. Dry by default: it rewrites source across a whole
  project, so the first run is something you read and disagree with before `--write` applies
  it. Nothing is written until the whole plan is known, so a run that fails halfway leaves no
  half-upgraded tree. The first codemod covers the deprecated aliases — `BaseModel` → `Model`,
  `routes:types` → `route:types`, `serve --dev` → `dev` — renaming the class only in a heritage
  clause and fixing the import to match. What it _could not_ do is reported last and loudest,
  with file, line and reason: a codemod that walks past what it does not understand implies the
  job is finished when it is not.

- **`--clean` on `assets:build` and `inertia:build`.** Pruning is conservative by default —
  chunk-shaped filenames plus what the last build on this machine recorded in `.zerotal/` —
  which cannot recognise output some other naming produced. `--clean` needs no record: the
  output directory belongs to the build. It refuses `public/` and the project root, where
  deleting what was not rebuilt takes the app's images and favicon with it.

### Fixed

- **Answering the busy-port prompt killed `serve --dev`.** The banner printed, then
  `exited with code 1`, with nothing on screen saying why. Reading a prompt locks Bun's stdin
  stream and the lock is held for the life of the command, so the dev deck's
  `process.stdin.resume()` threw `ReadableStream is locked` — and it threw inside the alternate
  screen buffer, so restoring the terminal erased the error on the way out. The prompt hands
  stdin back where it took it; a deck that still cannot have it degrades to streaming instead
  of dying, and a dev-mode failure stops the deck before it reports.

- **Two builds sharing an output directory deleted each other's files.** Nothing forbids
  `inertia:build` and `assets:build` writing to the same place and the defaults invite it, but
  the prune record was one flat list per directory — so each build read the other's files as
  its own previous output and removed them. The release ended up with whichever ran last, and
  neither reported a problem: the build that lost still said "Build complete", and the page it
  served then 404'd its own script. The record is keyed by entry point now, so a file another
  build claimed is not this one's to remove. Unclaimed chunks are still swept.

- **`zt doctor` failed a schema configuration that works.** Sync on plus migrations present
  read as "the schema needs exactly one source of truth" — but sync building the schema from
  the models for a fresh clone, with `synchronize` false in production where the deploy runs
  `migrate`, is a documented arrangement in which the two never apply in the same environment.
  It fails in production, where the deploy really does run both, and warns elsewhere.

## [1.7.3] — 2026-08-20

### Fixed

- **`make:request` generates a file that compiles.** The stub imported `@zerotal/validator`,
  which a scaffolded app does not depend on — it depends on the `zerotal` umbrella — so the
  generated file failed to resolve until the import was changed by hand. It also annotated
  `rules(): Record<string, FieldRule>`, the one thing `FormRequest`'s own docblock warns
  against: `validate()` reads the narrow return type through `ReturnType<T['rules']>`, so the
  annotation widened it back and every validated field arrived as `unknown`, silently, with a
  cast somewhere downstream the first sign of it.

- **Every other `make:*` stub names a package the app has too.** The same fault ran through
  nine generators: `make:command`, `make:controller`, `make:middleware` and `make:provider`
  named `@zerotal/core`; `make:job` `@zerotal/queue`; `make:observer` `@zerotal/orm`;
  `make:policy` `@zerotal/auth`; `make:test` `@zerotal/testing`. A scaffolded app depends on
  none of them — it has the `zerotal` umbrella — so each wrote a file that did not resolve.
  They now emit `zerotal` and its subpaths.

  `make:resource` was worse: `Resource`, `ResourceCollection` and `PaginatedData` are not on
  `@zerotal/core`'s root entry at all, so that stub was broken against the scoped name as
  well. It emits `zerotal/http`, where they live.

  `make:notification` keeps `@zerotal/notifications`: there is no umbrella subpath for it, and
  the `api` template installs it directly.

  A single test now runs all thirteen generators and fails on any import that is neither the
  umbrella, a Bun/Node builtin, a relative path, nor one of the scoped packages a template
  actually installs. Each generator's own test had only checked that the output mentioned the
  class being made, which is why none of this showed.

## [1.7.2] — 2026-08-18

### Added

- **`@zerotal/core/errors`** — a subpath for the error classes, so a module that can run in a
  browser can import `ZerotalError` without reaching the root entry. The root re-exports
  `CommandRunner`, which reaches the built-in CLI commands and `await import("bun")`, so a single
  root import is enough to make a browser bundle fail at resolution. `@zerotal/core/helpers`
  already covered `deepMerge` the same way.

  The rule this makes workable: **core's root entry is server-only.** Anything that might be
  bundled for a browser imports from a narrow subpath.

## [1.7.1] — 2026-08-16

### Changed

- **`APP_ENV` is the deployment name; the runtime mode moved to `APP_TYPE`.** They shared one
  variable and the mode won: `setAppEnv()` overwrote `APP_ENV` with `web` / `worker` /
  `console` at boot, so an app whose `.env` said `APP_ENV=development` read `"console"` back
  from `env("APP_ENV")` inside every CLI command.

  The dangerous direction is the one nobody hits in development. A guard written the obvious
  way —

  ```ts
  if (env("APP_ENV") === "production") refuseToWipe();
  ```

  — was **inert in every console command**, which is exactly where destructive commands live.
  1.7.0 patched the framework's own gates by parking a copy that `deployEnv()` read back, but
  application code reading the documented variable the documented way still got the mode.

  Two questions, two variables. `setAppEnv()` no longer touches `APP_ENV` at all and writes
  the mode to `APP_TYPE`; `runtimeMode()` reads it, and falls back to the legacy location so a
  process started by an older launcher still boots the right providers. An explicit
  `APP_TYPE` wins over the command, which is how `serve --dev` boots its supervised server as
  `web`. `deployEnv()` and `config("app.env")` are unchanged and still correct.

  No action needed in an app unless it sets `APP_ENV=web` by hand to force web mode — that
  still works, and `APP_TYPE=web` is the spelling to move to.

  Found seeding the first cookbook app, where a guard fired that should not have.

### Fixed

- **`Router.raw()` did not answer `HEAD`.** The pipeline derives a `HEAD` handler from every
  `GET` — its own docblock notes that not doing so gives "every uptime monitor,
  load-balancer probe, CDN origin check and `curl -I`" a 404 — and the raw path was left out
  of it. So `curl -I` against a raw route answered 404 while the `GET` beside it answered 200. This framework's own site serves `/docs/*` and `/blog` from raw routes, so every link
  checker and uptime probe aimed at the documentation was told the page did not exist.

  Derived from the wrapped handler rather than the bare one, so the security headers below
  ride along and a `HEAD` cannot answer with fewer than the `GET` it mirrors. A `HEAD` the
  app registered itself still wins. Third gap in the same family, after the headers and
  static files: any path that answers a request without running the pipeline needs whatever
  the pipeline was doing for it.

- **The dev deck would not scroll.** On the alternate screen a terminal has no scrollback of
  its own, so the wheel and the scrollbar had nothing to move and the deck read as frozen —
  from the moment tabs mode starts, every way of looking at an older line has to come from
  the deck itself, and only Page Up/Down did.

  It now asks the terminal to send the wheel as cursor keys (`?1007h`, released again on
  exit) and handles `↑`/`↓` and Home/End. Deliberately not mouse tracking, which would give
  real wheel events at the price of the terminal's own text selection.

  Two things had to change underneath. A read from stdin is not one key: a wheel tick arrives
  as the same arrow repeated once per line, all in one chunk, and two fast keystrokes arrive
  together — so a chunk is split into keys and the frame painted once at the end. And a card
  that has been scrolled up now holds its place: `scroll` counts up from the newest line, so a
  busy process used to drag the window down by a line for every line it printed, sliding the
  text somebody had stopped to read off the top while they read it. A card pinned to the
  bottom still follows its output, which is the one that should.

Both of the next two were found by wiring DevTools into this repo's own `apps/docs` and
driving it in a browser.

- **`Router.raw()` responses carried no security headers.** A raw route opts out of the
  _request_ pipeline — CSRF on a transport endpoint, session resolution on a relay — and was
  silently opting its response out of `SecureHeadersMiddleware` too. This framework's own
  documentation site serves every `/docs/*` page from a raw route, so every page of it went
  out with no `X-Content-Type-Options: nosniff`, no `X-Frame-Options`, no
  `Referrer-Policy` and no `Permissions-Policy`. In production the reverse proxy happened
  to add two of them, which is why nothing had noticed.

  The header set is now applied to raw responses at compile time, **add-if-absent** rather
  than overwrite: a raw route is the one place a handler owns its whole response, and an
  endpoint that deliberately allows framing has a reason the framework cannot see. The
  response is only reconstructed when something is missing, so the hot path — Flow's action
  endpoint is a raw route — pays nothing when it already has them.

  This is the third surface in the same family, after the pipeline and static files. Any
  path that answers a request without running middleware needs the same treatment.

- **`redactGraph` masked booleans.** Sensitivity is judged by key name, by substring, so
  `cors.credentials` matched "credential" and the DevTools Config tab reported
  `‹redacted›` where the answer was `false`. A boolean has two possible values: masking one
  conceals nothing a reader could not guess, and hides the security setting they opened the
  tab to check. Booleans now pass through; numbers still mask, since a number can be a PIN
  or an account. The helper also gained the test file it shipped without.

## [1.7.0] — 2026-08-16

### Fixed

- **Security headers now cover static files.** Files under `public/` are handed to Bun as
  pre-registered responses and served without entering JavaScript, so no middleware ran for
  them — including `SecureHeadersMiddleware`, which the framework advertises as automatic.
  Every asset went out with no `X-Content-Type-Options: nosniff`, which is precisely the
  response class sniffing protection exists for. The header set is baked into the compiled
  response at registration time, so Bun still serves the file natively; a header a mount
  declares itself still wins.

- **`BaseMiddleware.with()` type-checks its options.** `Opts` has a default computed from the
  middleware class, but a type parameter in an argument position is inferred from the
  _argument_ and only falls back to its default when inference finds nothing — so
  `with({ … })` inferred `Opts` from the object literal and type-checked the literal against
  itself. Every callback parameter arrived implicitly `any`, and a misspelled option was
  accepted in silence. `NoInfer` on the parameter makes the middleware's own option type the
  one that governs. It caught a real defect on the first run: `StorageProvider` was passing
  an `unknown` where a `StorageManager` was expected.

### Added

- **`DeepPartial<T>`, and `deepMerge` accepts it.** `deepMerge` does a deep merge and
  declared `override: Partial<T>`, which only makes the top level optional — so
  `{ drivers: { anthropic: { apiKey } } }`, the commonest thing anyone writes in a config
  file, was a type error against any shape whose nested block has other keys.
  `@zerotal/ai` had already hit this and defined a private copy; that copy is now deleted and
  the type is exported from the kernel. `BaseMiddleware.with()` takes it too, since it
  deep-merges as well.

- **`zt doctor --url` reports duplicated security headers.** A header the app sets and the
  proxy also sets is invisible from inside the process. Conflicting values fail — browsers do
  not agree which copy applies, so the control is enforced inconsistently — and identical
  duplicates warn. `Permissions-Policy` and `Referrer-Policy` are deliberately not checked:
  a comma is legitimate syntax there, and a probe that cried wolf on a correct header would
  be switched off before it caught a real one.

- **`RequestFailed` carries the error's class name and stack.** It had the message and the
  status, which is enough to say a request failed and not enough to say anything about how.
  A subscriber rendering a failure — the devtools Exception tab is the first — has nothing to
  show without them, and by the time the event is emitted the error object is the only place
  they exist. Both are optional trailing parameters, so nothing that constructs or reads the
  event needs to change.

- **`Application.providerReport`** — what each provider cost to boot and what it put in the
  container, in boot order. `bootDurationMs` said the app took 240ms and nothing said which
  provider spent it; the container listed a hundred bindings and nothing said who bound
  them. Boot order is itself the third answer, since it decides who wins a contested
  binding.

  Provenance comes from diffing the container registry around each provider's hooks rather
  than from the container recording a registrar — it keeps the cost at boot instead of on
  every binding, and adds no mutable state to the container for a question only a debugging
  tool asks. Async hooks are timed across their `await`, not up to it.

- **`FrameworkEvents.subscriptions()` and `Emitter.registrations()`** — which events have
  subscribers, and what reacts to them. The bus is the framework's nervous system and had
  been entirely invisible: `handlerCount()` returned one number for the whole thing.

- **`redactGraph` on the `@zerotal/core/security` subpath** — the object-graph redaction walk
  that every recorder needs and that three packages had each written for themselves. Copy a
  value, replace what a key name says is a secret, come back with something
  `JSON.stringify` survives.

  Shared because the hard parts are the same everywhere and are easy to get subtly wrong:
  cycles (a model with a back-reference to its parent is ordinary, and `JSON.stringify`
  throws on it), a depth bound (recording is on the request path), and values that read
  better flat than walked (`Object.entries` on a `Date` or a `File` produces something worse
  than useless).

  It is not a policy. Callers bring their own markers and their own sensitivity predicate,
  because those are not interchangeable — a debug panel's `‹redacted›` is a display choice,
  while an adapter implementing a published wire protocol has its markers specified for it.

## [1.6.3] — 2026-08-15

### Added

- **`serve --dev` says when the framework on disk is no longer the framework running.** A
  running dev server holds the code it imported at boot: `bun add zerotal@latest` in another
  terminal rewrites `node_modules` and nothing else, and a save restarts only the _worker_,
  which re-executes your app against that same in-memory framework. So an upgrade taken
  mid-session appears to do nothing — the fix is installed, the symptom persists, and the
  reasonable conclusion is that the fix does not work.

  The supervisor now compares the version it booted with against the one installed, on each
  restart, and says which is which:

  ```text
  [zerotal:dev] ⚠  framework upgraded on disk: running v1.6.2, installed v1.6.3
  [zerotal:dev]    restart the dev server to pick it up (a save will not).
  ```

  Once per version, so a long session is not nagged, and silent where there is nothing to read
  — a workspace checkout or a hoisted layout is not a finding.

- **The dev banner carries the version** — `Zerotal v1.6.3 › dev`. There was previously
  nothing on screen naming the framework a running server was actually executing.

## [1.6.2] — 2026-08-15

### Fixed

- **`serve --dev` killed its worker outright on Windows instead of stopping it.** A restart
  sent `SIGTERM`, but Windows has no POSIX signals: there that call is `TerminateProcess`, so
  the worker died mid-instruction. No provider ran `onStopping`, no open response was
  finished, no database handle was closed — on every save, since that is how the dev server
  reloads. The visible symptom was a console full of `ERR_INCOMPLETE_CHUNKED_ENCODING` from
  the devtools event stream, which is just what a chunked response looks like when the
  process writing it stops existing.

  The supervisor now **asks** over an IPC channel and kills only if the request goes
  unanswered within a second. POSIX behaviour is unchanged in substance — the worker runs the
  same `stop()` either way — and Windows gets the orderly shutdown it never had. Verified
  across a real hot restart: before, an open stream ended in a connection reset with the
  worker never draining; after, the stream ends cleanly and the worker logs its stop.

  A supervisor that cannot open a channel falls straight through to the signal path, so
  nothing waits out the grace period for a chance it never had.

### Added

- **`import.meta.env` is defined for bundled browser builds.** `DEV`, `PROD` and `MODE`,
  set from whether the build is a production one. It is a Vite convention rather than a web
  standard — `import.meta.env` is undefined in a browser module — but enough of the npm
  ecosystem branches on it that a bundler leaving it alone ships code reading a property off
  `undefined`. Bun leaves it alone, so Zerotal defines it.

  `BASE_URL` and `SSR` are deliberately omitted: Zerotal has its own answers for both, and a
  wrong value is worse than an absent one for a package that feature-detects.

## [1.6.0] — 2026-08-15

### Added

- **`route()` in the browser — `@zerotal/core/routes`.** The typed `route()` helper now has a
  browser twin. Hand it the table `bun zt route:types` already generates, once, at your
  entry point:

  ```ts
  import { defineRoutes } from "zerotal/routes";
  import { ROUTES } from "../../types/routes.generated";

  defineRoutes(ROUTES);
  ```

  and `route("posts.show", { slug })` works in a component exactly as it does in a
  controller. The table is a build-time constant, so it costs one static import, ships
  nothing per response, and needs no fetch before the first link renders. `hasRoute(name)`
  answers the conditional-link question without a try/catch, and `resetRoutes()` clears the
  table for tests.

  The two helpers are one implementation, not two that agree today. Everything a caller can
  observe — param encoding, catch-all handling, which mistakes throw and what they say —
  moved into a shared builder; only the table lookup differs (the live router on the server,
  the generated map in the browser). Both are typed as the same `RouteBuilder` interface, and
  both read the same `RouteRegistry`, so a name that type-checks in a controller type-checks
  in a component and a missing `:param` fails the build on either side. A parity test asserts
  the two produce byte-identical URLs and identical error messages.

  The entry point is browser-safe by construction: it imports nothing that touches `Bun`,
  the container, or request state.

### Fixed

- **Ten more places asked `APP_ENV` a question it cannot answer.** 1.5.0 and 1.5.1 each
  fixed the instances that had been noticed; this is the audit of every remaining reader,
  and it found more than either. `APP_ENV` holds the runtime mode once `setAppEnv()` has
  run, so any check comparing it against a deployment name was asking whether `"web"` is
  production. In core and its packages that meant:

  - **auto-`synchronize` was never hard-off in production**, so the only thing between a
    production database and boot-time schema sync was the config default. The comment above
    the guard claimed `APP_ENV` still held the deployment name, which is precisely the
    mistake;
  - **the Flow client bundle was never minified in production**, shipping ~183 KB
    unminified to every visitor;
  - **`forceState()`** did not refuse to run on live data despite the throw written for it;
  - **environment-scoped scheduled tasks never matched**, so `.environments(["production"])`
    silently never ran;
  - the N+1 detector's own gate, the monitor's reported environment, the admin environment
    badge, the large-snapshot warning, and four config-first reads whose fallback was the
    runtime mode.

  All of them read `deployEnv()` now. Everything still fails closed: production, staging and
  an unset environment behave exactly as before.

- **`useOnce()` demanded a cast from every caller.** `PipeClass` used `unknown[]` for its
  constructor arguments, which fails parameter contravariance for any middleware class with
  a typed constructor — so all eight packages that register middleware wrote
  `useOnce(Middleware as never)`, twelve times over. It uses the codebase's standard
  `any[]` constructor shape now, the same reasoning `container/types.ts` already documented
  for container tokens, and all twelve casts are gone.

### Changed

- **Reading `Bun.env["APP_ENV"]` directly is now a lint error.** Fourteen instances of one
  mistake across seven packages were each found separately; the rule is so the fifteenth is
  found by CI. Tests are exempt — pinning the variable is how a test reproduces what a
  server sees — and the handful of genuine runtime-mode reads carry an inline disable saying
  which of the two meanings they want.

## [1.5.1] — 2026-08-15

### Fixed

- **Every development-only surface switched itself off under `zt serve`.**
  `devSurfacesEnabled()` asked `Bun.env["APP_ENV"]` whether this was a development
  environment — but `setAppEnv()` replaces that with the runtime mode before the app is
  created, so it was asking whether `"web"` is development. The answer is no. An app with
  `APP_ENV=development` in its `.env` therefore got **production error pages** from a plain
  `bun zt serve`: no stack trace, no dev overlay.

  It reads `deployEnv()` now, which is where the deployment name survives. Production and
  staging are unaffected — both still fail closed, and an unset value still fails closed.

  This is the third instance of one mistake. The weak-`APP_KEY` refusal and the ORM's N+1
  detector had exactly the same bug, both fixed in 1.5.0. Reading `APP_ENV` to decide
  anything about the _deployment_ is wrong once the app has booted; `deployEnv()` is the
  answer.

## [1.5.0] — 2026-08-15

### Added

- **`bun zt deploy:<env>` — a release that refuses to finish when something is wrong.**
  The pieces already existed: `zt doctor` finds silent misconfigurations, config
  validators refuse an insecure production boot, `assets:build` builds a release,
  `migrate` applies the schema. What was missing was an order, and the order is the
  value: **everything that can refuse runs before anything that mutates.** A bad
  origin list stops the deploy while the old release is still serving, instead of
  after the migration has run and the new process is live and inert.

  Four phases — preflight (this really is that environment; every config validator
  re-run with production semantics; `doctor`), build, migrate, verify. It exits
  non-zero and **does not restart your service**: systemd or your container runtime
  owns process lifecycle, and this gives it a gate to restart behind.

  Every environment gets its own command. `production` and `staging` exist without
  configuration; `config/deploy.ts` declares more, each with an optional public URL
  and its own step list. The target name is checked against the deployment the
  process was actually started as, so `deploy:production` on a staging box stops on
  the first line rather than migrating the wrong database.

  `--dry-run` prints the plan, `--skip-migrations` releases without touching the
  schema, `--probe` runs a real WebSocket handshake against the deployed site.

- **Two new `doctor` checks, for the two settings nothing was watching.**
  `app.cors.origin: "*"` lets any website read this app's responses out of a
  visitor's browser — and it was what every scaffolded app shipped with, because the
  templates set it while the framework's own default was the safe empty list.
  `app.secureHeaders.secure` gates HSTS, defaults to false, and had no production
  detection anywhere, so a deployment that never set it sent no
  `Strict-Transport-Security` at all. Both fail on a production-like deployment and
  stay quiet locally.

### Fixed

- **A weak `APP_KEY` never actually refused a production boot.** The check asked
  `isProdLike(Bun.env["APP_ENV"])` — but `setAppEnv()` overwrites that variable with
  the runtime mode (`web`/`console`/`worker`) before the app is created, so the
  answer was always "no" and the refusal this code exists for had never once fired.

  `APP_ENV` carries two meanings and the second destroys the first. `setAppEnv()`
  now preserves the deployment name, and `deployEnv()` reads it back. Prefer it to
  `Bun.env["APP_ENV"]` for any production decision.

- **`staging` was production for some purposes and not others.** `isProdLike`
  accepted it — so config validation refused an insecure staging boot — while
  `App.isProduction()`, the doctor, the boot-build policy and the asset-minify
  default all excluded it. A staging box therefore got production-grade config
  refusal alongside unminified assets and a boot-time asset build, which is the one
  environment where the read-only restart loop was still reachable. All of them now
  agree.

- **`app.secureHeaders` could not be configured beyond `frameOptions`.** The
  middleware reads the whole block and layers it over its defaults, so every option
  had always worked — but only `frameOptions` was declared on the type, which made
  the rest a type error to write down. `secure` is the one that mattered: HSTS is
  emitted only when it is true, so an app had no supported way to turn HSTS on.

- **`assets:build` and `doctor` killed the process instead of failing.** Both called
  `process.exit(1)` directly, so composing either through `callInProcess` ended the
  caller — and in the doctor's case its buffered report was never flushed, so the
  failure arrived with nothing explaining it. Both throw now; the CLI exit code is
  unchanged.

- **The development error page can now say what to do, not just what broke.**
  `no such table: assets` is exact about the failure and useless about the cause:
  every frame in its stack is inside the SQL driver, because that is where the
  error surfaced rather than where it came from.

  `registerErrorDiagnoser()` lets the package that owns an error class contribute
  a diagnosis — a title, a paragraph, supporting specifics, and optionally a
  button — rendered above the stack. `@zerotal/orm` registers the first one; see
  its changelog. Diagnosers run in order, the first match wins, and one that
  throws is skipped rather than replacing a real stack trace with a stack trace
  about the diagnoser.

  A diagnosis with an `action` changes server state from a page rendered by a
  GET, so the type carries the values and the _endpoint_ owns the safety. That is
  stated on the type, because the alternative is each implementor rediscovering
  it.

- **Typed route names — `bun zt route:types`.** The command boots the app, reads the
  routes it registered, and writes `types/routes.generated.ts`: a name → URL pattern map
  plus a one-line `RouteRegistry` augmentation. With it, `route("psots.show")` and
  `route("posts.show", {})` are compile errors, and the second one names the `slug` it
  wants. Params are derived from the pattern, so adding a segment changes one string and
  every call site updates with it.

  It boots rather than scanning `routes/` because a route name comes from three places
  and only one is a file path — the file-router's convention, a route file's
  `export const meta = { GET: { name } }`, and programmatic registrations, including a
  package provider's. A scanner sees the first and quietly misses the other two, and a
  second implementation of the naming rules is a second implementation to disagree with
  the first.

  Freshness has three parts, because a generated file that is only right after someone
  remembers to run a command is wrong in every fresh checkout: `zt dev` rewrites it on
  every restart, the file is committed so editors and CI need no boot, and
  `route:types --check` fails when the tree has drifted from it. Until the file exists,
  the registry is empty and `route()` behaves exactly as before.

- **`route.dynamic(name, params?, query?)`** — the escape hatch for a route name that is
  only known at runtime (read from config, chosen by a package). Deliberately a separate
  function rather than a `string` overload on `route()`: an overload that accepts every
  string is matched by every string, which would have made the checked signature
  decorative. Typed names also flow through `redirect().to()`, `redirectTo()`,
  `Url.route()` and `Uri.route()`.

- **`app.allowedOrigins` is declared config, and defaults to the origin of `app.url`.**
  WebSocket upgrades and raw routes bypass the middleware pipeline, so each carries its
  own `Origin` check against the app's own origin — which behind a reverse proxy is the
  loopback address it bound to, never the public URL a browser sends. The runtime already
  read `allowedOrigins`, but `AppConfigShape` did not declare it, so the only way to set
  it was to spread it onto the exported config and the type system said nothing. Unset, a
  proxied app renders every page correctly and refuses every credentialed action with a
  403 — quieter than a 500, invisible in the logs, and passing any health check that reads
  a status code.

  It is now a first-class field, filled from `url`, and unions rather than replaces: an
  app naming a second origin does not mean "and stop trusting my own public URL".

- **`bun zt doctor --url=…` probes the deployed transport from the outside.** Every other
  check runs inside the process, and the expensive proxy failures are exactly the ones
  that cannot be seen from there. This sends a real handshake with a real `Origin` through
  the real proxy and reads the status: `101` is healthy, `403` is the origin guard, `401`
  is an auth gate over the transport (browsers do not send basic-auth credentials on a
  handshake), `404` is usually a proxy not forwarding the path.

  Two static checks come with it: **Transport origins** (empty list, an entry that is not
  an origin, or a production app still pointing at localhost) and **Asset output**.

- **`bun zt assets:build`** — build every bundle the app declares as a release step:
  `app.assets` entrypoints plus Flow's conventional `resources/css/app.css` and
  `resources/js/app.js`. `css:build` only ever covered the first half of that.

- **`Application.declareWebSocketPath()` / `webSocketPaths()`.** Handlers are only wired in
  the web runtime, so a CLI process could not name the app's own transport — which is what
  `doctor --url` needs. Providers declare the path in `onRegister()`, which runs in every
  mode.

- **`RequestContext.remember(key, factory)`** — run something at most once per request.
  The N+1 detector says a query ran too many times; when the answer is the same every
  time, the fix is to ask once, and every app that hits it rebuilds this by hand. Two
  behaviours are the whole point and are the ones a hand-rolled version gets wrong: the
  **promise** is cached rather than the resolved value (cache after the `await` and a
  `Promise.all` of ten readers all miss), and a **rejected promise is evicted** (leave
  it in and one transient failure poisons every later read in the same request).
  Outside a request it is a pass-through — a queue worker has no request to scope to.
  `RequestContext.forget(key)` drops a value when a write invalidates an earlier read.

- **Refreshable locks — a lock can now be held across work longer than its TTL.** Sizing
  a TTL was a trade with no good answer: too short and the lock evaporates mid-job, too
  long and a crashed holder blocks the key for however long you guessed. The number was
  being asked two different questions at once.

  `refresh: true` separates them. The lock is extended in the background for as long as
  the callback runs, so the TTL only has to answer "how long after a crash before someone
  else may take over" — a decision rather than a guess:

  ```ts
  await Lock.block(
    "report:monthly",
    60,
    async (lock, signal) => {
      await buildReport({ signal }); // may take an hour; 60 is fine
    },
    { refresh: true },
  );
  ```

  Refreshes run every `refreshEvery` seconds, defaulting to a third of the TTL so one
  missed beat is survivable. `ManagedLock.refresh()` exposes the same thing by hand for
  flows that span steps, alongside `expiresAt` — a client-side estimate, for deciding
  when to refresh next rather than for deciding whether you still hold the lock.

  **A lock that is lost anyway is not papered over.** The callback's `AbortSignal` is
  aborted and `LockLostError` is thrown, because work that continues after losing
  exclusivity is exactly the situation the lock existed to prevent. The signal is a
  request, not a guarantee — work that ignores it runs on — so a job that can do damage
  after losing the lock has to check it between steps.

  `extend` is **optional** on the `LockDriver` contract, so a driver written against 1.x
  still compiles; refreshing falls back to `acquire(key, owner, ttl)`, which is an
  owner-guarded refresh on all three built-ins. Both callback arguments are additive —
  every existing zero-argument call site is untouched.

  The refresh timer is `unref()`d and cleared in `finally` on all three exits (success,
  throw, and lock lost). An un-unref'd interval in a lock helper is the reason a process
  stops exiting, and nothing about that symptom points back here.

- **`bun zt dev` — the server and every companion process in one terminal.** An app with
  a queue needed two terminals and the discipline to restart the right one by hand. Worse,
  the gap was not closeable from a package: every library with a companion process — a
  worker, a listener, a watcher — had the same problem and no way to help, because the dev
  runner only knew about the server.

  A provider now declares one the way it declares `replContext()`:

  ```ts
  override devProcesses(): DevProcessDefinition[] {
    return [{ name: "queue", command: "queue:work", enabled: () => this._hasQueue() }];
  }
  ```

  and it appears as its own tab, individually restartable with `r`. `QueueProvider` ships
  the first one; it stays off screen under the `sync` driver and when an in-process worker
  pool is already draining the queue, because a tab with nothing to do is worse than no
  tab. Apps get the last word through `app.dev.processes` and `app.dev.disable` — reusing
  a name replaces the process rather than adding a second one.

  **A dying process never takes the server with it.** It restarts on its own, three times
  with backoff, and then parks that one tab with instructions rather than tearing dev mode
  down. This is deliberately the opposite of the asset build hook, where a failure aborts
  the reload — different lifetimes, different failure rules.

  `--only` / `--without` / `--list` / `--stream` / `--force-build` mirror `artisan dev`,
  so there is nothing to translate coming from another framework. `--list` names the provider behind
  every entry, which is the question you actually have when an unfamiliar tab appears.
  `serve --dev` is unchanged in spelling and gains all of it — `dev` is that command with
  a richer flag set, not a second implementation of it.

- **The Deck — a tabbed dev UI with no new dependency.** `@zerotal/core` carries exactly
  one external runtime dependency, and a terminal multiplexer off npm would be the second,
  in the package everything else depends on, to draw a box. Bun ships every primitive it
  needs: `Bun.stringWidth` measures what the terminal will actually show, `Bun.sliceAnsi`
  cuts a styled line without severing an escape sequence, and raw stdin gives us keys.

  Scrollback belongs to the deck rather than the terminal — 5,000 lines per process —
  which is what makes per-tab history and `/` search possible at all. `1`–`9` and the
  arrows select, `r` restarts, `c` clears, `t` toggles timestamps, `q` quits.

  **Stream mode is the base case, not a fallback.** Interleaved `[label] line` output with
  no escape codes whatsoever, chosen automatically whenever stdout is not a TTY, and what
  you want in a log file or CI. The tab UI is a layer on top of it. Either way the terminal
  is restored on every exit path there is — `q`, a signal, and an uncaught throw — because
  raw mode plus the alternate screen left on makes a shell unusable, and that is the
  classic way a TUI ruins someone's afternoon.

- **`doctorChecks()` on `ServiceProvider`.** The declarative counterpart to
  `app.registerDoctorCheck()`: same checks, same report, but asked of the provider rather
  than pushed from inside `onRegister()`, so a package's checks sit next to its other
  contributions and read without tracing a registration call. A provider whose method
  throws contributes nothing rather than failing the doctor for every other package.

- **Dev asset builds are skipped when nothing changed.** `serve --dev` rebuilt every bundle
  on every boot and every backend save, including when the project had not been touched.
  A build now records what it consumed and produced, and is skipped when none of it moved.
  The input set comes from two places, because one is not enough: the module graph, read
  back from the external sourcemaps the dev build already emits (lazily-imported chunks
  included), and — for stylesheets — a stat sweep of `app/`, `resources/`, `routes/` and
  `config/`, since Tailwind discovers utility classes by reading templates that appear in
  no sourcemap. Measured on a small app: a Tailwind CSS build of ~740 ms becomes ~1 ms.
  Every uncertainty resolves to _build_: a corrupt cache, an unreadable input, a deleted
  output, a changed config, or a different Bun version all rebuild. Minified (production)
  builds never consult it, and `ZT_NO_BUILD_CACHE=1` disables it everywhere.

- **`app/commands/` is auto-discovered.** `make:command` generates into the conventional
  directory, but the runner never read it — a generated command answered
  `Unknown command` until it was hand-registered in a provider, and nothing said so. The
  runner now discovers the directory in console/worker/test environments (after the
  built-ins, so an app command wins a name collision), the path is overridable via
  `app.conventions.paths.commands`, and `make:command` prints the run invocation. The
  scaffolded `zt.ts` comment describing the manual registration dance is gone.
- **`bun zt doctor`.** One command that runs every static sanity check against the booted
  app and prints each finding with its fix: APP_KEY strength, `database.synchronize`
  colliding with migration files, a `routes/` directory no `routing()` group loads, and
  class directories (`app/schedules`, `app/jobs`, `config/storage.ts`) whose consuming
  provider isn't registered — the family of failures that otherwise fail by doing
  nothing. Packages contribute their own checks via `app.registerDoctorCheck()` in
  `onRegister()`; the scheduler's static-config check is the first. Exits 1 when any
  check fails outright.
- **Boot warns about an unrouted `routes/` directory.** A conventional `routes/index.ts`
  full of `Router.get(...)` calls registers nothing until `.routing()` loads it, so every
  path in it 404s in a way indistinguishable from a typo'd URL. The web boot now names
  the files and the one-line fix. (`Application.routedFiles` is new, so the check — and
  anything else — can see what the routing groups actually load.)

### Changed — BREAKING

- **`route()` takes query values as a third argument: `route(name, params, query)`.**
  Previously any param that matched no `:segment` was appended to the query string, which
  meant a typo'd param name silently produced a URL that was wrong rather than an error —
  `route("posts.show", { slugg })` shipped `/posts/:slug?slugg=…`. Params are now exact:
  an unknown key throws, naming the key and pointing at the third argument.

  ```ts
  route("search", { q: "zerotal", page: 2 }); // before
  route("search", {}, { q: "zerotal", page: 2 }); // now
  ```

  Query values may be arrays (`{ tag: ["a", "b"] }` → `?tag=a&tag=b`), and `null` /
  `undefined` entries are dropped rather than serialised as `"null"`. The same applies to
  `redirect().to()` / `redirectTo()`, which take params only — build the URL with
  `route()` when you need a query string.

  This was a decision between typing the existing behaviour and fixing it. Typing it
  would have made a footgun look safe, which is worse than leaving it alone.

- **A catch-all route's value is passed under the `"*"` key.** `[...slug]` compiles to `*`
  in the URL pattern — the segment name is gone by the time routing sees it — and
  `route()` previously left the `*` in the URL untouched, producing a literal
  `/docs/*`. It now substitutes, from either a path or an array of segments:
  `route("docs.show", { "*": "guides/intro" })`, `route("docs.show", { "*": ["guides", "intro"] })`.

### Changed

- **`serve` no longer rebuilds assets at boot in production when the output directory is
  read-only.** Rebuilding on start is right in development and load-bearing for the wrong
  reason in production: it makes the server process require write access to its own output
  tree, so a properly hardened unit (`ProtectSystem=strict` with a tight `ReadWritePaths`)
  fails at startup with `Read-only file system: writing chunk "./app.css"` and
  restart-loops — with the logs blaming the filesystem rather than the boot-time build that
  made it a problem.

  A read-only output directory is now read as what it is: a deployment that built its
  assets ahead of time and locked the tree down. It serves what it shipped and logs one
  line. Everywhere else, and anywhere the directory is writable, behaviour is unchanged.

- **`SessionContract.get` and `pull` take an optional `<T>`.** The contract's own
  docblock said higher-level surfaces layer a generic on top, but `ctx.session` _is_
  typed as the contract — so `ctx.session.get<number>(k)` was a compile error while
  `ctx.flashed<T>(k)` on the same object was not. `<T>` defaults to `unknown`, so the
  read-then-narrow form is unchanged.

### Fixed

- **The memory lock driver refreshes on re-acquire.** `ManagedLock.acquire()` documents
  that re-acquiring while this instance already holds the key refreshes it. Redis honoured
  that with `EXPIRE` and SQLite with an `UPDATE`; the memory driver returned `true` for the
  same owner and never touched `expiresAt` — so the driver every app gets by default was
  the only one of the three that quietly refused. A caller re-acquiring to stay alive was
  told it had worked and then lost the lock on the original schedule.

- **`setAppEnv("dev")` resolves to `web`, not `console`.** Dev mode's process 1 boots the
  app purely to ask its providers what to run, and a provider is only asked if its
  `static environments` includes the environment it booted under. Falling through to
  `console` would have silently dropped every web-only provider — no error, no empty tab,
  just a process that never appears — and would have left `zt dev` and `serve --dev`
  disagreeing about what dev mode consists of.

- **A Flow app built its bundles three times on every `serve --dev`.** `APP_ENV` defaults to
  `"web"`, so the orchestrator process passed the view provider's web-runtime check and ran
  its "build once at startup" pass; the orchestrator then ran the same build hook itself;
  then it spawned a worker that booted the app and built a third time. Every backend save
  paid for two of them. View providers now skip their boot-time build when a
  `DevOrchestrator` owns builds — detected from `argv` for the orchestrator, since providers
  boot before `ServeCommand` can set an environment variable, and from `ZT_DEV` for the
  worker it supervises. A plain `serve` still builds at boot.

## [1.1.0] — 2026-08-08

### Fixed

- **`bun zt test` no longer fails a cold suite on Bun's 5-second hook timeout.** A `beforeAll` that calls `createTestApp()` boots providers and runs migrations, which exceeds 5s on a cold start; `bunfig.toml`'s `[test] timeout` does not cover hooks, only the CLI flag does. The failure appeared on the first run and not the second, which reads as flakiness and sends you looking for a race that is not there. The default is now 30s, still overridable with `--timeout`.
- **`serve --dev` no longer loses its server to a restart race.** The debounce timer spaced out the _scheduling_ of a restart, but its callback cleared the timer and then awaited a rebuild that can take seconds — so a change arriving in that window scheduled a second callback which ran concurrently. Both reached the spawn, two servers raced for the port, and the loser died with "Failed to start server. Is port 3000 in use?". Dev mode was then left owning no server while the winner kept serving stale code, so every later save appeared to do nothing. Restarts are now serialized: a request arriving mid-restart queues exactly one follow-up instead of running in parallel. A failed bind also retries briefly, since the OS releases a listening socket asynchronously after the previous owner exits, and the initial spawn uses the same path — an orphan from a previous run is the commonest reason the first bind fails. An unexpected exit is reported against the child that actually exited rather than whichever child the field happened to hold.

### Added

- `ctx.param(name, fallback?)` — the single-value route-parameter accessor, matching `string()` and `header()` in shape. Only the `params` record existed, though every other single-value read on the object is a method. Unlike `string()` it does not fall back to the query string: a route parameter either matched or it did not.
- `URLSigner` is exported from `@zerotal/core/security`. It carried a full documented example but was reachable only through a deep internal path, which is a worse dependency to take than reimplementing it. (`Url` / `url` were already exported — from the **http** subpath, not security; the docblock now says so.)
- `app.assets.loader` — per-extension bundler loader overrides, e.g. `{ ".woff2": "file" }`. Bun inlines small `url()` assets as data URIs, which is right for an icon and wrong for a font: the bytes move into the render-blocking stylesheet, so nine woff2 subsets turned a 36 KB stylesheet into 260 KB that had to download before first paint. There was no configuration to turn it off.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

### Added

- `@zerotal/core/storage` — file storage (local and S3-compatible disks) now
  ships inside core. Previously the separate `@zerotal/storage` package, which
  has been removed; import from `@zerotal/core/storage` instead. File writes are
  not an optional concern — the logger's own trail, uploads, and the media
  library all need one way to put bytes somewhere.
- `Storage.publicUrl(path, { disk, expiresIn })` — a URL the browser can fetch,
  with the kind chosen by the disk's own config: permanent for a served disk,
  signed and expiring for a `signed` one, and `DiskNotServedError` for a disk
  with no public URL. Handing back the stored path instead produced a _relative_
  `src` that the browser resolved against the embedding page.
- `Storage.isServed(disk?)` — branch a template without catching an error.
- A served disk's URL base defaults to its `serve.path`, so `url()` and the
  serving prefix cannot drift apart. An explicit `url` still wins, for a CDN.
- File serving. A disk that declares `serve` in `config/storage.ts` is exposed
  over HTTP by `StorageFilesMiddleware`; one without it has no URL at all. The
  default `public` disk is served at `/storage`, the default `local` disk is not.
  `serve.signed` requires a valid `temporaryUrl()` signature and answers a bad
  one with `404` rather than `403`.
- Private by default, with one public directory. Everything under the storage
  root is private except `storage/public/`; a local disk rooted outside it can
  only be served with `serve.signed`, and serving it openly throws
  `UnsafePublicMountError` at boot. The default `public` disk now lives at
  `storage/public` and is served at `/storage/public`, so the filesystem path
  and the URL are the same shape.
- The built-in disk roots derive from the storage root, so they follow
  `ZT_STORAGE_ROOT` instead of hardcoding `./storage`.
- The storage root. Every local disk must resolve inside `<project>/storage`
  (or `ZT_STORAGE_ROOT`); one rooted elsewhere throws
  `StorageRootEscapeError` at construction. The per-disk guard stops a path
  escaping its disk; this stops the disk escaping the project.
- `StorageDriver.stream?()` — an optional lazy handle, so serving a large file
  does not read it into memory first. Implemented by `LocalDriver` and
  `FakeDisk`; the middleware falls back to `getBuffer()` without it.
- `StorageDriver.append()` — appends to a file, creating it when absent.
  `LocalDriver` implements it natively; `S3Driver` throws
  `UnsupportedOperationError`, since an S3 object is immutable and emulating an
  append means rewriting the whole object.
- Logging now writes to two always-on sinks: the terminal, and a date-rotated
  file under `./storage/logs` kept for 14 days. Configure with `console` and
  `file` in `config/logging.ts`; either can be set to `false`. The file trail is
  off under `APP_ENV=test`.

- Named log channels are now _additional_ destinations rather than the sole one.
  An entry routed to a channel still reaches both sinks, except that a channel
  already covering a sink suppresses that baseline for its own entries.
- `LogManager` taps observe every entry, no longer filtered by the routed
  channel's level — so an observer sees what the application logged, not what
  one channel happened to accept.

### Fixed

- A facade returned from an `async` function no longer throws. The runtime reads
  `.then` to test for a thenable, and the proxy answered by resolving the
  container; `then`/`catch`/`finally` and the well-known symbols are now
  answered without a lookup.

## [1.0.0] — 2026-08-05

_First public release._

### Fixed

- **`Application.withWebSocket()` multiplexes handlers by path** instead of last-write-wins. Previously a single `_wsHandlers`/`_wsUpgradeData` slot meant a second registration silently clobbered the first, so an app using both flow (`/__flow/ws`) and broadcasting (`/app/ws`) only got one working endpoint. Registrations are now stored per-path (with an optional catch-all); each connection is tagged with its request path on upgrade and open/message/close route to the matching handler. `withWebSocket(handlers, upgradeData?, path?)` gained an optional `path`.

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
