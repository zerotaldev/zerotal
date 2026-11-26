# Changelog — @zerotal/settings

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`** — reviewed by 1.20.0.

## [Unreleased]

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
