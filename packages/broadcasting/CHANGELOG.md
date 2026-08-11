# Changelog — @zerotal/broadcasting

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **Tests for `currentSocketId`** — the one function deciding whether a broadcast
  excludes the connection that caused it. Both failure modes present as UI bugs
  rather than broadcasting ones: returning nothing when a header _was_ sent makes
  `toOthers()` exclude nobody, so the user who just made an optimistic update gets
  their own event back and double-applies it; returning something outside a request
  makes a queue job silently exclude an unrelated connection. Case-insensitive
  header matching is pinned too, since Echo sends `X-Socket-ID` and hand-rolled
  clients send it lowercase. 143 tests → 148.

- **`PendingBroadcast`, `RedisBroadcastDriver` and `PusherCompatManager` are
  documented.** The driver table now names the class behind each `driver` key, and
  the events guide explains why `broadcast(event)` needs no `.send()` — it returns a
  thenable that dispatches on the next microtask, which is what lets `.toOthers()`
  configure it first.

### Changed

- **Four exports are marked `@internal`** and leave the compatibility promise:
  `ChannelRegistry`, `channelRegistry`, `compileChannelPattern` and `broadcastOnce`
  — pattern plumbing and process-wide wiring, the last of which says in its own
  docblock that it is "exported for the hook". The promise is 20 exports, not 24.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Every promised export is documented, the package has six guide
  pages and the deepest behavioural coverage of its peer group, and its only
  dependency is `@zerotal/core`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Fixed

- **Presence: an explicit unsubscribe now removes the member and notifies the channel.** `_unsubscribe` only dropped the connection from the channel's subscriber set — it skipped the presence-member cleanup + `presence:member_removed` broadcast that a full disconnect (`handleClose`) performs. So a member who left via `Echo.leave` (a flow component teardown / SPA navigation, not a tab close) lingered in everyone else's "who's here" until they disconnected. Both leave paths now clean up identically.
- **The broadcasting WebSocket now coexists with flow's.** `BroadcastProvider` registers its WS handler at the configured `path` (default `/app/ws`; pusher stays catch-all for its dynamic `/app/{key}`), relying on core's new path-multiplexed `withWebSocket`. Before, flow's `/__flow/ws` registration clobbered the broadcasting one, so `/app/ws` never handled connections — real-time presence/private/shared channels silently didn't deliver in apps that also use flow.

### Changed

- Added a typed error vocabulary (`BroadcastError` + `E_BROADCAST_*` codes).
