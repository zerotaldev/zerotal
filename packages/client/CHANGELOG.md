# Changelog — @zerotal/client

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **The documented import could not be bundled for a browser.** `import { Socket } from
  "@zerotal/client"` — the line the broadcasting guide taught — failed with `Browser build cannot
  import() Bun builtin: "bun"`. The root entry also exports `ClientProvider`, which extends core's
  `ServiceProvider`, which reaches `CommandRunner`, which reaches the built-in CLI commands, one of
  which does `await import("bun")`. That is a *resolution*-time error, so tree-shaking never got the
  chance to drop the half nobody in a browser wanted: one server-only export made the whole package
  unusable in the environment it exists for.

  `@zerotal/client` now resolves to a browser-safe entry under the `browser` export condition —
  `Socket`, `ApiClient`, `CircuitBreaker`, `createApiClient` and their types, and none of the
  server-side exports. Bun and Node consumers still get the full barrel, `ClientProvider` included,
  so nothing about registering the package changes. `@zerotal/client/Socket` still works and is
  still the leanest import when `Socket` is all you need; `ClientProvider` also gained an explicit
  `./provider` subpath.

  Two supporting changes: `createApiClient` moved out of `index.ts` into its own module, because a
  browser entry re-exporting it from the barrel pulls the barrel back in — the first attempt at this
  fix did exactly that and bundled straight back into the same error. And the modules a browser can
  reach now import from narrow core subpaths (`@zerotal/core/errors`, `@zerotal/core/helpers`)
  rather than the root, because importing *anything at all* from core's root is enough to poison a
  browser bundle.

  Guarded by a test that runs `Bun.build` with `target: "browser"` — no unit test can see this,
  since every module imports fine under Bun — plus one that holds the browser entry in step with
  the barrel, since two entry points means two places to remember to add an export to.


## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Moved service provider to `src/provider/`.
- Provider now declares `static provides`/`environments`; config factory takes `Partial<>`.
