---
title: Configuration
description: Read deployment state, structure it in typed config files, and access it anywhere at runtime.
---

# Configuration

Zerotal separates three things: deployment state (`env()`), code-level structure (`config/*.ts`), and runtime access (`config()`). You only need all three when your config has genuine structure or conditional logic — simple apps can rely on `env()` alone.

## Mental model

Think of configuration as a pipeline from the environment to your code:

```
.env / process env        config/*.ts files            anywhere in the app
──────────────────        ─────────────────            ───────────────────
   env("PORT")     ─────►  AppConfig({ ... })   ─────►  config("app.port")
  (raw strings)            (typed structure)            (typed dot-path read)
```

- `env()` pulls a single value out of the environment, coercing it to the type of your fallback.
- A `config/<name>.ts` file assembles those values into a typed object via a package helper (`AppConfig`, `DatabaseConfig`, …).
- At boot, every `config/*.ts` file is loaded into the config store; `config()` reads from it by dot-path.

> **Tip** — Reach for the next layer only when you need it. A value used in exactly one place can stay an `env()` call; promote it to a config file when it gains structure, defaults, or conditional logic.

## The env helper

Read environment variables with optional type coercion and a fallback. The fallback's type decides how the raw string is coerced:

```typescript
// config/app.ts (or anywhere)
import { env } from "zerotal";

const port = env("PORT", 3000); // number fallback → coerced to number
const debug = env("APP_DEBUG", false); // boolean fallback → "true"/"1" become true
const appName = env("APP_NAME", "Zerotal App"); // string fallback
const apiKey = env("API_KEY"); // no fallback → string | undefined
```

`env()` reads `Bun.env` at call time. Use it in config files, providers, and anywhere you need deployment-time values.

> **Note** — When you need a value to be present, use `requireEnv("APP_KEY")` instead — it throws a `ConfigError` at boot if the variable is unset, rather than returning `undefined`.

### Declaring the whole environment — `EnvSchema`

`env()` is per-call and forgiving: an unset variable is `undefined` and you find out where it is
used. `@zerotal/core/env` is the other end — declare every variable the app reads, once, and the
boot either produces a fully typed frozen object or fails with every problem listed at the same
time:

```typescript fragment
// env.ts
import { EnvSchema, t } from "@zerotal/core/env";

export const env = EnvSchema.define({
  APP_KEY: t.string().min(32),
  PORT: t.port().default(3000),
  DATABASE_URL: t.string(),
  LOG_LEVEL: t.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: t.url().optional(),
});

env.PORT; // number — never undefined, because it has a default
env.LOG_LEVEL; // "debug" | "info" | "warn" | "error", narrowed to the literals
```

**It reports every failure at once.** A schema with three missing variables fails the boot
naming all three, rather than one per restart — which is the difference between one fix and
three round trips through a deploy. The failure is an `EnvSchemaError` carrying an
`EnvFieldError` per field.

| Type             | What it is                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| `EnvSchemaError` | The boot failure, listing every field that did not validate.                |
| `EnvFieldError`  | One field's problem: which variable, and what was wrong with it.            |
| `FieldType`      | The builders `t` offers — string, number, boolean, port, url, enum.         |
| `EnvOutput<S>`   | The typed object a schema produces. `typeof env` where you need to pass it. |
| `InferDef<D>`    | The type one field definition resolves to.                                  |

Use `env()` for a value read in one place and `EnvSchema` for the set an app cannot start
without. They coexist; the schema is not a replacement for the helper.

## Config files

Config files live in `config/`. Each file exports a typed object via a package helper:

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "zerotal";

export default DatabaseConfig({
  url: env("DATABASE_URL", "sqlite://./database.sqlite"),
});
```

```typescript
// config/session.ts
import { SessionConfig } from "@zerotal/session";
import { env } from "zerotal";

export default SessionConfig({
  driver: env("SESSION_DRIVER", "cookie") as "cookie" | "redis",
  secret: env("SESSION_SECRET", ""),
  lifetime: 86400,
  secure: env("APP_ENV") === "production",
});
```

Config helpers (`DatabaseConfig`, `SessionConfig`, etc.) are typed factory functions that give you autocomplete and catch typos. Some — like `AppConfig` — also fill in defaults for fields you omit.

## The config helper

Access any loaded config value at runtime:

```typescript
// in a provider, middleware, or controller
import { config } from "zerotal";

