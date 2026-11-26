---
title: Settings
description: Per-tenant settings with typed defaults in code, overrides per tenant and per user, hidden but never deleted, audited, and a generated admin screen.
---

# Settings

`@zerotal/settings` is a settings registry for multi-tenant apps. Each setting is
declared once in code, with a typed default and the levels allowed to override it.
A tenant (a company) can override it, a user can override it within their tenant,
and the app can change it for everyone without a deploy. Reads are typed, overrides
are hidden rather than deleted, every change goes into the [audit trail](/docs/audit),
and the [admin panel](/docs/admin) gets a settings screen with nothing to write.

It is **beta**: the API is close to final, and a change to it is called out in the
changelog with migration steps. It is reviewed by 1.20.0.

## Getting Started

```bash
# in your project root
bun add @zerotal/settings
```

Register the provider after the database, and after tenancy and audit if you use them:

```typescript
// bootstrap/providers.ts
import { SettingsProvider } from "@zerotal/settings";

const providers = [
  // …DatabaseProvider, TenancyProvider, AuditProvider
  SettingsProvider,
];

export default providers;
```

The provider binds `settings` and creates the `zerotal_settings` table on boot when it
is missing, so there is no migration to write. It works on SQLite, PostgreSQL and MySQL.

## Declaring settings

Declare settings with `defineSettings()`, one entry per key, and export the group it
returns. Every read and write goes through that group, so only declared keys are
accepted and each read comes back as its declared type.

```typescript
// app/settings.ts
import { defineSettings, setting } from "@zerotal/settings";

export const billing = defineSettings({
  "billing.invoicePrefix": setting.string({
    default: "INV-",
    maxLength: 8,
    label: "Invoice prefix",
  }),
  "billing.paymentTermsDays": setting.number({ default: 30, min: 0, max: 120, integer: true }),
  "billing.locale": setting.enum(["en", "fr", "de"], {
    default: "en",
    scopes: ["global", "tenant", "user"],
  }),
  "billing.sendReminders": setting.boolean({ default: true }),
  "billing.reminderSchedule": setting.json<{ days: number[] }>({
    default: { days: [7, 14] },
    validate: (v) => (Array.isArray(v.days) ? undefined : "needs a list of days"),
  }),
});
```

| Builder                         | Value           | Checks                  |
| ------------------------------- | --------------- | ----------------------- |
| `setting.string(options)`       | `string`        | `maxLength`, `pattern`  |
| `setting.number(options)`       | `number`        | `min`, `max`, `integer` |
| `setting.boolean(options)`      | `boolean`       | none                    |
| `setting.enum(values, options)` | one of `values` | membership              |
| `setting.json<T>(options)`      | `T`             | your `validate`         |

Every builder also takes `label`, `description` and `group` for the settings screen,
`validate` for a check of your own (return a reason to refuse), and `scopes`. The
default has to pass its own checks: a definition whose default it would refuse throws
when the module loads.

A key belongs to one `defineSettings()` call. Declaring it again with a different
definition throws `DuplicateSettingError`, because two modules would otherwise read
different defaults for the same setting.

## Levels and how a read resolves

A setting can be overridden at three levels. `scopes` lists the ones it allows and
defaults to `["global", "tenant"]`.

| Level    | Overrides it for        | Stored as          |
| -------- | ----------------------- | ------------------ |
| `user`   | one user, in one tenant | `tenant:7:user:42` |
| `tenant` | one tenant (a company)  | `tenant:7`         |
| `global` | the whole app           | `global`           |

A read takes the most specific value that applies: the user's override, then the
tenant's, then the app-wide one, then the default in code.

```typescript fragment
const days = await billing.get("billing.paymentTermsDays"); // number
const everything = await billing.all(); // every key in the group, typed
```

The tenant comes from [`TenantContext`](/docs/tenancy), so inside a request the tenancy
middleware resolved, there is nothing to pass. The user comes from the signed-in
request. Name either one when there is no context, such as in a job, a command or a
script:

```typescript fragment
await billing.get("billing.locale", { tenant: invoice.tenantId, user: invoice.userId });
```

`explain()` returns the value along with where it came from and every stored level
that applies. Use it in a support tool or to debug a value:

```typescript fragment
const why = await billing.explain("billing.locale");
why.value; // "fr"
why.source; // "tenant" — or "user", "global", "default"
why.levels; // [{ kind: "tenant", value: "fr", hidden: false, updatedBy: "42", … }]
```

## Changing a setting

```typescript fragment
await billing.set("billing.paymentTermsDays", 14); // this tenant's override
await billing.set("billing.locale", "de", { at: "user" }); // the signed-in user's
await billing.set("billing.invoicePrefix", "ACME-", { tenant: 7 }); // a named tenant's
```

`set()` writes at the tenant's level inside a tenant and at the app-wide level outside
one. Pass `at` to choose a level. A user override is always asked for by name. A write
inside a tenant never becomes an app-wide one on its own: a setting that only allows
`global` throws `SettingScopeError` there, rather than letting a tenant change it for
everyone.

