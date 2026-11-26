# @zerotal/settings

> Per-tenant settings: typed defaults in code, overrides per tenant and per user, hidden but never deleted, audited, with an admin screen.

Declare each setting once in code, with its default and the levels allowed to override
it. Reads are typed and take the most specific value that applies — the user's override,
then the tenant's, then the app-wide one, then the default. Overrides are hidden rather
than deleted, every change is recorded by `@zerotal/audit` when it is installed, and the
admin panel gets a settings screen with nothing to write. **Beta** — the API is close to
final; read the changelog before upgrading. Reviewed by 1.20.0.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/settings
```

## Setup

```ts
// bootstrap/providers.ts
import { SettingsProvider } from "@zerotal/settings";

export default [
  // …DatabaseProvider, TenancyProvider, AuditProvider (optional)
  SettingsProvider,
];
```

The `zerotal_settings` table is created on boot. No migration.

## Usage

```ts
// app/settings.ts
import { defineSettings, setting } from "@zerotal/settings";

export const billing = defineSettings({
  "billing.invoicePrefix": setting.string({ default: "INV-", maxLength: 8 }),
  "billing.paymentTermsDays": setting.number({ default: 30, min: 0, max: 120, integer: true }),
  "billing.locale": setting.enum(["en", "fr"], {
    default: "en",
    scopes: ["global", "tenant", "user"],
  }),
});
```

```ts
const days = await billing.get("billing.paymentTermsDays"); // number, for the current tenant
await billing.set("billing.paymentTermsDays", 14); // this tenant's override
await billing.hide("billing.paymentTermsDays"); // stop applying it; the value is kept
await billing.unhide("billing.paymentTermsDays"); // and back
```

In a test:

```ts
import { SettingsFake } from "@zerotal/settings";

// Given the group, keys and values are checked against its definitions.
const settings = SettingsFake.install(billing, { "billing.paymentTermsDays": 7 });
// …
settings.restore();
```

## Public API

| Export                                          | What it is                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `defineSettings`, `setting`                     | Declare settings; the typed group every read and write goes through. |
| `SettingsManager`, `Settings`                   | The `settings` binding, and its facade for code that works by key.   |
| `SettingsProvider`, `SettingsConfig`            | Registration and configuration.                                      |
| `SettingsFake`                                  | Pin settings in a test; overrides in memory.                         |
| `DatabaseStore`, `MemoryStore`, `SettingsStore` | Where overrides live.                                                |
| `SettingsError` and subclasses                  | Unknown key, duplicate key, invalid value, level not allowed.        |

## Documentation

Full guide: [Settings](https://zerotal.dev/docs/settings).

## License

MIT
