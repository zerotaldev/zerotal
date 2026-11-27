---
title: Scaffolding
description: Generate typed boilerplate files at conventional paths with the make:* commands instead of writing them by hand.
---

# Scaffolding

Zerotal's `make:*` commands generate boilerplate files so you spend time on logic,
not structure. Each generator writes a typed stub to the conventional path, reports
what it created, and says what to do with it next.

```bash
# in your project root
bun zt make:<type> <Name> [flags]
```

## What every generator does

The generators in `zerotal` share one base, so they behave the same way:

- **It never overwrites your work unless asked.** If the target file exists it reports
  `File already exists: <path>`, writes nothing and exits 1. `--force` overwrites it.
- **`--dry-run` writes nothing.** It prints each file the generator would write, with its
  contents, so you can read the stub before it lands. A dry run that would be refused exits 1
  too, and side effects (registering a provider, regenerating the page registry) are reported,
  not made.
- **The name is checked first.** A class name is letters, digits and `_`, not starting with a
  digit; `make:test` takes a file name (`posts`, `post-test`); `make:flow` and `make:page`
  take names separated by `/` (`Users/Index`, `tasks/index`). Anything else, `../x` included,
  is refused with exit code 1 before anything is read or written.
- **It says what comes next.** After `Created:`, a `Next:` block says where to register the
  file, or that nothing needs registering, and how to run or test it.
- **A refusal is a failure.** Every refusal exits 1, so a script can tell "created" from
  "refused": `bun zt make:controller PostController || exit 1`.
