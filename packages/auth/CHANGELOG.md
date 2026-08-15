# Changelog — @zerotal/auth

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
