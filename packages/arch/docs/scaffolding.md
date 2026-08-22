---
title: Scaffolding
description: Generate typed boilerplate files at conventional paths with the make:* commands instead of writing them by hand.
---

# Scaffolding

Zerotal's `make:*` commands generate boilerplate files so you spend time on logic,
not structure. Each generator writes a typed stub to the conventional path and
reports what it created.

```bash
# in your project root
bun zt make:<type> <Name> [flags]
```

Every generator is idempotent: if the target file already exists it reports
`File already exists: <path>` and writes nothing, so it never overwrites your work.

## Generators at a glance

| Command               | Creates                           | Notes                                      |
| --------------------- | --------------------------------- | ------------------------------------------ |
| `make:controller`     | `app/controllers/<Name>.ts`       | `--resource` adds CRUD stubs               |
| `make:middleware`     | `app/middleware/<Name>.ts`        | Pass-through `Pipe<HttpContext>` stub      |
| `make:command`        | `app/commands/<Name>.ts`          | CLI command extending `Command`            |
| `make:request`        | `app/requests/<Name>.ts`          | `FormRequest` with `rules()`               |
| `make:notification`   | `app/notifications/<Name>.ts`     | Extends `Notification`                     |
| `make:job`            | `app/jobs/<Name>.ts`              | Queue `Job`, self-registers                |
| `make:event`          | `app/events/<Name>.ts`            | `--broadcast` extends `BroadcastingEvent`  |
| `make:listener`       | `app/listeners/<Name>.ts`         | `handle(event)` method                     |
| `make:observer`       | `app/observers/<Name>.ts`         | `--model` sets the target model            |
| `make:policy`         | `app/policies/<Name>.ts`          | `--model` sets the target model            |
| `make:resource`       | `app/resources/<Name>.ts`         | API resource transformer                   |
| `make:admin-resource` | `app/admin/<Name>Resource.ts`     | Admin panel resource for a model           |
| `make:provider`       | `app/providers/<Name>Provider.ts` | Auto-registers in `bootstrap/providers.ts` |
| `make:package`        | `packages/<name>/…`               | Full `@zerotal/*` package skeleton         |

## make:controller

```bash
# in your project root
bun zt make:controller PostController
# Created: app/controllers/PostController.ts

bun zt make:controller PostController --resource
# Created: app/controllers/PostController.ts  (with index/show/store/update/destroy stubs)
```

The basic stub has a single `index` action; `--resource` adds the full CRUD set:
`index`, `show`, `store`, `update`, and `destroy`.

| Flag         | Type    | Description           |
| ------------ | ------- | --------------------- |
| `--resource` | boolean | Add CRUD action stubs |

## make:middleware

```bash
# in your project root
bun zt make:middleware RequireAdminMiddleware
# Created: app/middleware/RequireAdminMiddleware.ts
```

The stub implements `Pipe<HttpContext>` with a `handle(ctx, next)` method that calls
`next()`, plus a commented example of short-circuiting with a `Response`.

## make:command

```bash
# in your project root
bun zt make:command SendDailyReport
# Created: app/commands/SendDailyReport.ts
```

The stub includes `static commandName` (kebab-cased from the class name),
`static description`, `static needsApp`, placeholder `args` and `flags` arrays,
and an async `run()` method.

## make:request

Form requests centralise validation rules away from controller bodies.

```bash
# in your project root
bun zt make:request StorePostRequest
# Created: app/requests/StorePostRequest.ts
```

The stub extends `FormRequest` from `@zerotal/validator` with a `rules(r)` method
that returns a `Record<string, FieldRule>`.

## make:notification

```bash
# in your project root
bun zt make:notification OrderShipped
# Created: app/notifications/OrderShipped.ts
```

The stub extends `Notification` and ships with a `channels()` method (defaulting to
`['database']`) and a `toDatabase()` method.

## make:job

```bash
# in your project root
bun zt make:job ProcessPayment
# Created: app/jobs/ProcessPayment.ts
```

The stub extends `Job` from `@zerotal/queue`, sets a `default` queue, and calls
`JobRegistry.register(...)` at the bottom of the file so the job is dispatchable.

## make:event

```bash
# in your project root
bun zt make:event UserRegistered
# Created: app/events/UserRegistered.ts

bun zt make:event OrderShipped --broadcast
# Created: app/events/OrderShipped.ts  (extends BroadcastingEvent)
```

By default the stub is a plain class with constructor parameters commented as
examples. With `--broadcast` (`-b`) it instead extends `BroadcastingEvent` and
includes `broadcastOn()` and `broadcastWith()` methods.

| Flag          | Type    | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| `--broadcast` | boolean | Generate a broadcastable event (`-b` for short) |

> **Tip** — See [Broadcasting](/docs/broadcasting) for channels and authorization
> rules used by broadcastable events.

## make:listener

```bash
# in your project root
bun zt make:listener SendWelcomeEmail
# Created: app/listeners/SendWelcomeEmail.ts
```

The stub has a `handle(event: unknown)` method you narrow to the correct event type.

## make:observer

```bash
# in your project root
bun zt make:observer UserObserver
# Created: app/observers/UserObserver.ts

bun zt make:observer UserObserver --model User
# Same path; stub names its parameters after the model
```

The stub implements `ModelObserver` from `@zerotal/orm` with `creating`/`created`,
`updating`/`updated`, and `deleting`/`deleted` hooks. When `--model` is omitted the
model name is inferred by stripping the `Observer` suffix.

| Flag             | Type   | Description                       |
| ---------------- | ------ | --------------------------------- |
| `--model` (`-m`) | string | Model class this observer targets |

## make:policy

```bash
# in your project root
bun zt make:policy PostPolicy
# Created: app/policies/PostPolicy.ts

bun zt make:policy PostPolicy --model Post
# Same path; stub references Post in commented imports
```

