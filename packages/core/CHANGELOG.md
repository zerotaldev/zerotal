# Changelog — @zerotal/core

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
