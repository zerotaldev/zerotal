# Changelog — @zerotal/settings

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`** — reviewed by 1.20.0.

## [Unreleased]

## [1.18.1] — 2026-11-26

### Fixed

- **A `validate` check that throws refuses the value.** A check written for the declared shape
  can throw on another one: `setFromText()` on a JSON setting parses `"null"` to `null`, and the
  documented `(v) => (Array.isArray(v.days) ? …)` then threw a `TypeError`, a 500 from the
  settings screen. It is an `InvalidSettingValueError` (422) now, its reason naming the check's
  message.
- **A settings group works in a running app.** `SettingsProvider` bound `settings` lazily and
  never resolved it, and the typed groups and the `Settings` facade read the binding with
  `makeSync`, which refuses a singleton nothing has resolved. So with the provider registered,
  every `billing.get(…)` in a request threw "Settings are not available: register
  SettingsProvider". `SettingsFake` and the provider's tests used other paths and passed. The
  provider resolves the manager while booting now.

### Added

- **`SettingsFake` checks keys and values at compile time when given the group.**
  `SettingsFake.install(billing, { "billing.paymentTermsDays": 7 })` takes only the keys
  `billing` declares, each with its declared type, in the overrides and in every later
  `override()` and `release()` — the way the group's own `get()` and `set()` do. Pass several
  groups as an array. `SettingsFake.install({ … })` without a group still takes any key and
  rejects an unknown one when the test runs.

## [1.18.0] — 2026-11-26

### Added

- **`@zerotal/settings`, a per-tenant settings registry.** Declare settings in code with a typed
  default each — `defineSettings({ "billing.paymentTermsDays": setting.number({ default: 30 }) })`
  — and read them typed: `await billing.get("billing.paymentTermsDays")` is a `number`. A read
  takes the user's override, then the tenant's, then the app-wide one, then the default; the
  tenant comes from `TenantContext` and the user from the signed-in request unless the call
  names them. Each definition says which of those levels may override it.
- **Hidden, never deleted.** `hide()` stops an override applying and keeps its value;
  `unhide()` puts it back. There is no delete on the manager, the typed group or the store.
- **Every change audited** through `@zerotal/audit` when `AuditProvider` is registered, one
  trail per setting per level, so `history()` for one tenant never returns another's.
- **A generated settings screen in the admin panel**: every declared setting with its value
  and where it came from, with Change, Hide override and Unhide, gated on `settings.manage`.
- **`SettingsFake`** pins a setting for a test and runs overrides in memory with no table.
- **Runs on SQLite, PostgreSQL and MySQL**; the `zerotal_settings` table is created on boot.
