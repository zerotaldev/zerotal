---
title: Package Development
description: Build a first-party @zerotal package that auto-discovers, merges config, and passes the linter like a native one.
---

# Package Development

Every first-party feature — ORM, auth, cache, mail, queues — is a package under
`packages/*`, and they all follow the same shape. That uniformity is what lets the
framework auto-discover providers, merge config, and wire conventions without any
per-package glue.

This page documents the patterns so your own packages feel like native ones, and
so the package linter passes. Scaffold a new package and you get the whole skeleton
for free:

```bash
# in your project root
bun zt make:package billing
```

## Anatomy of a package

A package is a small, conventional directory tree. The cache package is a good
reference:

```text
# packages/cache/
packages/cache/
├── package.json
└── src/
    ├── index.ts                 # public API barrel
    ├── config.ts                # CacheConfig() factory + CacheConfigShape
    ├── errors.ts                # typed errors extending ZerotalError
    ├── CacheManager.ts          # the implementation
    ├── provider/
    │   └── CacheProvider.ts     # the ServiceProvider (must live here)
    ├── facades/
    │   └── Cache.ts             # optional static facade
    ├── drivers/                 # implementation details
    └── commands/
        └── index.ts             # CLI commands barrel
```

Two locations are enforced by convention: **providers live at `src/provider/`**,
and **the config factory lives at `src/config.ts`**. The linter flags anything
else.

## package.json

```json
// packages/cache/package.json
{
  "name": "@zerotal/cache",
  "version": "0.0.1",
  "maturity": "stable",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./commands": "./src/commands/index.ts"
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun --format esm",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zerotal/core": "workspace:*"
  }
}
```

