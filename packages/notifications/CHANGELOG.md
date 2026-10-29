# Changelog — @zerotal/notifications

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Security

- **A mail address or display name with a line break in it is refused instead of sent, and a
  display name can no longer add a recipient.** `SmtpDriver` wrote each address into `MAIL FROM`
  and `RCPT TO` as given, so a CR or LF in a recipient, sender, cc or bcc address ended that
  command and put the rest of the address on the wire as further commands, inside a session the
  driver had already authenticated. Subjects and header values were already folded to one line;
  addresses were not, and folding cannot rescue one. `MailMessage` now checks each address as it
  is set and again when it builds the payload, which covers the notifiable's own `email` and a
  routed address, and `SmtpDriver.send` and `ResendDriver.send` check the sender, every recipient
  and the reply-to before they connect or call the API, since a payload can reach a driver without
  passing through `MailMessage`. An address
  holding a control character (NEL and the C1 range included), whitespace, `<`, `>`, `,` or `;`
  throws `InvalidMailAddressError`; the last two would turn one address into a list on Resend. So does one longer than the 254
  characters an SMTP path holds. The check is exported as `assertMailAddress()` for custom transports.
  A second `@` is still accepted, because a quoted local part may hold one. An address written
  with its display name, `"Ada Lovelace <ada@example.com>"` (the name optionally quoted), is
  still accepted everywhere an address is: it is split into `{ name, address }` before the
  address is checked; a name written that way may not hold `<`, `>` or a `"` of its own, and
  anything else with `<` or `>` in it is refused. Every display name is checked too, including
  an object's `name`, the notifiable's `name` and `mail.from.name`: one holding a control
  character or a Unicode line or paragraph separator is refused. The drivers wrote names unsafely
  as well: `ResendDriver` put the name bare into `"Name <addr>"`, so a profile name such as
  `x <spy@example.com>, y` became a second recipient, and `SmtpDriver` quoted it but stripped
  `"` without escaping `\`, so a trailing backslash escaped the closing quote. Both now write a
  printable ASCII name as a quoted string with `\` and `"` escaped, and any other name as RFC 2047
  encoded-words. `mail.from.address` may be bare or carry its name, and `NotificationConfig()`
  refuses at boot an address or a `mail.from.name` that every send would refuse, naming the key.
- **A CR on its own in a mail body is sent as a line break, never as a bare CR.** `SmtpDriver`
  turned a lone LF into CRLF but left a lone CR as it was, and a short ASCII body goes out as
  written, so the CR reached the DATA block on its own. Mail servers disagree about whether a lone
  CR ends a line, and dot-stuffing only looked for a period after an LF, so a period following one
  was not escaped: a server that reads a bare CR as a line ending could take the body to end there
  and read what followed as the next commands. Every line ending in a text or HTML part, lone CR,
  lone LF or CRLF, is now made CRLF before the encoding is chosen, so a lone CR is a line break in
  a 7bit part and in a quoted-printable one (where it was sent as `=0D` before), and dot-stuffing
  runs once over the finished message, after the line endings are final.

### Fixed

- **`SmtpDriver` folds long From, To, Cc and Reply-To headers instead of leaving a relay to cut
  them.** Each address header was written as one line: every recipient joined by `, `, a printable
  ASCII name as one quoted-string however long, and a non-ASCII name as encoded-words joined by
  spaces. A long profile name or a long recipient list passed RFC 5322's 998-octet line limit, and
  a relay cuts such a line wherever the limit falls, inside a name or an address. The headers are
  now folded: each recipient after the first starts a line of its own, a name's encoded-words are
  folded between, and every line keeps to 76 characters unless a single address is longer. A
  printable ASCII name longer than 64 characters (counting the escapes) is sent as encoded-words
  so that it can fold, and encoded-words carry 39 bytes each rather than 45, so that `Reply-To: `
  and one word stay within RFC 2047's 76 characters. Resend still receives each mailbox on one
  line, as `"Name" <address>`.

## [1.15.5] — 2026-10-27

### Added

- **A notification sets its own retry policy for the queue: `tries` and `backoff`.** A queued
  notification was always tried three times, a second apart, with no way to change it:
  `SendNotificationJob` took the queue's defaults and `Notification` had nowhere to say otherwise.
  A mail host restarting outlasts three seconds, so the notification went to the failed jobs, and
  an app that queued its mail subclassed the framework's own job to get minutes between attempts.
  `override tries = 8` and `override backoff = 5 * 60_000` on the notification now set the
  attempts and the milliseconds between them; they are read when it is queued and stored with the
  job, so the worker and `queue:retry` keep them. Unset, nothing changes. Closes #35.