The value is checked against the definition before anything is stored. A value it
refuses throws `InvalidSettingValueError` and nothing is written. `setFromText()` takes
text from a form instead, such as `"42"` for a number, `"true"` for a boolean, or JSON.

## Hidden, never deleted

An override is never deleted. `hide()` stops it applying, so the next level shows
through, and keeps the value. `unhide()` puts it back.

```typescript fragment
await billing.hide("billing.paymentTermsDays"); // this tenant now gets the default again
await billing.unhide("billing.paymentTermsDays"); // and its own value back
```

There is no delete method on the group, on the manager or on the store. A hidden
override keeps its row, so its history still reads against something that exists, and
undoing a change is one call. Writing a new value at a hidden level makes it apply
again. Both `hide()` and `unhide()` resolve to `false` when there is no override at that
level.

A stored value that no longer fits its definition, for example after you narrowed `max`,
is skipped with a warning in the `settings` log channel. The reader gets the next level
instead of a value of the wrong type.

## Tenant isolation

A read matches stored overrides by their level's identity, which for a tenant is
`tenant:<id>`. There is no query that could return another tenant's row. One tenant
never sees another tenant's override through `get()`, `all()`, `explain()` or the
settings screen. A write, `hide()` or `unhide()` inside one tenant cannot touch
another tenant's. A user override belongs to the user _within a tenant_, so the same
user in a second tenant does not carry it over. The package's tests state each of
these as a negative, on every database it supports.

Naming a tenant (`{ tenant: 8 }`) is for code that runs outside every tenant: a
central admin console, a command, a job working through tenants. Inside a tenant,
naming a different one throws `SettingScopeError` for every read, write and `history()`
call, so a request in tenant 7 cannot reach tenant 8's settings by passing an id from
its input. For the same reason, `{ at: "global" }` throws inside a tenant: an app-wide
value changes every tenant, so it is set from outside them all.

## Audit trail

When [`AuditProvider`](/docs/audit) is registered, every `set()`, `hide()` and `unhide()`
is recorded, with no configuration. The events are `setting.updated`, `setting.hidden`
and `setting.unhidden`. Each entry records the old and new value, the acting user and
the request. Each setting has one trail per level, filed under `<key>@<level>`. Reading
a tenant's history is a lookup on its own trail:

```typescript fragment
const changes = await billing.history("billing.paymentTermsDays");
// [{ event: "setting.updated", from: 30, to: 14, actor: 42, at: "2026-11-26T…" }, …]
```

Settings resolves the audit service from the container and does not depend on
`@zerotal/audit`. Without the audit provider nothing is recorded and `history()` returns
an empty list. Set `audit: false` in `config/settings.ts` to stop recording even when
the audit provider is present.

## The settings screen

With [`@zerotal/admin`](/docs/admin) installed, the panel has a **Settings** screen,
generated from your definitions. Every declared setting is a row. It shows the
setting's label and group, its value at the level the panel is looking at, and where
that value came from. Inside a tenant that level is the tenant's; outside one it is
the app-wide level. Each row has three actions:

- **Change** opens a field filled with the current value. Booleans and enums get a
  select. The value is checked against the definition before it is saved.
- **Hide override** stops this level's override applying and keeps it.
- **Unhide** applies a hidden override again.

A **Hidden** tab lists the overrides that are kept but not applied. The screen requires
the `settings.manage` ability (exported as `SETTINGS_ABILITY`), checked on every
action. Set `plugins: { settings: false }` in `config/admin.ts` to leave it out.

Screens for other frontends call the same API the admin screen does. `Settings.all()`
returns every declared setting, resolved, and `Settings.definitions()` returns each
setting's type, options, label and group, enough to build a form. `Settings.setFromText()`,
`hide()` and `unhide()` do the writing. Four things the admin screen does that yours has
to do as well:

- **Read the level you edit.** With no scope, a read takes the signed-in user's own
  override first, so a tenant screen built on `Settings.all()` shows the admin's personal
  value and saves it for the whole tenant. Pass `{ user: null }`:
  `Settings.all({ user: null })`.
- **Decide where a write goes.** Outside a tenant, a write is app-wide and every tenant
  without its own override sees it. A tenant's screen should refuse to run without a
  tenant, and an app-wide one should be for people allowed to change everyone's settings.
- **Check the ability.** Guard the screen and every write with `settings.manage`
  (`SETTINGS_ABILITY`), as the admin screen does.
- **Turn a refusal into a field error.** A value that does not fit its definition throws
  `InvalidSettingValueError` (a `SettingsError`, status 422) with the reason in
  `error.context.reason`; catch it and show it under the field. A definition's `label` and
  `group` are `undefined` when not declared; the admin screen shows the key and the key's
  first segment in their place.

## Storage

`SettingsManager` is the service bound as `settings`, behind both the typed groups and
the `Settings` facade. It reads and writes through a `SettingsStore`. The provider gives
it a `DatabaseStore`, which uses the ORM's query builder on the app's connection, so it
runs on SQLite, PostgreSQL and MySQL alike. A `MemoryStore` holds overrides in process
memory with the same rules, and `SettingsFake` runs on one. A store has no delete
method. That is part of its contract, not something left out.

