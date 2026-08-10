---
title: Release Notes
description: What changed in each tagged Zerotal release, and the steps needed to upgrade.
---

# Release Notes

Releases are recorded below, newest first. The `@zerotal/*` packages share a
single version line and follow [semantic versioning](/docs/upgrade#versioning).
Each package also keeps a detailed `CHANGELOG.md` of its own; this page is the
summary across the suite.

> **Tip** — For the mechanics of moving between versions — bumping packages, running migrations, and re-checking config — see the [Upgrade Guide](/docs/upgrade).

## How to read these notes

Each version lists changes under three headings:

- **Added** — new features and APIs (safe to adopt incrementally).
- **Changed** — behavior changes; **breaking** ones are called out explicitly and
  appear only in major releases.
- **Fixed** — bug fixes.

Patch and minor releases are backward compatible. Before taking a **major** release,
read its section here and apply each migration note.

## 1.4.0 — 2026-08-10

### Added

- **ORM: encrypted columns.** A column can hold ciphertext at rest and plaintext on the model,
  keyed by `APP_KEY` with AES-256-GCM — `@column("encrypted") idNumber?: string`, or
  `static encryptable = ["idNumber", "passportNumber"]` for several at once. Unlike `hashable`
  this is reversible and does not touch the instance, so the property still reads as plaintext
  after `save()`. `where()` on an encrypted column throws rather than matching nothing (a fresh
  IV per write means the ciphertext never repeats), and a value the key cannot open fails the
  read rather than arriving somewhere as ciphertext. See [Casts & Mutators](/docs/orm/casts).
- **Auth: `TwoFactor.getQrCodeSvg()`** renders the two-factor enrolment QR code as an inline
  `<svg>`, drawn in-process. The `otpauth://` URI carries the TOTP secret, so the previous advice
  — hand it to a QR image service — posted the second factor to a third party. `encodeQr()` and
  `qrSvg()` are exported for drawing the symbol yourself. See [Roles & 2FA](/docs/roles-and-2fa).
- **Flow: `preserveScroll`** on `<Link>` and `navigateCurrent()`, for a sort header, filter or tab
  strip partway down a page that should not jump to the top.

### Fixed

- **Flow: `flow:navigate` did not scroll.** The SPA swap replaced the page under a stationary
  viewport, so following a link from near the bottom of a long list landed you halfway down the
  next page — which reads as the page having failed to load. A navigation now goes to the top (or
  to the URL's fragment), and Back and Forward restore where you were.
- **Flow: `focusOnError` did nothing on a runtime-rendered page.** The JSX runtime rewrote the
  hyphen in `flow:focus-error` to a dot, so the attribute never matched the selector the client
  looks for. It worked on a compiled page and silently did not on one the compiler bailed out of.
  `sortGroupId` was affected the same way.
- **Docs: two column examples named the wrong TypeScript type.** `@column("date")` hydrates a
  native `Date`, not a `Carbon`, and `decimal:N` surfaces as a `string` — the ORM overview typed
  both the other way, which `tsc` cannot catch because the decorator does not constrain the
  property type.

## 1.3.0 — 2026-08-09

### Changed — BREAKING

- **Mixin composition is now a static on the base class.** `ComponentWith(...)` and
  `BaseModelWith(...)` are removed; write `Component.using(Pagination)` and
  `Model.using(Authenticatable, Roles)` instead. A codemod ships in the repository
  (`scripts/codemod-mixin-composition.ts`) that rewrites call sites and imports. How mixins are
  _authored_ is unchanged. `using` also composes onto intermediate bases
  (`AdminPage.using(Pagination)`) and chains (`.using(a).using(b)`), neither of which the old
  helpers could express.
- **`Model` is the canonical ORM base-class name.** `BaseModel` remains exported as an alias for
  the same class, so existing code keeps working; docs and scaffolding now say
  `class User extends Model`.

### Added

- **`@zerotal/media`** — attach files to models with `Model.using(Media)`: collections with
  acceptance rules and retention, image conversions on `Bun.Image` (or `sharp`), responsive
  `srcset()` ladders with inline placeholders, queued conversion jobs, `MediaFake` test
  assertions, and `media:clean` / `media:regenerate` commands. See [Media Library](/docs/media).

### Fixed

- **Flow: an `@expose`d action on a shared page base could vanish from the action allowlist**
  (and be fatally rejected at runtime) whenever a subclass declared a decorated field — a Bun
  1.3.x decorator defect, worked around in the framework. `@expose`, `@task`, `@renderless`,
  `@on` and `@computed` were all affected.

## 1.1.0 — 2026-08-08

### Changed

- `FlowTest.call()` rethrows action errors and `FlowTest.set()` re-renders, so tests fail on
  broken actions instead of passing silently. A handler pointing at an un-`@expose`d method is
  now a build error (fatal at boot in CSP-safe mode).
- `@column("text")` maps to a real `TEXT` type rather than `VARCHAR` — affects newly generated
  tables and migrations only.

### Fixed

- Radio-group binding, reactive sibling attributes suppressing `value` bindings, modifier click
  handlers, `request().ip()` inside actions, a data-corrupting `json` cast on numeric-looking
  strings, and an unparseable `make:model` stub.

## 1.0.4 — 2026-08-07

- Fixed the Flow starter rendering unstyled (stylesheet path mismatch) and its missing favicon.

## 1.0.3 — 2026-08-06

- Re-released so npm build provenance resolves against the renamed repository.

## 1.0.2 and earlier — 2026-08-06

- First published versions of Zerotal.

## Next steps

- [Upgrade Guide](/docs/upgrade) — apply the migration notes for a new release.
- [Contributing](/docs/contributing) — how changes land before they reach this list.