## [1.15.2] — 2026-10-23

### Fixed

- **`SmtpDriver` transfer-encodes text and HTML parts.** They went on the wire raw,
  with no `Content-Transfer-Encoding`, so a body line over RFC 5322's 998-octet limit
  was cut by a relay wherever the limit fell — a single-line HTML email reached a
  customer reading "sup pliers" — and a non-ASCII body was sent as undeclared 8-bit
  on a connection that never negotiated `8BITMIME`. A part that is plain ASCII with
  lines of 78 characters or fewer is still sent as written, now declared `7bit`;
  anything else is quoted-printable, which keeps ASCII readable where base64 would
  not.

- **`DatabaseChannel` runs on Bun 1.4.4.** It built its query templates with an enumerable
  `raw`, which Bun 1.4.4 refuses. It uses the ORM's `_templateStrings()` now; see
  `@zerotal/orm`.

## [1.11.1] — 2026-08-31

### Added

- **`MailMessage.header()` and `MailPayload.headers`** — set a header the driver does
  not build itself. `MailPayload` had `to`/`from`/`subject`/`text`/`html`/`cc`/`bcc`/
  `replyTo`/`attachments` and no way to add one, so a team that wanted
  `List-Unsubscribe` had to patch a vendored copy of this package and settled for a
  footer link instead.

  That is not an equivalent substitute. Gmail and Yahoo draw their native unsubscribe
  control from the header, and a recipient who cannot find a control marks the message
  as spam instead — a judgement that attaches to the sending domain and degrades
  delivery of everything else it sends. Pair it with `List-Unsubscribe-Post` for the
  one-click form both providers now expect.

  Wired through all three drivers: SMTP writes them into the message, Resend sends
  them as the API's `headers` object, and the log driver prints them, since the reason
  to set one is that a client does something with it and the log driver is where that
  gets checked before anything is sent for real.

  Names the drivers build themselves are refused rather than sent twice — a second
  `Subject` is an ambiguous message, not an override — and the error names the
  `MailMessage` method to use instead. The list is exported as
  `RESERVED_MAIL_HEADERS`, with `resolveHeaders()` beside it for anyone writing a
  custom transport. Validation runs when the header is set, so the throw carries the
  stack of the code that wrote it rather than of a queue worker three hops away, and
  again in the driver, because a payload can reach one without passing through
  `MailMessage`. CR and LF in a value are folded to a space: left raw they end the
  header and let the remainder be read as further headers, which is how a `Bcc`
  arrives courtesy of whoever supplied a tracking ID.

## [1.11.0] — 2026-08-31

### Changed

- **The database channel is built on first use, not at construction.** Registering the
  provider used to open a `DatabaseChannel` against `database.table` — default
  `notifications` — and create that table, whether or not any notification ever routed
  there. An app that never uses the channel now never touches the table, and the
  manager no longer resolves a database connection while it is being constructed.

### Added

- **A doctor check for a `notifications` table that is not the framework's.**
  `notifications` is a very ordinary name for a table an app already owns, and one
  app's was a completely different shape — `household_id`, `title`, `body`,
  `action_url`, with an in-app inbox reading it. The only thing between the
  framework's channel and a wrong-shaped insert into that inbox was that no
  notification's `channels()` happened to return `"database"`. A convention holding
  back data corruption is a convention that will lose, so `zt doctor` now says so
  before the first notification does. Silent when the table does not exist yet, which
  is every fresh checkout.

## [1.10.0] — 2026-08-30

### Fixed

- **SMTP submission on port 587 works.** The STARTTLS upgrade completed its handshake
  and then sent nothing: `upgradeTLS()` returns the new socket while the handshake is
  still in flight, and a write issued in that window is **dropped** — not buffered,
  not an error, gone. The `EHLO` that has to follow STARTTLS went into that gap on
  every send, so the server waited for a command that never came while the client
  waited for a reply that never came, until the read timed out.

  Everything either side looked healthy, which is what made it expensive: the server
  logged a good TLS session and then a connection lost. Port 465 was unaffected,
  because implicit TLS finishes before `Bun.connect()` resolves and there is no window
  to write into — so mail worked on the port nobody documents, and configuring the 587
  that every provider _does_ document produced silence. No error, no bounce, no log
  line, and password resets that never arrived. `upgradeTLS()` now resolves only once
  the handshake has completed, bounded by the reply timeout.

