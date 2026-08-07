# Changelog — @zerotal/broadcasting

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`**

## [Unreleased]

## [1.0.0] — 2026-08-05

_First public release._

### Fixed

- **Presence: an explicit unsubscribe now removes the member and notifies the channel.** `_unsubscribe` only dropped the connection from the channel's subscriber set — it skipped the presence-member cleanup + `presence:member_removed` broadcast that a full disconnect (`handleClose`) performs. So a member who left via `Echo.leave` (a flow component teardown / SPA navigation, not a tab close) lingered in everyone else's "who's here" until they disconnected. Both leave paths now clean up identically.
- **The broadcasting WebSocket now coexists with flow's.** `BroadcastProvider` registers its WS handler at the configured `path` (default `/app/ws`; pusher stays catch-all for its dynamic `/app/{key}`), relying on core's new path-multiplexed `withWebSocket`. Before, flow's `/__flow/ws` registration clobbered the broadcasting one, so `/app/ws` never handled connections — real-time presence/private/shared channels silently didn't deliver in apps that also use flow.

### Changed

- Added a typed error vocabulary (`BroadcastError` + `E_BROADCAST_*` codes).
