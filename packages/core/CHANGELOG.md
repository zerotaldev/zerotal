# Changelog — @zerotal/core

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.1.0] — 2026-08-08

### Added

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