- **An option it does not take is refused**, naming the nearest one it does (see
  [Commands](/docs/commands#options-a-command-does-not-take)).

```bash
# in your project root
bun zt make:controller PostController --dry-run   # print it, write nothing
bun zt make:controller PostController --force     # replace the one that is there
```

```text
Created: app/controllers/PostController.ts
Next:
  Route to it in routes/web.ts: Router.get("/posts", PostController, "index");
  Then cover it with a test: bun zt make:test posts
```

The generators from other packages (`make:model`, `make:migration`, `make:factory`,
`make:seeder`, `make:admin-resource`, `make:channel`) keep their own options; `make:flow` and
`make:page` share the base.

A generated file passes your app's own checks as it is written. It imports the framework
the way your app does: through the `zerotal` bundle (`zerotal/orm`, `zerotal/auth`) when
`package.json` declares it, as every starter does, and by the scoped name (`@zerotal/orm`)
when it declares the packages instead. When the app declares Prettier, the file is
formatted with it, under the app's own config and ignore file, so `bun run format:check`
passes; without Prettier, the stubs are already in the starters' style.

## Generators at a glance

| Command               | Creates                               | Notes                                                           |
| --------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `make:controller`     | `app/controllers/<Name>.ts`           | `--resource` adds CRUD stubs                                    |
| `make:test`           | `tests/<name>.test.ts`                | Feature test; `--unit` for one with no app                      |
| `make:middleware`     | `app/middleware/<Name>.ts`            | Pass-through `Pipe<HttpContext>` stub                           |
| `make:command`        | `app/commands/<Name>.ts`              | CLI command extending `Command`                                 |
| `make:request`        | `app/requests/<Name>.ts`              | `FormRequest` with `rules()`                                    |
| `make:notification`   | `app/notifications/<Name>.ts`         | Extends `Notification`                                          |
| `make:job`            | `app/jobs/<Name>.ts`                  | Queue `Job`, self-registers                                     |
| `make:schedule`       | `app/schedules/<Name>.ts`             | `Schedule` subclass, discovered at boot                         |
| `make:event`          | `app/events/<Name>.ts`                | `--broadcast` extends `BroadcastingEvent`                       |
| `make:listener`       | `app/listeners/<Name>.ts`             | `handle(event)` method                                          |
| `make:observer`       | `app/observers/<Name>.ts`             | `--model` sets the target model                                 |
| `make:policy`         | `app/policies/<Name>.ts`              | `--model` sets the target model                                 |
| `make:resource`       | `app/resources/<Name>.ts`             | API resource transformer; `--model` writes an Inertia screen    |
| `make:route`          | `app/routes/<path>.ts`                | Inertia apps: a file route and the page it renders              |
| `make:page`           | `resources/js/pages/<name>.tsx`       | Inertia apps: a page component (`.vue` in a Vue app)            |
| `make:admin-resource` | `app/admin/<Name>Resource.ts`         | Admin panel resource for a model                                |
| `make:provider`       | `app/providers/<Name>Provider.ts`     | Auto-registers in `bootstrap/providers.ts`                      |
| `make:package`        | `packages/<name>/…`                   | Full `@zerotal/*` package skeleton                              |
| `make:model`          | `app/models/<Name>.ts`                | See [ORM](/docs/orm#generating-models)                          |
| `make:migration`      | `database/migrations/…`               | See [Migrations](/docs/migrations)                              |
| `make:factory`        | `database/factories/<Name>Factory.ts` | Fills the model's columns. See [Factories](/docs/orm/factories) |
| `make:seeder`         | `database/seeders/<Name>.ts`          | See [Seeding](/docs/seeding)                                    |

## make:controller

```bash
# in your project root
bun zt make:controller PostController
# Created: app/controllers/PostController.ts

bun zt make:controller PostController --resource
# Created: app/controllers/PostController.ts  (with index/show/store/update/destroy stubs)
```

The basic stub has a single `index` action; `--resource` adds the full CRUD set:
`index`, `show`, `store`, `update`, and `destroy`. The next step it prints is the route to
add: `Router.get("/posts", PostController, "index")`, or `Router.resource("posts",
PostController)` for a resource controller.

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
`next()`, plus a commented example of short-circuiting with a `Response`. A class in
`app/middleware/` is registered at boot as a named group under its own name, so a route uses it
as `Router.group({ middleware: ["RequireAdminMiddleware"] }, …)` without importing it.

## make:command

```bash
# in your project root
bun zt make:command SendDailyReport
# Created: app/commands/SendDailyReport.ts
```

The stub includes `static commandName` (kebab-cased from the class name),
`static description`, `static needsApp`, placeholder `args` and `flags` arrays,
and an async `run()` method. Commands in `app/commands/` are found by themselves, so it
runs at once: `bun zt send-daily-report`.

## make:request

Form requests centralise validation rules away from controller bodies.

```bash
# in your project root
bun zt make:request StorePostRequest
# Created: app/requests/StorePostRequest.ts
```

The stub extends `FormRequest` from `zerotal/validator` with a `rules(r)` method. Its
return type is left for TypeScript to infer, so each field `StorePostRequest.validate()`
returns is typed by the rule that checks it.

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

The stub extends `Job` from `zerotal/queue`, sets a `default` queue, and calls
`JobRegistry.register(...)` at the bottom of the file so the job is dispatchable.

## make:schedule

```bash
# in your project root
bun zt make:schedule SendReminders
# Created: app/schedules/SendReminders.ts
```

The stub extends `Schedule` from `zerotal/scheduler`, runs hourly
(`override cron = "0 * * * *"`) and leaves `handle()` for the work. The scheduler
discovers it at boot; `bun zt schedule:run SendReminders` runs it once, now. It
warns when `bootstrap/providers.ts` does not list `SchedulerProvider`. See
[Developing schedules](/docs/scheduler#developing-schedules).

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

The stub has an empty `static listens` and a `handle(event: unknown)` method. Name the event it
handles in `static listens` (`static listens = UserRegistered;`) and narrow `handle()`'s
parameter to it; a listener in `app/listeners/` is bound at boot with no registration code.

## make:observer

```bash
# in your project root
bun zt make:observer UserObserver
# Created: app/observers/UserObserver.ts

bun zt make:observer UserObserver --model User
# Same path; stub names its parameters after the model
```

The stub implements `ModelObserver` from `zerotal/orm` with `creating`/`created`,
`updating`/`updated`, and `deleting`/`deleted` hooks. When `--model` is omitted the
model name is inferred by stripping the `Observer` suffix. An observer named `<Model>Observer`
is attached to that model at boot; for any other name, the next step it prints is the
`<Model>.observe(<Name>)` call to make.

| Flag             | Type   | Description                       |
| ---------------- | ------ | --------------------------------- |
| `--model` (`-m`) | string | Model class this observer targets |

## make:policy

```bash
# in your project root
bun zt make:policy PostPolicy
# Created: app/policies/PostPolicy.ts

bun zt make:policy TaskPolicy --model Task   # also --model=Task and -m Task
# Created: app/policies/TaskPolicy.ts
```

The policy extends `Policy<Task>` from `zerotal/auth`, and its `view`, `create`,
`update` and `delete` checks take your app's own `User` and `Task`. When the model has
an owner column (`userId`), the checks are the starters' rule, as in their
`ProjectPolicy`: anyone signed in may create one, and only its owner may see, change or
delete it. Without one, each check allows and says where to decide, and the command
warns. When `--model` is omitted the model name is inferred by stripping the `Policy`
suffix.

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

In an Inertia app, `--model` writes a screen over the model instead: owner-scoped file routes
for list, create, edit, update and delete, a form request, a policy, the React or Vue pages and
their shared form, and a feature test. See
[Generating a resource](/docs/inertia/build#generating-a-resource).

```bash
# in your project root
bun zt make:resource Task --model Task
```

| Flag             | Type   | Description                                                      |
| ---------------- | ------ | ---------------------------------------------------------------- |
| `--model` (`-m`) | string | Write an Inertia screen listing and editing this model           |
| `--framework`    | string | With `--model`, force `react` or `vue` (auto-detected otherwise) |

## make:route

In an Inertia app, writes a file route under `app/routes/` with `GET` (rendering its page)
and `POST` handlers in the starters' style, and the page when there is none. See
[Generating a route](/docs/inertia/build#generating-a-route).

```bash
# in your project root
bun zt make:route reports
bun zt make:route "(auth)/(verified)/tasks/[task]/archive" --methods POST
```

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
# Created: packages/billing/package.json
# Created: packages/billing/src/index.ts
# Created: packages/billing/src/config.ts
# Created: packages/billing/src/BillingManager.ts
# Created: packages/billing/src/provider/BillingProvider.ts
# Created: packages/billing/src/facades/Billing.ts
# Created: packages/billing/src/Billing.test.ts
```

Every file is checked before any is written, so a refused run (one of them exists, and no
`--force`) leaves no half-made package behind.

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

## make:test

```bash
# in your project root
bun zt make:test posts
# Created: tests/posts.test.ts
# Next:
#   Run it: bun zt test tests/posts.test.ts

bun zt make:test Slugify --unit
# Created: tests/slugify.test.ts
```

The feature test boots the app the way the rest of the suite does, and every test in it either
passes on the app as it stands or is a `test.todo` until the route it calls exists. `--unit`
writes a test with no app and no database. The file goes in `tests/feature/` or `tests/unit/`
when the app has those directories.

| Flag     | Type    | Description                                |
| -------- | ------- | ------------------------------------------ |
| `--unit` | boolean | Write a unit test, with no app or database |

## Writing your own generator

Extend `GeneratorCommand` from `zerotal/commands` and implement `generate()` instead of `run()`.
Write each file through `this.writeFile()`, and your generator takes `--dry-run` and `--force`,
checks its name, and fails on a refusal, like the built-in ones:

```ts
// app/commands/MakeReportCommand.ts
import { GeneratorCommand } from "zerotal/commands";

export class MakeReportCommand extends GeneratorCommand {
  static override commandName = "make:report";
  static override description = "Create a new report class";

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    if (!(await this.writeFile(`app/reports/${name}.ts`, `export class ${name} {}\n`))) return;
    this.next(`Build it from a command: new ${name}()`);
  }
}
```

| Member                             | Description                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `static nameKind`                  | A `GeneratorNameKind`: `"class"` (default), `"nested-class"`, `"file"` or `"path"`. |
| `static nameArgument`              | The argument checked, `"name"` by default; `undefined` to check none.               |
| `generate()`                       | The work, run once the name is checked.                                             |
| `writeFile(path, source, options)` | Write one file, formatted as the app formats its own; `false` if refused.           |
| `canWrite(path)`                   | Whether a file may be written, refusing if not: to check several before any.        |
| `refuse(message)`                  | Print the reason and set exit code 1.                                               |
| `next(...steps)`                   | Print the `Next:` block.                                                            |
| `dryRun`, `force`                  | Whether `--dry-run` / `--force` was given.                                          |

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