Required by the linter: `"type": "module"` and an `"exports"` (or `"main"`) entry.
Depend on other Zerotal packages with `workspace:*`. The `maturity` field
(`experimental` | `beta` | `stable`) declares the package's compatibility promise —
see [Support policy](/docs/support-policy#maturity-levels) for what each level
commits to, and state the same level in the package's README and CHANGELOG so it is
visible from npm. A package cannot be more mature than what it depends on. Subpath
exports like `./commands` keep CLI code out of the main bundle until it's needed.

## Dependencies

Everything in `dependencies` is installed into every app that installs your
package, so keep it short and justify each entry. In order of preference:

1. **No dependency.** Use what Bun and the web platform provide (`fetch`,
   `crypto.subtle`, `Bun.password`, `Bun.Image`), and write small helpers yourself.
   About fifty lines is a fair limit.
2. **A required dependency**, only when every app that installs your package needs
   it at runtime and writing it yourself would be unsafe or unreasonable.
3. **An optional peer**, for a feature only some apps use. The app installs it when
   it turns the feature on.
4. **Another Zerotal package:**
   - a dependency when you import it statically;
   - an optional peer when you only ever load it lazily.

   Either way it is declared. Only a service you resolve from the container needs
   no declaration.

A library that only runs in the browser is none of these: it ships inside a bundle
you build, as [Shipping a browser bundle](#shipping-a-browser-bundle) describes.

The framework's own required dependencies, and the reason for each, are listed in
the [Support Policy](/docs/support-policy#dependencies).

### Declaring an optional peer

An optional peer needs three entries in `package.json`:

- in `peerDependencies`, with a range that has an upper bound;
- in `peerDependenciesMeta`, marked optional;
- in `devDependencies`, so your own tests run against a version the peer range
  accepts.

```json
// packages/imaging/package.json
{
  "peerDependencies": { "sharp": "^0.35" },
  "peerDependenciesMeta": { "sharp": { "optional": true } },
  "devDependencies": { "sharp": "^0.35.5" }
}
```

### Loading an optional peer

Load it where the feature runs, with `import()`, and hand failures to
`optionalPeer()` from `@zerotal/core/runtime`:

```typescript
// packages/imaging/src/sharp.ts
import { optionalPeer } from "@zerotal/core/runtime";

/** The part of sharp this driver uses. */
interface SharpModule {
  default: (input: Uint8Array) => { metadata(): Promise<{ width?: number }> };
}

export async function loadSharp(): Promise<SharpModule> {
  return import("sharp" as string).catch(
    optionalPeer("sharp", {
      feature: 'config/imaging.ts driver: "sharp"',
      alternative: 'the built-in driver, driver: "bun"',
    }),
  );
}
```

Each part of that expression does a job:

- **The name is written in the `import()` itself.** `bun build --compile` embeds a
  package only when it can read the name there. A name held in a variable builds a
  binary without the package.
- **`.catch()` is attached to the `import()`.** The bundler builds an app that lacks
  the package only when it can see the failure handled at the import: a `.catch()`
  there, or a surrounding `try`. Passing `() => import("sharp")` to a helper
  instead stops every compiled app without `sharp` from building.
- **`as string` keeps TypeScript from looking the package up.** Your package ships
  TypeScript source, so an app's type-check reads this line too, and it would fail
  on a package the app never installed. Bun removes the `as string`, so the bundler
  still sees the name.

The import comes back untyped. Describe the part of the package you use with your
own interface, as `SharpModule` does above, and never `import type` from the peer:
an app without it fails its type-check on that line.

`optionalPeer(spec, hint)` returns the handler. Pass it the same name the
`import()` uses. The hint is an `OptionalPeerHint`:

| Field         | Required | Meaning                                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `feature`     | yes      | What the app asked for that needs the package, in the words the app used: a config value, a method, a driver. |
| `install`     | no       | The install command. Defaults to `bun add <package>`.                                                         |
| `alternative` | no       | What to do instead, when the feature has a built-in alternative.                                              |

When the package is not installed, the handler throws `OptionalPeerMissingError`.
It carries:

- the code `E_OPTIONAL_PEER_MISSING`;
- an `OptionalPeerMissing` record on `missing`: the package, the feature, the
  install command and the alternative;
- the resolver's original error as `cause`.

Every other failure is rethrown unchanged. That covers a peer that throws while
loading and an installed peer that is missing one of its own dependencies, so a
broken install is never reported as a missing one. The handler decides this from
the error's `code` and `specifier`, never from its message.

For a synchronous `require()`, call the handler from the `catch` block:

```typescript
import { optionalPeer } from "@zerotal/core/runtime";

export function loadCache(): unknown {
  try {
    return require("@zerotal/cache");
  } catch (error) {
    return optionalPeer("@zerotal/cache", { feature: "tenantCache()" })(error);
  }
}
```

Two more rules keep a missing peer visible:

- **When the app asked for the feature, never turn a missing package into `null`,
  `false` or a quiet fallback.** The feature cannot run, and the error is the
  only thing that tells the developer what to install.
- **Check at boot when the app's config turns the feature on.** Register a
  [doctor check](#registering-a-doctor-check), so the missing package is reported
  before the first request needs it.

### Shipping a browser bundle

A browser library your package puts on the page is not something the app should
install. Build the bundle when the package is packed, ship the output, and keep the
library a devDependency:

- **Build it in `prepack`.** `bun pm pack`, and so the release, runs a package's
  `prepack` script, so a `scripts/build-client.ts` that writes `dist/` puts a fresh
  build in every tarball. Add `dist` to `files`.
- **Leave the entry out of the tarball.** List the file the bundle is built from
  with a `!` in `files`. It is a build input, not code an app runs, and the
  dependency check only reads files that ship.
- **Load it through an index the bundler can follow.** `dist/assets.js` imports each
  bundle `with { type: "file" }`, and the package loads the index with a literal
  `import("../dist/assets.js" as string)` and a `.catch` on it. `bun build --compile`
  then embeds the files, and the paths the index returns read them inside the
  binary. A file read by a path you build yourself is not there in a compiled app.
- **Build from source in a checkout.** When the entry file exists, build it at boot
  rather than reading `dist/`, which may be older than the code beside it.
- **Serve it at a URL named after its content**, with
  `Cache-Control: max-age=31536000, immutable`: the URL changes exactly when the
  bytes do.

`@zerotal/flow` and `@zerotal/devtools` both work this way; `scripts/browser-bundles.ts`
writes the `dist/` both of them ship.

### Changing dependencies

A change to any dependency block goes in the package's CHANGELOG, in the same
pull request.

Moving a required dependency to an optional peer breaks every app that relied on
getting it for free. So it ships in a minor release, with:

- a **BREAKING** note;
- a section in the [Upgrade Guide](/docs/upgrade);
- a doctor check that names the missing package.

In this repository, `bun run deps:check` enforces these rules on every pull request.

## The public barrel

Everything a consumer should import is re-exported from `index.ts`. Keep
implementation files internal; export the manager, the provider, the config
factory and its shape type, any facade, and the typed error vocabulary.

```typescript fragment
// packages/cache/src/index.ts
export { CacheManager } from "./CacheManager.ts";
export { CacheProvider } from "./provider/CacheProvider.ts";
export { Cache } from "./facades/Cache.ts";

// Config factory + its shape
export { CacheConfig } from "./config.ts";
export type { CacheConfigShape } from "./config.ts";

// Typed error vocabulary
export * from "./errors.ts";
```

## The provider

The provider is the only thing the application boots. It binds your services into
the container and registers any commands. It must live at `src/provider/` and
declare both `static provides` and `static environments`.

```typescript fragment
// packages/cache/src/provider/CacheProvider.ts
import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { CacheManager } from "../CacheManager.ts";

// Make the binding token type-safe everywhere via declaration merging.
declare module "@zerotal/core" {
  interface ContainerBindings {
    cache: CacheManager;
  }
}

export class CacheProvider extends ServiceProvider {
  static override provides = ["cache"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "test", "repl"];

  override onRegister(): void {
    this.app.container.singleton("cache", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const driver = config.get<string>("cache.driver", "sqlite");
      return new CacheManager(/* … built from config … */);
    });
  }

  override async onBooted(): Promise<void> {
    // Pre-resolve so the facade (makeSync) works after boot.
    await this.app.container.make("cache");

    // Register CLI commands lazily — the import only runs when invoked.
    const runner = this.app.container.tryMake("commands");
    runner?.registerLazy("cache:clear", () =>
      import("../commands/CacheClearCommand.ts").then((m) => m.CacheClearCommand),
    );
  }
}
```

The hooks a provider typically uses, in lifecycle order:

- `onRegister` — container bindings (usually a lazy singleton).
- `onBooted` — pre-resolve the singleton so a facade works, and `registerLazy()`
  any CLI commands.

Key patterns:

- **`declare module "@zerotal/core"`** to add your token to `ContainerBindings`,
  so `container.make("cache")` is typed across the whole codebase.
- **`static provides`** lists the tokens you bind — required for the array form of
  `app.defer([CacheProvider])` and used by the linter.
- **`static environments`** filters out the provider in modes it shouldn't run in.
- **`static dependsOn`** declares other packages' providers yours needs at boot —
  e.g. `static dependsOn = [FlowProvider]`. They're pulled in and booted first
  automatically, so an app installing your package never has to know the ordering.
  See [Declaring dependencies](/docs/providers#declaring-dependencies).
- **Read config inside the factory**, not at module load, so overrides are applied
  and the binding stays lazy.
- **`registerLazy()`** for commands keeps cold-start cheap.

See [Service Providers](/docs/providers) for every lifecycle hook.

## The config factory

Each package exposes an `XConfig()` factory in `src/config.ts`: an `XConfigShape`
interface, a `defaults` object, and a factory that deep-merges user overrides onto
the defaults. The factory parameter must be `Partial<XConfigShape>`.

**All config factories must merge with [`deepMerge`](/docs/helpers#objects-deepmerge)** —
`return deepMerge(defaults, options)`. This is the one canonical merge strategy:
do not hand-roll per-field `??` defaulting or manual nested spreads, and do not
reach for `Object.assign`/`{ ...defaults, ...options }` (a shallow spread silently
drops sibling keys inside nested objects). A single `deepMerge` call guarantees a
user who overrides one deep key keeps every other default, returns a fresh object
that never aliases the shared `defaults`, and is safe against prototype pollution.

```typescript
// packages/cache/src/config.ts
import { deepMerge } from "@zerotal/core";

export interface CacheConfigShape {
  /** Which cache driver to use. Default: 'sqlite' */
  driver: "sqlite" | "redis" | "memory";
  /** Key prefix prepended to all cache keys. Default: 'zerotal:' */
  prefix: string;
  /** Default TTL in seconds. Default: 3600 */
  ttl: number;
  sqlite: { path: string };
}

const defaults: CacheConfigShape = {
  driver: "sqlite",
  prefix: "zerotal:",
  ttl: 3600,
  sqlite: { path: ":memory:" },
};

/**
 * @example
 * import { CacheConfig } from '@zerotal/cache';
 * export default CacheConfig({ driver: 'memory', ttl: 600 });
 */
export function CacheConfig(options: Partial<CacheConfigShape> = {}): CacheConfigShape {
  return deepMerge(defaults, options);
}
```

| Field         | Required | Default      | Description                                  |
| ------------- | -------- | ------------ | -------------------------------------------- |
| `driver`      | no       | `"sqlite"`   | Which cache driver backs the manager.        |
| `prefix`      | no       | `"zerotal:"` | Key prefix prepended to every cache key.     |
| `ttl`         | no       | `3600`       | Default time-to-live in seconds.             |
| `sqlite.path` | no       | `":memory:"` | SQLite file path; `:memory:` for in-process. |

Register the namespace for **typed config dot-paths** by augmenting `ConfigRegistry`
(the config analogue of `ContainerBindings`) at the bottom of `config.ts`:

```typescript fragment
// packages/cache/src/config.ts
declare module "@zerotal/core" {
  interface ConfigRegistry {
    cache: CacheConfigShape;
  }
}
```

That makes `config("cache.ttl")` resolve to `number` (and autocomplete) in any app
that imports your package. See
[Configuration → Typed dot-paths](/docs/config-system#typed-dot-paths).

Using [`deepMerge`](/docs/helpers#objects-deepmerge) means a user who overrides
`sqlite.path` keeps the default `driver`, `prefix`, and `ttl` — overrides are
specific, not wholesale. The app then writes a tiny `config/cache.ts`:

```typescript
// config/cache.ts
import { CacheConfig } from "@zerotal/cache";
export default CacheConfig({ driver: "memory" });
```

Document every option's default in the shape's JSDoc — that's what surfaces to
developers and what the docs render.

> **Warning** — Arrays replace, they don't merge. If an option is an array, a user
> setting it replaces your default array outright (no concat or de-dupe). Document
> that on the field, and prefer a name-keyed nested **object** (e.g. `stores`,
> `disks`) over an array whenever users should be able to add entries without
> losing the built-ins. See
> [Objects — `deepMerge()`](/docs/helpers#objects-deepmerge) for the full rule.

## Typed errors

Packages define their own error vocabulary, and every error **extends
`ZerotalError`** (never the native `Error`). This lets the exception handler render
them consistently and keeps HTTP status mapping in one place.

```typescript
// packages/cache/src/errors.ts
import { ZerotalError } from "@zerotal/core";

export class CacheConnectionError extends ZerotalError {
  constructor(driver: string) {
    super(`Cache driver '${driver}' failed to connect.`);
  }
}
```

For HTTP-facing errors, extend one of the built-in `HttpError` subclasses
(`NotFoundError`, `ConflictError`, …) so the right status is returned
automatically. See [Errors](/docs/errors) for the full hierarchy.

## Facades

A facade is a thin static proxy that resolves your binding from the container, so
consumers can write `Cache.get(key)` instead of `container.make("cache")`. Build
one with `createFacade()` — it infers its type from the binding token — and export
it from the barrel.

```typescript
// packages/cache/src/facades/Cache.ts
import { createFacade } from "@zerotal/core";

export const Cache = createFacade("cache");
```

```typescript fragment
function createFacade<K extends keyof ContainerBindings>(key: K): ContainerBindings[K];
```

Facades rely on the binding being pre-resolved, which is why providers call
`await container.make(token)` in `onBooted()`.

> **Warning** — Accessing a facade before `Application.boot()` finishes throws
> `FacadeAccessedBeforeBootError`. Never call one at module scope on import — only
> inside request handlers, commands, or other post-boot code.

## Macros

A macro adds a static method to a core class that your package doesn't own, so
consumers call `Router.flow(...)` as though it shipped with the router. Register
it in `onRegister()` — that runs before route files load, so the method exists by
the time an app calls it:

```typescript fragment
// packages/flow/src/FlowProvider.ts — inside onRegister():
Router.macro("flow", flowRoute);
```

The call is untyped on its own; augment the matching interface so consumers get
completion and type-checking:

```typescript fragment
// packages/flow/src/types.ts
declare module "@zerotal/core" {
  interface RouterMacros {
    flow(path: string, page: typeof Component, middleware?: MiddlewareClass[]): void;
  }
}
```

This is the mechanism behind `Router.flow()`, and `Str.macro()` follows the same
shape for string helpers. Reach for it only when the method genuinely belongs on
the core class — a plain export from your barrel is simpler and easier to trace.

## Contributing conventions

If your package introduces a new `app/*` directory that should auto-register at
boot (the way `app/models` and `app/policies` do), contribute a **concern
descriptor** from your provider's `onRegister()`. Core stays unaware of your
package — discovery is push-based.

```typescript fragment
// packages/webhooks/src/provider/WebhooksProvider.ts
import type { ConcernDescriptor } from "@zerotal/core";

export const webhooksConcern: ConcernDescriptor = {
  name: "webhooks",          // also the config key for path overrides
  order: 70,                  // lower runs first (models=10, observers=20, …)
  dir: "app/webhooks",        // scanned relative to the project root
  register(exports, ctx) {
    for (const exported of Object.values(exports)) {
      // …inspect and register each exported class…
    }
  },
};

// in your provider:
override onRegister(): void {
  this.app.registerConcern?.(webhooksConcern);
}
```

A descriptor with `dir` + `register` scans a directory and processes each module;
one with `run` fires a single hook after its files load (use it for one-shot setup
like auto-migration). Users can disable discovery or remap directories via
`config/app.ts` → `conventions`. See [Conventions](/docs/conventions) for the full
model.

> **Tip** — Optional-chain the call (`this.app.registerConcern?.(...)`) so unit
> tests that construct the provider with a minimal app stub don't need to implement
> it.

## Registering a dev process

If your package ships a companion process — a worker, a listener, a watcher —
declare it and `bun zt dev` runs it beside the server in its own tab. Otherwise
every user of your package has to remember a second terminal, and there is no way
for you to help them.

```typescript fragment
// packages/webhooks/src/provider/WebhooksProvider.ts
import type { DevProcessDefinition } from "@zerotal/core";

override devProcesses(): DevProcessDefinition[] {
  return [
    {
      name: "webhooks",                  // identity, and what --only / --without take
      command: ["stripe", "listen"],     // raw argv…
      enabled: () => this._configured(), // resolved once, at startup
      restart: "on-failure",             // or "always" / "never"
    },
  ];
}
```

`command` takes three forms, and the one you want is usually the first:

| Form                   | Runs                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `"queue:work"`         | A `zt` command, through the app's own entrypoint                        |
| `["stripe", "listen"]` | Raw argv, for a tool that is not a `zt` command                         |
| `() => [...]`          | The same, computed at startup from config you can only read once booted |

Use `run: async (signal) => …` instead of `command` for work with no separate
binary; the signal aborts on shutdown and on a restart. Set `after: "server"` for
a process that talks to the server, so it does not spend its restart budget
against a closed port before the server has bound.

Two things worth knowing:

- **`enabled` is resolved once, at startup.** A process cannot flicker in and out
  of the deck while dev mode is running, and one that throws while probing
  contributes nothing rather than failing dev mode for everyone else. Use it to
  keep a tab off screen when it would have nothing to do — the queue worker sits
  out under the `sync` driver for exactly this reason.
- **Your `name` is not private.** An app can replace your process by registering
  the same name, or drop it with `app.dev.disable`. That is deliberate: they know
  their setup better than you do.

See [Dev mode and the deck](/docs/commands#dev-mode-and-the-deck) for what the
user sees.

> **Your provider must be active in `web`.** Dev mode boots the app as `web` to
> ask providers what to run, so a provider whose `static environments` excludes
> it is never asked — and contributes nothing, silently.

## Registering a doctor check

`bun zt doctor` is what a developer (or an agent) runs to find out whether an app
is wired correctly. Contribute the checks only your package can make:

```typescript fragment
// packages/webhooks/src/provider/WebhooksProvider.ts
import type { DoctorCheck } from "@zerotal/core";

override doctorChecks(): DoctorCheck[] {
  return [
    {
      id: "webhooks-secret",
      label: "Webhooks",
      run: () => {
        const secret = this.app.container.makeSync("config").get("webhooks.secret");
        if (secret) return { status: "ok", message: "signing secret configured" };
        return {
          status: "warn",
          message: "no signing secret — every delivery will be rejected unverified.",
          fix: "Set WEBHOOKS_SECRET in .env.",
        };
      },
    },
  ];
}
```

Keep findings machine-readable, and put the resolution in `fix`. The intended
last step of an agent's task is `zt doctor`, and "looks fine to me" is not a
result it can act on. A check that throws is reported as that check failing,
never as the doctor failing.

`app.registerDoctorCheck()` does the same thing imperatively from `onRegister()`.
Prefer the method — it keeps your checks next to your other contributions.

## Tests

Every package must ship at least one `*.test.ts` file — the linter treats their
absence as a high-severity violation. Co-locate tests next to the code they cover
(`CacheManager.test.ts` beside `CacheManager.ts`) and run them with `bun test`.

```typescript fragment
// packages/cache/src/config.test.ts
import { test, expect } from "bun:test";
import { CacheConfig } from "./config.ts";

test("CacheConfig deep-merges overrides", () => {
  const cfg = CacheConfig({ sqlite: { path: "./cache.db" } });
  expect(cfg.driver).toBe("sqlite"); // default preserved
  expect(cfg.sqlite.path).toBe("./cache.db"); // override applied
});
```

## The package linter

`bun zt lint:packages` audits every package against the conventions on this
page and fails CI on violations. What it checks:

| Rule                               | Severity | Requirement                                                                                                                               |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-location`                | high     | Providers must live at `src/provider/`.                                                                                                   |
| `provider-provides`                | medium   | A provider that binds a token must declare `static provides`.                                                                             |
| `provider-environments`            | medium   | Every provider declares `static environments`.                                                                                            |
| `config-factory`                   | medium   | `src/config.ts` must export an `XConfig(...)` factory.                                                                                    |
| `config-casing`                    | high     | The factory name must be PascalCase.                                                                                                      |
| `config-partial`                   | high     | Its parameter must be `Partial<…Shape>`.                                                                                                  |
| `config-deepmerge`                 | medium   | The factory must merge with `deepMerge(defaults, options)`.                                                                               |
| `error-base`                       | medium   | Error classes extend `ZerotalError`, not `Error` (client-bundle code under `client/` is exempt — it defines its own native-`Error` base). |
| `tests`                            | high     | The package ships at least one `*.test.ts(x)`.                                                                                            |
| `package-json` / `esm` / `exports` | varies   | Valid `package.json`, `"type": "module"`, and `"exports"`/`"main"`.                                                                       |

Run it before opening a PR:

```bash
# in your project root
bun zt lint:packages
```

## Build checklist

1. `bun zt make:package <name>` to scaffold the skeleton.
2. Implement the service; keep internals out of the barrel.
3. Add the provider at `src/provider/`, with `provides` + `environments` and a
   `declare module` augmentation for its token.
4. Add `src/config.ts` with an `XConfig()` factory using `deepMerge`, documenting
   each default in JSDoc.
5. Make errors extend `ZerotalError`.
6. Keep `dependencies` to what every app needs; anything else is an optional peer
   loaded through `optionalPeer()`.
7. Contribute a concern descriptor if you introduce a new `app/*` directory.
8. Export everything public from `src/index.ts`.
9. Write tests.
10. `bun zt lint:packages` until clean.

## References

| Member                | Signature                                                                       | Description                                                           |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ServiceProvider`     | `abstract class ServiceProvider`                                                | Base class for providers; override lifecycle hooks like `onRegister`. |
| `static provides`     | `static provides: readonly string[]`                                            | Tokens the provider binds; used by `app.defer()` and the linter.      |
| `static environments` | `static environments: AppEnvironment[]`                                         | Environments the provider runs in (`web`, `console`, `test`, `repl`). |
| `static dependsOn`    | `static dependsOn: ProviderClass[]`                                             | Other providers this one needs — pulled in and booted first.          |
| `createFacade`        | `createFacade<K extends keyof ContainerBindings>(key: K): ContainerBindings[K]` | Build a lazy static facade over a container binding.                  |
| `deepMerge`           | `deepMerge<T extends object>(base: T, override: Partial<T>): T`                 | Canonical deep-merge for config factories.                            |
| `ZerotalError`        | `class ZerotalError extends Error`                                              | Base for all package error vocabularies.                              |
| `registerConcern`     | `registerConcern(descriptor: ConcernDescriptor): this`                          | Register an auto-discovery concern from a provider.                   |
| `optionalPeer`        | `optionalPeer(spec: string, hint: OptionalPeerHint): (error: unknown) => never` | The `.catch()` handler for loading an optional peer.                  |

## Next steps

- [Service Providers](/docs/providers) — provider lifecycle in depth.
- [Service Container](/docs/container) — bindings, singletons, and facades.
- [Conventions](/docs/conventions) — the auto-discovery system.
- [Configuration](/docs/config-system) — how config files are loaded and merged.
