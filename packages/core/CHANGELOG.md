# Changelog — @zerotal/core

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

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

### Fixed

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
