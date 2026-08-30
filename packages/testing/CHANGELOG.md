# Changelog — @zerotal/testing

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Changed

- **`assertRedirect` compares the path exactly**, where it used to use `includes()`.
  The loose form made the assertion mean less than it looks like it means:
  `assertRedirect("/login")` was satisfied by `/login-as-someone-else` and by
  `/admin?next=/login` — the two cases a test about a login redirect exists to rule
  out. An absolute `Location` still matches a relative expectation, and naming a query
  string compares that too. `assertRedirectContains()` is the old behaviour, for the
  cases that want it (a signed URL with an unpredictable token).

### Documented

- **How to authenticate a test when identity is not a row.** `withSession()` already
  did it, and an app with no users table — an IMAP login _is_ the identity — reached
  past it to the session driver instead, guessing `driver.write()`. Reaching for the
  driver is the wrong layer and does not work; the doc now says so and shows the form
  that does.

## [1.10.0] — 2026-08-30

### Added

- **`res.assertInertiaRedirect(url)`** — the assertion that pins what actually breaks.
  A redirect with the right status and the right `Location` and no `X-Inertia: true`
  is ignored by the Inertia client: the request succeeds, the row is written, and the
  form sits there with its fields still filled in. `assertRedirect` checks the two
  headers that were never wrong, so an app can write three tests for this and have
  them pass whether or not its own workaround middleware is installed — which is how
  a workaround becomes permanent. This checks the redirect status (303 by default,
  because that is what a form submit must get), the `Location`, and the marker.

- **`@zerotal/testing/preload` warns when the runtime is below the project's
  `engines.bun`.** `startZerotal()` refuses on the same condition, which covers every
  `zt` command — but not `bun test` typed straight into a shell, and that is the case
  worth catching: the shell's Bun and the project's can differ, and the difference
  arrives as a handful of `Intl` assertions going red with nothing naming a binary.
  A parent-process check cannot see this; only an assertion from inside the process
  the tests run in can, which is what a preload is.

  A warning rather than a refusal, because a preload that throws takes down the whole
  run and a suite that is merely _suspect_ should still produce its results.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.5.0] — 2026-08-15

### Added

- **`FlowBrowser` — drive a real page against a real server, inside `bun test`.**
  `FlowTest` mounts a component and runs its server-side lifecycle; it never opens a
  socket, so it renders the full markup every time and every assertion passes. That is
  the problem: every silent failure Flow has shipped has one shape — the HTML is fine
  and the transport is dead — and no server-side test can see it by construction.

  `FlowBrowser.serve(bootstrap)` boots the app through `createTestApp` on an
  OS-assigned port, `visit(path)` opens a headless page, and the page can be read
  (`text`, `count`, `attribute`, `connection`), driven (`click`, `type`, `press`) and
  waited on. Lives behind `@zerotal/testing/browser` so the vast majority of tests
  never pay to find out whether a browser is present.

  **`waitForPatch()` is the primitive, and it is not a sleep.** The harness reads the
  WebSocket through the DevTools Protocol, so the received-frame count is captured when
  an action is dispatched and the wait is for it to rise. A harness whose assertions
  race the transport produces flaky tests, and a flaky browser suite gets deleted.

  `transport()` reports what the browser saw on the wire — sockets created, handshakes
  that answered `101`, every frame's payload — which the page cannot lie about. Assert
  that a `101` was **seen**, never that a status was not `403`: a refused upgrade does
  not arrive as a handshake response at all, so the negative form passes vacuously.

  **No new dependency.** `Bun.WebView` covers driving the page and reading the
  transport, so the argument for a browser-automation library is not made.

  Two limits, documented rather than discovered: the harness talks to the app's own
  origin, so it **cannot** catch a misconfigured `allowedOrigins` (`bun zt doctor --url`
  is the tool for that); and Bun cannot spawn Chrome on Windows today, so connect-mode
  via `ZT_BROWSER_CDP_URL` is a first-class path rather than a fallback.

### Fixed

- **`createTestApp()` no longer un-adopts the app it just adopted.** The shared-app
  path called `adoptAsCurrent()` and then `resetTestState()`, which calls
  `Application._resetInstance()` — precisely what the adoption existed to undo. The
  second test file in a process was handed an app whose scope had been torn down, and
  the first facade it touched threw `E_FACADE_BEFORE_BOOT`. What made it expensive is
  that each file passed _in isolation_, so the failure attached to whichever file
  happened to sort second and read as a bug in that file. Reset, then adopt — the same
  order the fresh-app path already used.

## [1.1.0] — 2026-08-08

### Fixed

- **Test files no longer tear the database out from under each other.** Bun runs a whole suite in one process and the ORM connection is process-global, so one file's `afterAll(() => app.close())` closed the connection every later file depended on — and the file that failed was a correct one that merely ran second, dying with "No database connection. Is DatabaseProvider registered?". `createTestApp()` now shares one app per process, keyed by the resolved `Application` (the scaffolded pattern passes a fresh arrow each time, so the callback identity is no key). `close()` on a shared app resets per-test state and leaves it running.

### Added

- `closeSharedTestApps()` — tears the shared app down explicitly, for a global teardown or a suite asserting no timers leak. Passing a `setup` callback still opts out of sharing, since routes cannot be registered twice against a running server.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