```typescript
import { MemoryStore, SettingsManager } from "@zerotal/settings";

const settings = new SettingsManager(new MemoryStore(), { audit: false });
```

## Testing

`SettingsFake` replaces the `settings` binding with one backed by memory. Tenant and
user overrides, hiding and validation all behave as they do in the app, with no table.
You can also pin a setting to a value for every reader:

```typescript fragment
import { SettingsFake } from "@zerotal/settings";

const settings = SettingsFake.install(billing, { "billing.paymentTermsDays": 7 });

expect(await billing.get("billing.paymentTermsDays")).toBe(7); // whatever is stored

settings.override("billing.sendReminders", false); // pin another
settings.release("billing.paymentTermsDays"); // resolve normally again
settings.stored(); // every override written through the fake, hidden ones included

settings.restore(); // in afterEach
```

A pinned value is checked against its definition, so a test cannot pin a value the app
could never hold. Given the group `defineSettings()` returned, the fake checks that at
compile time too: `override()`, `release()` and the overrides passed to `install()` take
only the group's keys, each with its declared type, the way the group's own `get()` and
`set()` do. Pass several groups as an array, `SettingsFake.install([billing, mail])`.
Given overrides alone, `install({ ... })` takes any key and rejects an unknown one when
the test runs.

## Configuration

```typescript
// config/settings.ts
import { SettingsConfig } from "@zerotal/settings";

export default SettingsConfig({
  table: "zerotal_settings",
  audit: true,
});
```

| Field   | Default              | Description                                                              |
| ------- | -------------------- | ------------------------------------------------------------------------ |
| `table` | `"zerotal_settings"` | The table overrides are stored in.                                       |
| `audit` | `true`               | Record changes through `@zerotal/audit` when its provider is registered. |

With tenancy's `multi-database` strategy, an override is stored in whichever database
the current connection points at. Inside a tenant boundary that is the tenant's own
database. App-wide overrides written outside a tenant are then not visible to reads
inside one. Use `single-database` tenancy, or keep to tenant and user levels, until
settings can name a connection of its own.

## References

### The group `defineSettings()` returns

| Method    | Signature                                           | Description                                           |
| --------- | --------------------------------------------------- | ----------------------------------------------------- |
| `get`     | `(key, scope?) => Promise<T>`                       | The value for the current (or named) tenant and user. |
| `all`     | `(scope?) => Promise<{ [key]: T }>`                 | Every setting in the group.                           |
| `explain` | `(key, scope?) => Promise<ResolvedSetting<T>>`      | The value, its source and every level.                |
| `set`     | `(key, value: T, options?) => Promise<void>`        | Override at one level.                                |
| `hide`    | `(key, options?) => Promise<boolean>`               | Stop an override applying; keep it.                   |
| `unhide`  | `(key, options?) => Promise<boolean>`               | Apply a hidden override again.                        |
| `history` | `(key, options?) => Promise<SettingHistoryEntry[]>` | The audit trail at one level, newest first.           |

`scope` is `{ tenant?, user? }`. A write's options add `at`: `"global"`, `"tenant"` or
`"user"`.

### Errors

| Error                      | Code                  | Raised when                                                            |
| -------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `SettingsError`            | `E_SETTINGS`          | Base class; also `E_SETTINGS_NOT_REGISTERED` before the provider.      |
| `UnknownSettingError`      | `E_SETTING_UNKNOWN`   | A key no `defineSettings()` declared.                                  |
| `DuplicateSettingError`    | `E_SETTING_DUPLICATE` | A key declared twice with different definitions.                       |
| `InvalidSettingValueError` | `E_SETTING_INVALID`   | A value the definition refuses.                                        |
| `SettingScopeError`        | `E_SETTING_SCOPE`     | A level the setting does not allow, or no tenant or user to write for. |

## Types

| Type                                                                                                                                      | What it is                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SettingsGroup`, `SettingDefinitions`, `SettingValue`, `SettingValues`                                                                    | The typed group and the types it reads off definitions.  |
| `SettingDefinition`, `SettingType`, `SettingScopeKind`                                                                                    | One declared setting, its kind of value, and its levels. |
| `StringSettingOptions`, `NumberSettingOptions`, `BooleanSettingOptions`, `EnumSettingOptions`, `JsonSettingOptions`, `BaseSettingOptions` | What each builder accepts.                               |
| `SettingsScope`, `SettingWriteOptions`, `SettingHistoryOptions`                                                                           | Who a call is for, and where a write goes.               |
| `ResolvedSetting`, `SettingLevel`, `SettingSource`, `SettingHistoryEntry`                                                                 | What `explain()` and `history()` return.                 |
| `SettingsStore`, `StoredSetting`                                                                                                          | The storage contract, and one stored override.           |
| `SettingsConfigShape`                                                                                                                     | The `settings` config namespace.                         |

## Next steps

- [Multi-tenancy](/docs/tenancy) — how the current tenant is resolved.
- [Audit logging](/docs/audit) — the trail setting changes are recorded in.
- [Admin](/docs/admin) — the panel the settings screen appears in.