- **TLS certificates are actually verified, on both transports.** `rejectUnauthorized`
  is not enforced by the runtime: Bun reports `authorized: true` for a self-signed
  certificate on `Bun.connect()` and on `upgradeTLS()` alike, whether the flag is set
  or not, and puts the real reason in `authorizationError` beside it. Trusting the
  flag made TLS decorative — the connection was encrypted, and would have accepted
  that encryption from anyone in the network path, which is the one property TLS
  exists to provide. The driver now reads the handshake result itself and fails
  closed; `rejectUnauthorized: false` still accepts a self-signed relay, deliberately.

- **The server greeting cannot be lost to a race.** `Bun.connect()` resolves after the
  socket opens, and the 220 can arrive before the `await` returns — the data callback
  reached for a connection object that did not exist yet. Early bytes are now buffered
  and replayed.

### Added

- **A doctor check for a production `mail.driver` of `"log"`.** It is the default, it
  is right in development, and it is the quietest possible production failure: every
  message is written to a log file, nothing reports a problem, and password resets
  stop arriving until someone asks why. `zt doctor` reports it and `zt deploy` refuses
  on it.

  Two tiers, because the same value means two things. An app with a real
  `mail.from.address` configured `log` by accident, or had it knocked back, and its
  mail is going nowhere — that fails. An app still on the placeholder address probably
  sends no mail at all, and failing its deploy over a setting it never touched would be
  the framework inventing a problem — that warns.

### Testing

- `SmtpSubmission.test.ts` runs the whole 587 flow against a real STARTTLS peer.
  The existing tests could not: they upgrade into a peer that is already speaking TLS,
  because Bun cannot be a STARTTLS _server_ — and the bug lived in the one step that
  arrangement skips. The fixture peer runs under Node, which can wrap a connected
  socket as a TLS server. The limitation was the harness's, never the client's.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.8.0] — 2026-08-24

### Fixed

- **No mail could be sent over port 587.** A STARTTLS upgrade hands back a new socket and
  leaves the old one attached, still firing its callbacks — and what the old one delivers from
  then on is the undecrypted TLS stream. Both sets of handlers appended to one reply buffer,
  so handshake records and ciphertext sat in the middle of the server's replies and no line
  matched a reply any more: the driver waited out its timeout without ever parsing the `250`,
  and the server logged a connection lost after STARTTLS. `close` and `error` were worse than
  `data` — the plaintext socket ending is a normal part of handing over to TLS, and it marked
  the live connection closed, rejecting whatever was waiting on the session that had just
  replaced it. Callbacks now capture the generation they were installed for and an upgrade
  bumps it, so anything from an older stream is ignored.

## [1.5.0] — 2026-08-15

### Added

- **Tests for `ResendDriver`.** Unlike SMTP, this driver's correctness is entirely
  the shape of one JSON request, and every way of getting it wrong is quiet in
  development — a stub answers 200 either way. Pinned: the bearer token and
  endpoint, `Name <addr>` formatting, optional keys omitted rather than sent empty
  (Resend rejects `cc: []`), `replyTo` mapped to the API's `reply_to` (sending the
  camelCase key is accepted and silently ignored, so replies would go to the
  sender), base64 encoding for both string and binary attachments, and
  `content_type` / `content_id` key names. Plus the half that matters most: a
  non-2xx raises, because a mail driver that swallows a 401 reports every send as
  delivered while nothing arrives. 173 tests → 185.

- **27 exports gained documentation** — the channel classes behind each channel
  name, the three mail drivers, the delivery events (`NotificationSent`,
  `MessageSent`, `MessageFailed`, `MessageQueued`), the full error table,
  `OnDemandNotifiable`, `RichLine`, and the `recentDeliveries()` / `channelStats()`
  counters the admin console renders. The broadcast wire event is now named as
  `BROADCAST_NOTIFICATION_EVENT` where its value was already documented.

### Changed

- **Five exports are marked `@internal`** — `SendNotificationJob`,
  `BroadcastNotificationJob`, `validateNotificationConfig` and the two command
  classes. Queue-serialisation plumbing and CLI wiring, none of it API: you queue
  through `notifyLater()` and run the commands through `bun zt`. The promise is 38
  exports, not 43.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Every promised export is documented and the transports are
  covered, including the HTTP driver whose failures are otherwise invisible.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

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