The stub extends `Policy` from `@zerotal/auth` with `view`, `create`, `update`,
and `delete` methods. When `--model` is omitted the model name is inferred by
stripping the `Policy` suffix.

| Flag             | Type   | Description             |
| ---------------- | ------ | ----------------------- |
| `--model` (`-m`) | string | Model the policy is for |

## make:resource

API resource transformers shape model data before it leaves the controller.

```bash
# in your project root
bun zt make:resource UserResource
# Created: app/resources/UserResource.ts
```

The stub extends `Resource<Model>` with a `toArray()` method and includes commented
usage examples for single models and paginated `ResourceCollection`s.

## make:provider

```bash
# in your project root
bun zt make:provider Payment
# Created: app/providers/PaymentProvider.ts
# Registered in bootstrap/providers.ts

bun zt make:provider Payment --no-register
# Created: app/providers/PaymentProvider.ts  (no codemod)
```

The name is suffixed with `Provider` if it isn't already. The stub extends
`ServiceProvider` with `onRegister`, `onBooting`, and `onBooted` hooks ready to fill
in.

Unless `--no-register` is passed, a codemod appends the provider import and class
name to the default export array in `bootstrap/providers.ts`. It is idempotent:
rerunning reports `Already registered in bootstrap/providers.ts` rather than
duplicating the entry. If `bootstrap/providers.ts` is missing, it warns and leaves
the file for you to wire up manually.

| Flag            | Type    | Description                             |
| --------------- | ------- | --------------------------------------- |
| `--no-register` | boolean | Skip modifying `bootstrap/providers.ts` |

## make:package

Scaffolds a complete, conformant `@zerotal/<name>` package under `packages/`.

```bash
# in your project root
bun zt make:package billing
# Created @zerotal/billing
#   ./packages/billing/package.json
#   ./packages/billing/src/index.ts
#   ./packages/billing/src/config.ts
#   ./packages/billing/src/BillingManager.ts
#   ./packages/billing/src/provider/BillingProvider.ts
#   ./packages/billing/src/facades/Billing.ts
#   ./packages/billing/src/Billing.test.ts
```

The generated package follows the Zerotal package conventions: a manager class, a
service provider (with a container binding and config wiring), a facade, a
`XxxConfig()` factory, and a test file. The package name is normalised to a
kebab-case token, and class names are derived in PascalCase.

By default the package is written under `./packages`; pass a second argument to
choose a different base directory:

```bash
# in your project root
bun zt make:package billing ./vendor
```

After generation, register the new provider and verify the package passes the
structural checks:

```bash
# in your project root
bun zt make:provider Billing  # adds BillingProvider to bootstrap/providers.ts
bun zt lint:packages          # verify the package passes structural checks
```

> **Note** — See [Package Development](/docs/package-development) for the full
> package conventions the scaffold conforms to.

## Codemod helpers

The underlying codemod utilities are exported from `zerotal` for use in your
own generators, install scripts, or migration tools. Each is idempotent — a no-op
when the change is already present.

```ts fragment
// in your own generator or script
import {
  addImport,
  addToDefaultArrayExport,
  registerProvider,
  type RegisterProviderOptions,
  type RegisterResult,
} from "zerotal/build";

// Add an import after the last existing import (deduped):
const withImport = addImport(
  src,
  `import { BillingProvider } from "./providers/BillingProvider.ts";`,
);

// Append an identifier to the `export default [ ... ]` array literal:
const withEntry = addToDefaultArrayExport(src, "BillingProvider");

// Combined: add the import AND register in bootstrap/providers.ts on disk:
const result: RegisterResult = await registerProvider({
  className: "BillingProvider",
  importPath: "../app/providers/BillingProvider.ts",
  // bootstrapPath defaults to "bootstrap/providers.ts"
});
```

> **Note** — These live on the `zerotal/build` subpath rather than the
> root barrel: they are build-time tooling for generators, and an application
> never calls them at runtime.

> **Warning** — `registerProvider` reads and writes a file on disk. `addImport` and
> `addToDefaultArrayExport` are pure string transforms — they take source text and
> return the transformed text, leaving the file untouched.

## References

| Function                  | Signature                                                       | Description                                                              |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `addImport`               | `(source: string, importStatement: string) => string`           | Insert an import after the last existing import; no-op if already there. |
| `addToDefaultArrayExport` | `(source: string, identifier: string) => string`                | Append an identifier to an `export default [ … ]` array literal.         |
| `registerProvider`        | `(options: RegisterProviderOptions) => Promise<RegisterResult>` | Add the import and register a provider in the bootstrap file on disk.    |

`RegisterProviderOptions`:

| Field           | Required | Default                    | Description                                                                 |
| --------------- | -------- | -------------------------- | --------------------------------------------------------------------------- |
| `className`     | yes      | —                          | Provider class name to import and register.                                 |
| `importPath`    | yes      | —                          | Import specifier, e.g. `../app/providers/FooProvider.ts` or `@zerotal/foo`. |
| `bootstrapPath` | no       | `"bootstrap/providers.ts"` | Path to the bootstrap providers file.                                       |

`RegisterResult` is `'added' | 'exists' | 'missing'`:

| Value       | Meaning                                                     |
| ----------- | ----------------------------------------------------------- |
| `'added'`   | Provider was written and registered.                        |
| `'exists'`  | Already registered; no change made.                         |
| `'missing'` | `bootstrap/providers.ts` not found; nothing was registered. |

## Next steps

- [Commands](/docs/commands) — built-in commands and writing your own.
- [Service Providers](/docs/providers) — provider lifecycle and what to put in each hook.
- [Directory Structure](/docs/structure) — where generated files live.
