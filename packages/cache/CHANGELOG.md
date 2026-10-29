# Changelog — @zerotal/cache

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Security

- **An idempotency key belongs to the caller who sent it and the endpoint it was sent to.**
  `IdempotencyMiddleware` named everything after the client's key alone. The stored response
  was replayed to anyone who sent the same key to any mutating endpoint, so two users, or two
  routes, could be handed each other's answers, and the in-flight table and the lock were
  shared process-wide, ignoring the cache's prefix, so two tenants with separate caches could
  still be handed each other's answer when their requests overlapped. One key is now built
  from a scope, the method, the host, the URL path, the query string and the client's key, and
  it names the stored response, the in-flight slot and the lock, so tenants on two subdomains
  of one app, or `?account=1` and `?account=2` on one path, never share an answer. The
  in-flight table is kept per `CacheManager` and the lock name includes the cache's prefix.
  The new `scope` option says whose key it is: `(ctx) => string | undefined`. By default it is
  the authenticated user, as `user:<type>:<id>` when a personal access token names the
  subject's type and `user:<id>` otherwise; else the session, but only one the client sent back
  in its cookie (`ctx.session.resumed()`); else none, so the middleware must run after the auth
  and session middleware. A session started for the request does not count, because a client
  that keeps no cookies is given a new one every time and its retries would never be replayed.
  Such requests stay unscoped, as do requests with no session at all. A handler can change the
  scope a retry arrives with: a registration, sign-in, sign-out or second-factor step changes
  the user or regenerates the session, and a browser's first request, unscoped, is sent the
  cookie of a session started for it. So when the handler runs, its answer is also stored
  under the scope read after it finishes: the user a changed session `user_id` names, with the
  session whose cookie the response carries, or that session alone if `user_id` was removed,
  whatever `ctx.user` still says; else the user on `ctx.user`, else that session. A retry with a
  new session's cookie that overlaps a cookieless first request in the same process waits for
  it. A request that was replayed or waited on another stores nothing, so replays never grow
  the cache; a cookieless client that is replayed and then retries with the cookie that replay
  set runs the handler again. A scoped request never falls back to the unscoped key, an answer
  is never copied to it, and a `scope` you pass is used as it is. Behind a proxy, every node
  must receive the client's `Host` header rather than its own address for the nodes to share a
  key. Responses stored before the upgrade are under the old names and are no longer replayed:
  a retry that straddles the upgrade runs its handler again. Registered with `app.use()`, the
  middleware runs before route middleware and never sees a user that a route's token
  middleware sets, so token-authenticated routes should list it after that middleware instead.

### Added

- **`CacheManager.prefix`: the prefix a manager puts in front of its keys.** Read-only. The
  idempotency middleware uses it to keep two caches' locks apart, and anything else that names
  a shared resource after a cache key can do the same.

## [1.15.5] — 2026-10-27

### Added

- **`Cache.increment()` and `Cache.decrement()`: a counter that several processes can share.**
  Adding to a number with `get()` and `set()` loses an update whenever two processes interleave,
  which for a spend ceiling or a rate counter is always an under-count. `increment(key, by = 1,
ttl?)` does the addition inside the driver (an upsert on SQLite, `INCRBYFLOAT` on Redis, one
  step in memory) and returns the new total. An absent, expired or non-numeric key counts as 0,
  and `ttl` applies when the call creates the entry, so a daily counter expires with its day.
  `CacheDriver.increment` is optional; a driver without it gets a read-then-write fallback.

### Fixed

- **The cache is available in the worker, so the scheduler's heartbeat reaches `zt doctor`.**
  `CacheProvider` was registered in web, console, test and repl but not in the worker, which is
  where the scheduler runs. Its heartbeat resolved no cache and did nothing, as a heartbeat
  should rather than take a worker down, and `zt doctor` reported a worker that was running
  every schedule as one that had never checked in: the failure the check exists to catch,
  raised about a healthy process. Code that uses `Cache` in a worker had no cache either. With a
  file-backed or Redis cache the heartbeat is shared with doctor; with the in-memory driver
  doctor still says it cannot verify, as before.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.5.0] — 2026-08-15

### Fixed

- **Stampede protection survives a compute slower than 30 seconds.** `remember()`'s
  recompute lock had a fixed 30s TTL and no way to extend it, so a factory that ran longer
  silently dropped its lock and let a second node in — and an expensive query is the only
  kind anyone bothers caching, so the protection failed precisely where it was needed. The
  lock now refreshes for as long as the factory runs. A lock lost anyway falls back to
  re-checking the cache and recomputing, which is what a timed-out waiter already did:
  caching is best-effort here, not a correctness boundary.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Added a typed error vocabulary (`CacheError`/`CacheSerializationError`/`CacheDeserializationError`, `E_CACHE_*` codes).