config("app.name"); // get — typed as string (see below)
config("app.name", "Zerotal"); // get with fallback — fallback must match the path's type
config.require("app.key"); // throws ConfigError if absent
config.set("app.debug", true); // override at runtime (useful in tests)
config.all(); // dump all loaded config as a flat record
```

Dot-notation maps to the config file path and the key within it. `config('database.url')` reads `url` from `config/database.ts`.

> **Note** — `config()` resolves against the booted application's config store. When no app is booted (some test or script contexts), use `config.safe("app.name", "fallback")`, which returns the fallback instead of throwing.

### Typed dot-paths

`config()` is type-aware. Each path resolves to the type declared in the owning package's `*ConfigShape`, with autocomplete on the path string:

```typescript fragment
// in application code
config("app.name"); // string
config("app.port"); // number
config("cache.ttl"); // number
config("app.throttle.maxAttempts"); // number — nested paths work too
config.set("app.debug", "yes"); // type error: expected boolean
```

This works exactly like the container's `ContainerBindings`: there's a `ConfigRegistry` interface that every config-owning package augments by namespace. Core registers `app` and `health`; each package registers its own next to its `*ConfigShape`:

```typescript fragment
// in a package's config registry declaration
declare module "zerotal" {
  interface ConfigRegistry {
    cache: CacheConfigShape;
  }
}
```

A namespace lights up as typed once its package is imported (which an app does by referencing its `XConfig` factory in `config/<namespace>.ts`). Paths outside any registered namespace still compile — they fall back to the untyped `config(path: string)` overload returning `unknown`, so dynamic access is never blocked.

## Which layer do I use?

| Layer         | What it does                             | Reach for it when                                                                              |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `env()`       | Reads deployment state (env vars)        | Credentials, URLs, driver names — anything that changes per environment                        |
| `config/*.ts` | Assembles code-level structure and logic | Multi-field configs, conditional logic, code references (class constructors, strategy objects) |
| `config()`    | Runtime access to loaded config          | In service providers, middleware, and application code that needs cross-cutting config values  |

The rule of thumb: read raw values with `env()`, shape and default them in a `config/*.ts` file, and read the shaped result anywhere with `config()`.

## How config loads at boot

Zerotal loads config **eagerly** when the application boots, before any provider registers:

- During `boot()`, the app auto-discovers and imports every `config/*.ts` file, taking each file's `default` export.
- Those exports are merged into the `ConfigManager` (bound in the container under the `"config"` key) before the provider `onRegister` → `onBooting` → `onBooted` phases run.
- A file that throws on import (for example, a missing required env var) is skipped during auto-discovery rather than crashing the whole boot.

Because every file is loaded as a normal module, a config file may `import` and read other modules at the top level — just avoid circular config imports between files.

> **Warning** — Auto-discovery silently skips a config file that throws while importing. If a namespace seems to be missing all its values, check that the file imports cleanly and that its required env vars are set.

## Overriding config in tests

```typescript fragment
// in a test setup file
import { config } from "zerotal";

beforeEach(() => {
  config.set("mail.driver", "log"); // force log driver in tests
  config.set("queue.driver", "sync");
});
```

> **Note** — `config.set()` overrides in-memory only. `.env` is never modified.

## Application-level config

Create `config/app.ts` for app-wide settings:

```typescript
// config/app.ts
import { env } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "Example",
  url: env("APP_URL", "http://localhost:3000"),
  key: env("APP_KEY", "changeme-in-production"),

  cors: {
    origin: env("CORS_ORIGIN", "*"),
    credentials: false,
  },

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },

  secureHeaders: {
    frameOptions: "SAMEORIGIN",
  },
});
```

`AppConfig()` fills in sensible defaults for everything you omit (`env`, `key`, `debug`, `url`, `port`, `locale`, `timezone`, `http3`, `health`, `cors`, `throttle`, `secureHeaders`, and the `conventions` auto-discovery settings). Read any value with `config('app.name')`, `config('app.cors.origin')`, etc. The auto-discovery settings live under the `conventions` key — see [Conventions](/docs/conventions).

## Loading config explicitly

The CLI entry (`zt.ts`) can load config **synchronously** at the top level and inject it into the app, so it's available before anything boots:

```typescript
// zt.ts
import { Application } from "zerotal";
import { configLoader } from "zerotal/config";

const config = configLoader("./config"); // sync — scans config/*.ts, safe at top level
config.validate(); // runs each file's optional validate() export

const app = Application.create({ config }); // …or app.useConfig(config)
```

`configLoader(dir)` returns a `ConfigLoader` with `all()`, `get("dot.path", fallback)`, `has(path)`, and `validate()`. A config file may export a named `validate(config)` function; `ConfigLoader.validate()` runs them all and throws on the first failure.

**One source of truth.** If config was passed to `Application.create({ config })`, a later `useConfig(...)` is **ignored** (create wins) — so the framework-managed `zt.ts`, which always calls `useConfig(...)`, never conflicts with an app that prefers to pass config to `create()`. When neither is used, the app auto-discovers `config/*.ts` at boot as described above.

## Environment files

Zerotal automatically loads `.env` in development. For production, set variables in your deployment platform.

> **Danger** — Never commit `.env` to version control. It holds real secrets. Commit `.env.example` with safe defaults instead.

```bash
# .env.example  (committed — safe defaults, no secrets)
APP_NAME=My App
APP_ENV=local
APP_KEY=
DATABASE_URL=sqlite://./database.sqlite
SESSION_SECRET=
```

```bash
# .env  (gitignored — real values)
APP_KEY=base64:abcdef...
DATABASE_URL=mysql://user:pass@localhost:3306/mydb
SESSION_SECRET=super-secret
```

Use `APP_ENV` to differentiate behaviour:

```typescript fragment
// in application code
if (config("app.env") === "production") {
  // production-only logic
}
```

## References

| Member                  | Signature                                                  | Description                                                                               |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `env`                   | `env(key: string, fallback?: string \| boolean \| number)` | Read an env var, coercing to the fallback's type; `string \| undefined` with no fallback. |
| `requireEnv`            | `requireEnv(key: string): string`                          | Read a required env var; throws `ConfigError` if unset.                                   |
| `config`                | `config(path: string, fallback?): value`                   | Read a config value by dot-path, optionally with a fallback.                              |
| `config.require`        | `config.require(path: string): value`                      | Read a config value; throws `ConfigError` if absent or null.                              |
| `config.set`            | `config.set(path: string, value): void`                    | Set a config value at runtime (in-memory only).                                           |
| `config.all`            | `config.all(): Record<string, unknown>`                    | Return all loaded config as a record.                                                     |
| `config.safe`           | `config.safe(path: string, fallback): value`               | Read without throwing when no app is booted; returns the fallback.                        |
| `AppConfig`             | `AppConfig(options): AppConfigShape`                       | Build the `app` namespace config, filling defaults for omitted fields.                    |
| `configLoader`          | `configLoader(dir = "./config"): ConfigLoader`             | Synchronously load a `config/` directory into a `ConfigLoader`.                           |
| `ConfigLoader.get`      | `get(key: string, fallback?): value`                       | Dot-path read against the loaded map.                                                     |
| `ConfigLoader.validate` | `validate(): this`                                         | Run each file's optional `validate(config)` export, throwing on failure.                  |

## Types

| Type                | What it is                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `ConfigValidator`   | What `registerConfigValidator` takes — a function handed the config, reporting issues. |
| `ConfigIssue`       | One finding: its namespace, message, and level.                                        |
| `ConfigIssueLevel`  | Whether an issue refuses a production boot or is only worth reading.                   |
| `ConventionsConfig` | The `conventions` namespace — where the framework looks for models, jobs and the rest. |
| `AppTlsConfig`      | TLS settings under `app.tls`.                                                          |
| `AssetLoaderKind`   | How an asset is loaded by the build — the `loader` values `assets.loaders` accepts.    |

A validator reporting a **fatal** issue refuses a production-like boot rather than warning. That
is the whole point of the level: an app that boots with a broken configuration serves wrong
answers rather than failing, and the failure is the cheaper outcome.

## Next steps

- [Conventions](/docs/conventions) — the auto-discovery settings under the `conventions` key.
- [Providers](/docs/providers) — where `config()` is most often read.
- [Application](/docs/application) — how config is injected and loaded at boot.
- [Deployment](/docs/deployment) — setting env vars in production.
