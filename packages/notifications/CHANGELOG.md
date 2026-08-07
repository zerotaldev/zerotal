# Changelog — @zerotal/notifications

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`**

## [Unreleased]

### Fixed

- Queued notifications survive a persistent queue driver. `SendNotificationJob`
  serializes its notifiable and notification, and rebuilds both on the worker
  side; previously only the sync driver worked, and SQLite/Redis delivered a job
  whose recipient and notification were `undefined`.
- The SMTP driver honours `secure`. It opens a TLS connection for `secure: true`,
  upgrades via STARTTLS when a server offers it, and refuses to send credentials
  over an unencrypted connection unless `allowInsecureAuth` says otherwise.
- SMTP replies are parsed and their status codes checked, so a rejected
  recipient or failed authentication raises instead of reporting a successful
  send. The reader frames multi-line replies rather than assuming one per packet.
- Header values are stripped of CR/LF before being written, closing a header
  injection through a notification's subject or a display name. Non-ASCII header
  values are encoded per RFC 2047, and body lines beginning with `.` are
  dot-stuffed so a message is not truncated at its first such line.
- The database channel records the recipient's own class as `notifiable_type` and
  scopes every read by type and id together, so models sharing an id no longer
  share an inbox.
- A failing channel no longer cancels the others. Every declared channel is
  attempted and the failures are reported together as `NotificationDispatchError`.

### Added

- Custom channels via `NotificationManager.extend(name, factory)`, resolved
  lazily and able to replace a built-in.
- `channels(notifiable)` receives the recipient, so one notification can route
  per person's preferences, and `routeNotificationFor(channel)` lets a notifiable
  redirect an individual channel.
- `sendMany` / `queueMany` for many recipients, and `route()` for a destination
  with no model behind it.
- Mail attachments — `MailMessage.attach()`, `attachFile()`, and `embed()` for
  inline images — carried by the SMTP, Resend, and log drivers.
- `to*()` methods may return a promise, so building a message can do I/O.
- Inbox operations: paging on `all()`/`unread()`, `unreadCount()`,
  `markAsUnread()`, `delete()`, `clear()`, `recent()`, and `prune()`. The table
  gains indexes on the recipient lookups.
- `notifications:prune` and `notifications:test` console commands.
- An admin panel console showing recent deliveries, per-channel totals, and the
  stored inbox, gated on the `notifications.view` ability.
- Config validation at boot through `NotificationConfig()` /
  `validateNotificationConfig()`.
- `NotificationFake` gains `assertSentOn`, `assertQueued`, `assertSentTimes`,
  `sentTo`, an inert `database` accessor, and failure messages listing what was
  actually captured.

- `SlackMessage.webhookUrl` is optional; the URL resolves from the message, then
  the notifiable's route, then `slack.webhook` in config.
- `SmsMessage.to` is optional and defaults to the notifiable's `phone`.
- `BroadcastMessage.onQueue()` delivers through the queue. `onConnection()` is
  removed — the queue has no connection concept for it to name.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Added a typed error vocabulary (`NotificationError` + `E_NOTIFICATION_*` codes).
