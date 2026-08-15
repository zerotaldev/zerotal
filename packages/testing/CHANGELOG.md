# Changelog — @zerotal/testing

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
