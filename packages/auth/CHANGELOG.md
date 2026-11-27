# Changelog — @zerotal/auth

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- `@zerotal/auth` registers `UserModel` in core's `UserRegistry`, so `currentUser(ctx)` from
  `@zerotal/core/auth` returns the app's user model, typed, in packages that never import this
  one.

## [1.18.2] — 2026-11-26

### Changed

- **The two-factor examples check a code once.** The docblocks on `Auth.completeTwoFactor()`,
  the `TwoFactor` facade, `TwoFactorMiddleware` and `TwoFactorService` showed
  `verifyCode(secret, code)`, which accepts a code for its whole window. They now pass the
  user's last accepted time step to `verifyCodeWithCounter()` and save the step it returns.

## [1.18.1] — 2026-11-26

### Fixed

- **`make:policy` is one command.** This package registered its own copy, which the CLI never
  reached (core's is registered before any provider boots) and which had drifted from it; it is
  now core's, which writes `Policy<Model>` with owner checks.

## [1.17.0] — 2026-11-20

### Changed

- **BREAKING: `@simplewebauthn/server` and `reflect-metadata` are optional peers, no longer
  dependencies.** An app that uses passkeys installs them itself:
  `bun add @simplewebauthn/server reflect-metadata`. Every other app stops installing the
  library and everything it depends on. Without them `@zerotal/auth` loads and runs as before,
  and a passkey ceremony throws `OptionalPeerMissingError` (`E_OPTIONAL_PEER_MISSING`) whose
  message names that command. A binary built by `bun zt compile` embeds the library when it was
  installed at build time, and builds without it when it was not.
- **`PasskeyService` takes and returns Zerotal's own WebAuthn types**, so an app type-checks
  without the library installed. `registrationOptions()` returns
  `PasskeyRegistrationOptionsJSON`, `authenticationOptions()` returns
  `PasskeyAuthenticationOptionsJSON`, `verifyRegistration()` takes a
  `PasskeyRegistrationResponseJSON` and `verifyAuthentication()` a
  `PasskeyAuthenticationResponseJSON`. They describe the same JSON as the library's types, and a
  value of the library's types is accepted where they are expected, so a call site compiles
  unchanged. The options types leave out `attestationFormats`, which Zerotal never sends, and
  list only `credProps` under `extensions`. `PasskeyCredential.device_type` and `.transports`
  take the same values as before, typed `PasskeyDeviceType` and `PasskeyTransport`.
- **Registration lets the browser offer any kind of authenticator.** It asked for the device's
  own only (`authenticatorAttachment: "platform"`), so a USB or NFC security key, or a phone
  reached by QR code, could not be registered. An app that wants the old behaviour sets
  `authenticatorAttachment: "platform"` on `PasskeysOptions`.

### Added

- **`PasskeysOptions.authenticatorAttachment`**: `"platform"` asks registration for the device's
  own authenticator only, `"cross-platform"` for a roaming one only. Unset, the browser offers
  both.
- **`zt doctor` checks the WebAuthn library**, and so does the doctor pass in `zt deploy`. When a
  file in the app's source names `PasskeyService`, the check loads the library as a ceremony
  would, and fails with the install command when it is missing or does not load.
- **The WebAuthn types are exported**: `PasskeyRegistrationOptionsJSON`,
  `PasskeyRegistrationResponseJSON`, `PasskeyAuthenticationOptionsJSON`,
  `PasskeyAuthenticationResponseJSON`, `PasskeyTransport` and `PasskeyDeviceType`.

### Testing

- A test pins that `HashService` hashes argon2id at Bun's default cost. Bun 1.4 refuses an argon2
  memory cost under 8 KiB, where Bun 1.3 accepted one; `auth.algorithm` is the only hashing
  setting, so the cost is always Bun's own and both versions accept it.

## [1.16.4] — 2026-11-17

### Changed

- **`@simplewebauthn/server` is now `^14.1.0`** (was `^13.3.3`), and `PasskeyService` loads it
  on its first ceremony rather than when `@zerotal/auth` is imported. An app that never uses
  passkeys no longer loads it; it is still installed with every app. `PasskeyService`'s methods
  and option shapes are unchanged, and `PasskeyCredential.transports` takes the same values as
  before: 14.x dropped the type of that name, so Zerotal declares it.
- **`reflect-metadata` (`^0.2.2`) is declared as a dependency.** The WebAuthn library already
  installed it, so an install adds nothing. `PasskeyService` loads it before the library, because
  in a bundle Bun starts the library's modules before the polyfill they need, and a compiled app
  failed on its first ceremony without it.
- **Registration offers EdDSA, ES256 and RS256 on every runtime.** Left to its default, 14.x
  also offers ML-DSA-44 where WebCrypto supports it, which is Bun 1.4 and not Bun 1.3.14, so one
  app would accept different keys depending on where it was deployed. `registrationOptions` and
  `verifyRegistration` both name the three.

### Fixed

- **A misconfigured `rpId` or `origin` is thrown, not answered as `"passkey.invalid"`.** An
  `origin` ending in `/`, or a domain in non-ASCII letters rather than punycode, failed every
  ceremony while looking like a bad response from the browser. `verifyRegistration` and
  `verifyAuthentication` now rethrow the library's error, whose message names the fix. A
  response that fails verification is still `"passkey.invalid"`.

## [1.16.2] — 2026-10-30

### Fixed

- **`TokenIssued` can follow the token's insert.** `createToken` emitted the event while it built
  the row, before the caller could store it, so a listener that looked the token up (an audit
  trail, the monitor) found nothing, and a token whose insert then failed had still been
  announced. `createToken` takes an optional `store(row)`: it awaits it, then emits the event, and
  emits nothing when it throws. Without `store` nothing changes: the event is emitted as before,
  and the caller inserts the row.

## [1.16.0] — 2026-10-28

### Fixed

- **The sign-in lockout no longer reads a header the client writes.** When there was no socket
  address to read, `LoginRateLimiter` fell back to the leftmost `X-Forwarded-For` entry, so a
  client could give each guess a fresh counter. It uses the framework's one address rule now:
  the socket, or the client counted from the right when `app.throttle.trustedProxies` is set.

## [1.15.2] — 2026-10-23

### Changed

- **`@simplewebauthn/server` is now `^13.3.3`** (was `^13.1.0`). It is the library behind
  both ceremonies in `PasskeyService`. The range stays within 13.x, so nothing in Zerotal's
  own API moves; an install resolves to 13.3.3 or later.

## [1.9.0] — 2026-08-29

### Added

- **Passkeys are documented.** `PasskeyService` has shipped since 1.7.0 and had no page — a
  feature the framework leads on, that nobody could find. Both WebAuthn ceremonies are now
  written up with the store contract you supply, why `verifyAuthentication` returns
  `"passkey.invalid"` as a value rather than throwing, and the two configuration details that
  fail with an error naming neither: `rpId` is the bare domain, and `requireUserVerification`
  defaults to `true` because that is what makes a passkey a second factor rather than one.

- **Every middleware and broker options type is named**, plus the broker results, the JWT
  payload shapes and the auth events. The social config shapes are in
  [Social](/docs/social#types).

### Changed

- **INTERNAL: 25 exports are marked `@internal`** — the session-key constants, the mixin brand
  symbols and their type guards, the remember-token internals, the permission registry, and the
  request-guard plumbing. Still exported, still working; none is something an app calls, and
  freezing the session key names would have promised the shape of the session bag.

### Added

- **`doctor` check: auth columns.** `EmailVerification` and `Authenticatable` register their
  columns imperatively, and the boot concern adds them to a table that already exists. That
  makes "no migration needed" true for a model-first app and false for a migration-first one,
  where a `create users` that does not mention `email_verified_at` leaves every query
  touching it failing with `no such column` — all at once, in tests that have nothing to do
  with email, with nothing pointing at the mixin. The doctor runs as a console command, where
  the boot concern has not run, so what it sees is what a migration actually built.

- **A test for the sign-in flow as a pair.** `AuthMiddleware` writes `intended_url` and
  `redirect().intended()` consumes it. Both halves had tests and both passed, but both were
  written against a stubbed session whose `regenerate()` is a no-op — so neither could
  observe what happens between them, which is that login rotates the session ID before
  elevating privileges. The flow is now exercised end to end against a real `SessionManager`.

### Changed

- **`Auth.user()` documents that it throws for a guest.** The name does not telegraph it, and
  plenty of audited things happen with nobody signed in — a storefront checkout, a customer
  approving a change from a tokenised link, a webhook. On those routes an audit write that
  reaches for `Auth.user()` becomes a 401 on a public page, and the 401 is about the audit
  line rather than about the request.

## [1.7.0] — 2026-08-16

### Fixed

- **`FakeSocialDriver.userFromToken()` accepts the token it is given.** The override dropped
  the parameter, so a test swapping the fake in for a real driver could not call it the way
  production code does — `fake.userFromToken(accessToken)` was a compile error against a
  method that works perfectly at runtime. A fake has to be callable everywhere the thing it
  replaces is.

- **`SocialConfig()` accepts a partial driver block.** Every driver entry is
  `OAuth2Config & Record<string, unknown>`, and the parameter was a shallow `Partial`, so
  overriding one field of one provider demanded a complete entry for it. It now takes
  `DeepPartial`, which is what the underlying merge has always done.

## [1.5.0] — 2026-08-15

### Changed

- **`ctx.user` is typed as `UserModel`, the same interface `Auth.user()` returns.**
  It was `AuthUser` — the framework's base class — so an app that
  declaration-merges its own `User` got its columns from `Auth.user()` and lost
  them one line later on `ctx.user`, and the two could disagree about the same
  request's user. The user loader, the 2FA pending slot and the credential query
  all yield `UserModel` now, because the model being queried is the app's own
  registered user model: that is where the concrete type enters, and typing it as
  the base class threw the information away at the seam.

  `AuthUser` is unchanged and still the base class to extend. Apps that never
  declared their own `User` see `UserModel` resolve to it, so nothing that
  compiled before stops compiling.

## [1.4.0] — 2026-08-10

### Added

- `TwoFactor.getQrCodeSvg(label, secret, options?)` renders the enrolment QR code
  as an inline `<svg>`, so a setup page no longer has to find a QR renderer of its
  own. Options cover the issuer override, colours, pixel size, quiet zone, an
  accessible name and a `class`.

  This closes a hole the docs used to walk people into. `getQrCodeUrl()` returns
  a URI carrying the TOTP secret, and the only suggestion for drawing it was to
  hand that URI to a public QR image API — which posts the second factor's secret
  to a third party and leaves it in their logs. Serving it from a route of your
  own is not much better: it makes the secret requestable, proxy-loggable and
  browser-cacheable. The encoder is therefore built in (`encodeQr`, `qrSvg`, both
  exported for canvas or PNG rendering) and the secret never leaves the process.

  Byte mode, error-correction level M, versions 1–20 — up to 666 bytes, which
  covers an `otpauth://` URI even when a long percent-encoded issuer appears in
  it twice alongside a long email address. `maxPayloadBytes()` reports the
  ceiling; past it, `QrError` says to shorten the issuer or the label rather than
  emitting a truncated symbol.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
