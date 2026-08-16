---
title: Commands
description: Build and run CLI commands with bun zt, from generators to your own class- or closure-based commands.
---

# Commands

Zerotal ships a class-based CLI for running framework tasks and your own
scripts. Every command is invoked with `bun zt <name>`, and you can add new
ones as classes or one-line closures.

```bash
# in your project root
bun zt list              # list all commands with descriptions
bun zt help <command>    # detailed usage for one command
bun zt make:controller PostController
```

The command system is built into `@zerotal/core` — there is no package to
install and no provider to register. The CLI bootstraps your application, then
dispatches the matched command.

## Listing & help

`bun zt list` prints every registered command, its description, and any
aliases. `bun zt help <command>` prints the usage line, description,
arguments, and options for a single command.

```bash
# in your project root
bun zt list
bun zt help migrate
```

## Class-based commands

Extend `Command`, declare static metadata, and implement `run()`. Inside `run()`
you read parsed positional arguments from `this.args` and flags from
`this.flags`:

```typescript
// app/commands/SendDigestCommand.ts
import { Command } from "zerotal";

export class SendDigestCommand extends Command {
  static commandName = "digest:send";
  static description = "Send the weekly digest email";
  static args = [{ name: "segment", required: false, default: "all" }];
  static flags = [{ name: "dry", type: "boolean" as const, default: false }];

  async run(): Promise<void> {
    const segment = this.args["segment"];
    if (this.flags["dry"]) {
      this.warn("Dry run — nothing sent");
      return;
    }
    this.info(`Sending digest to ${segment}…`);
  }
}
```

A `FlagDef`'s `type` is `"string" | "boolean" | "number"`; the `as const`
keeps the literal type so the field stays type-checked.

> **Tip** — Run `bun zt make:command SendDigest` to scaffold a ready-to-edit
> command class at `app/commands/SendDigestCommand.ts`.

## Closure commands

For one-liners, register a plain definition with a signature string. The
signature's first token is the name; `{arg}` is required, `{arg?}` optional,
`{arg=default}` has a default, `{--flag}` is a boolean flag, and `{--flag=}` /
`{--flag=default}` is a string flag.

```typescript
// in a service provider or bootstrap script
const runner = app.container.tryMake("commands");

runner.command({
  signature: "greet {name} {--loud}",
  description: "Say hello",
  handle: ({ name, loud }, cmd) => {
    cmd.info(loud ? `HELLO ${name}!` : `Hello, ${name}`);
  },
});
```

The `handle` callback receives a single object merging the parsed arguments and
flags, plus the `Command` instance so you can use its output helpers.

> **Note** — `registerCommand()` is an alias for `command()`; both build a
> synthetic `Command` subclass from the definition and register it.

### Which should I use?

| You have…                                              | Use                  |
| ------------------------------------------------------ | -------------------- |
| A quick task with little logic, defined inline         | Closure              |
| Logic worth testing, multiple methods, or its own file | Class                |
| A folder of commands to register together              | Class + `discover()` |

## Auto-discovery

`app/commands/` is discovered automatically: any command class dropped there —
including everything `make:command` generates — is registered when the CLI boots,
with no imports or provider wiring. An app command registers after the built-ins,
so it wins a name collision. The directory is configurable via
`conventions.paths.commands` in `config/app.ts`, and discovery honours the
`conventions.enabled` master switch.

To register a folder from somewhere else, call `discover()` yourself:

```typescript
// in a service provider or bootstrap script
await runner.discover("./vendor/acme/commands");
```

Every non-test `.ts`/`.js` file under the directory is imported, and any exported
`Command` subclass with a non-empty `commandName` is registered. `discover()`
returns the list of registered names.

## Styled output & prompts

The `Command` base class provides coloured output helpers and interactive
prompts. The prompts read from stdin and only work on a real TTY:

```typescript
// inside a command's run()
this.info("Success"); // green
this.warn("Heads up"); // yellow
this.error("Failed"); // red (written to stderr)
this.line("Plain"); // cyan
this.dim("subtle"); // dim
this.section("Title"); // bold heading
this.table([["Key", "Value"]]); // aligned two-column rows
this.newLine();

const name = await this.ask("Your name?", "guest");
const ok = await this.confirm("Proceed?", true);
const env = await this.choice("Environment:", ["local", "staging", "production"]);
const token = await this.secret("API token:"); // input hidden on a Unix TTY
```

> **Warning** — `secret()` only hides input on a Unix TTY with raw mode; on
> Windows and in non-interactive contexts it falls back to a visible prompt.

## Built-in Commands

### Server & Development

| Command                       | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `bun zt dev`                  | Dev mode: the server plus every registered process (alias: `d`) |
| `bun zt dev --only=server`    | Run only the named processes, comma-separated                   |
| `bun zt dev --without=queue`  | Run everything except the named processes                       |
| `bun zt dev --list`           | Print what would run, and which provider registered it          |
| `bun zt dev --stream`         | Interleave prefixed output instead of drawing tabs              |
| `bun zt dev --force-build`    | Rebuild assets even when the build cache says they're current   |
| `bun zt serve`                | Start the HTTP server on port 3000                              |
| `bun zt serve --port 8080`    | Start on a custom port                                          |
| `bun zt serve --force`        | If the port is busy, stop whatever holds it                     |
| `bun zt serve --auto-port`    | If the port is busy, start on the next free port                |
| `bun zt reload`               | Hot-reload routes in the running server (sends SIGUSR2)         |
| `bun zt status`               | Show live metrics from the running server                       |
| `bun zt repl`                 | Start an interactive REPL with the bootstrapped app in scope    |
| `bun zt worker`               | Start the background job worker process                         |
| `bun zt worker --queue email` | Process a specific queue                                        |
| `bun zt worker --once`        | Process one job then exit                                       |
| `bun zt test`                 | Run the test suite in the `test` environment                    |
| `bun zt compile`              | Compile the app to a self-contained binary (alias: `build`)     |
| `bun zt css:build`            | Build the Tailwind CSS bundle for production                    |

#### When the port is already taken

`serve` checks the port before it binds, so a busy one is a question rather than
a crash. It tells you which process is holding it — usually a server you forgot
was running — and offers to stop that process and take the port, or to start on
the next free one instead. Pressing Enter takes the next free port, the answer
that cannot cost you anything.

Nothing prompts when there is no terminal to answer, which covers CI, containers,
and anything reading `serve`'s output from a pipe. There it fails with the same
explanation, so use `--force` or `--auto-port` to say up front which way you want
it decided. Both flags work with a plain `serve` and with `serve --dev`.

The dev server is a special case worth knowing about: on every restart it waits a
few seconds for its own previous process to let go of the socket rather than
asking you about it. A prompt on each file save would be unbearable, and the port
is about to free itself anyway.

#### Dev mode and the deck

`bun zt dev` starts the server, the file watcher, and every process a provider or
your app registered — a queue worker, a type-checker, a Stripe listener — in one
terminal, each in its own tab. It is `serve --dev` with those extra tabs and the
keys to drive them, so anything true of one is true of the other.

An app with a queue no longer needs a second terminal:

```bash
# in your project root
bun zt dev
```

The deck draws one tab per process, colour-coded, showing whether each is
running, restarting, or has given up:

```text
 1 server ●│ 2 queue ●│ 3 types ◌
─────────────────────────────────────────────────
 GET / 200 4ms
 GET /posts 200 11ms
 1-9 tab · ←/→ cycle · ↑/↓ scroll · r restart · c clear · / search · t time · s stream · q quit
```

| Key           | Does                                                              |
| ------------- | ----------------------------------------------------------------- |
| `1`–`9`       | Select that tab                                                   |
| `←` `→` `Tab` | Cycle through tabs                                                |
| `↑` `↓`       | Scroll the focused tab a line at a time — as does the mouse wheel |
| `PgUp` `PgDn` | Scroll it a screen at a time                                      |
| `Home` `End`  | Jump to the oldest line, or back to the newest                    |
| `r`           | Restart the focused process                                       |
| `c`           | Clear the focused tab's output                                    |
| `/`           | Search within the focused tab (`Enter` keeps it, `Esc` drops it)  |
| `t`           | Toggle per-line timestamps                                        |
| `s`           | Switch to stream mode                                             |
| `q`           | Quit — stops every process and restores your shell                |

Scrollback belongs to the deck rather than to your terminal, which is what makes
per-tab history and search possible. It keeps the last 5,000 lines per process.
Your terminal's own scrollbar does nothing while the deck is up — it has no
history to move, because the deck holds it all. Use the keys above (or the
wheel, which the terminal sends the deck as `↑`/`↓`).

Scrolling up parks the view where you left it: the process behind the tab keeps
printing, but what you stopped to read stays on screen until you scroll back
down to the newest line.

**A process that dies never takes the server with it.** It restarts on its own —
three times, backing off between attempts — and if it still will not start, that
one tab parks with a message telling you how to retry. Everything else keeps
running. This is the opposite of the asset build, where a failure deliberately
aborts the reload.

#### Stream mode

Not everything watching `zt dev` is a person at a terminal. When stdout is not a
TTY — CI, a pipe, a log file — the deck writes prefixed lines instead, with no
escape codes at all:

```text
[server] GET / 200 4ms
[queue ] processing SendWelcomeEmail
[server] GET /posts 200 11ms
```

That happens automatically; `--stream` forces it, and `s` switches to it
mid-session. It is the same information, and it is what you want in a file.

#### Choosing what runs

`--only` and `--without` take comma-separated names, and the server is an
ordinary name among them:

```bash
# in your project root
bun zt dev --only=server,queue   # just these two
bun zt dev --without=queue       # everything else
bun zt dev --only=queue          # no server at all
```

When you are not sure what a tab is or who asked for it, `--list` answers both
without starting anything:

```bash
# in your project root
bun zt dev --list
```

```text
Dev processes
  server
    command          managed by the orchestrator
    registered by    @zerotal/core
  queue
    command          bun zt queue:work
    registered by    QueueProvider
```

Your app has the last word. `app.dev.disable` removes a process by name, and
registering the same name again replaces it rather than adding a second tab:

```ts
// config/app.ts
export default AppConfig({
  dev: {
    processes: [
      { name: "stripe", command: ["stripe", "listen", "--forward-to", "localhost:3000"] },
    ],
    disable: ["queue"],
  },
});
```

Packages register their own — see
[Registering a dev process](/docs/package-development#registering-a-dev-process).

### Inspection

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `bun zt route:list`    | List all registered routes with methods and middleware |
| `bun zt route:types`   | Write `types/routes.generated.ts` (`--check` in CI)    |
| `bun zt doctor`        | Check the app for silent misconfigurations             |
| `bun zt key:generate`  | Generate a new `APP_KEY` and write it to `.env`        |
| `bun zt lint:packages` | Check every workspace package against convention rules |

`doctor` runs every static sanity check against the booted app and prints each
finding with its fix: APP_KEY strength, `database.synchronize` colliding with
migration files, a `routes/` directory nothing loads, and class directories
(`app/schedules`, `app/jobs`, `config/storage.ts`) whose consuming provider is
not registered. These failures otherwise fail by _doing nothing_, which is the
most expensive kind to find. Packages can contribute checks via
`app.registerDoctorCheck()`. Exits non-zero when a check fails outright, so it
can gate a deploy.

### Database

| Command                       | Description                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `bun zt migrate`              | Run all pending migrations                                     |
| `bun zt migrate --fresh`      | Drop all tables, then re-run everything from scratch           |
| `bun zt migrate --seed`       | Run migrations, then run the seeders                           |
| `bun zt migrate:rollback`     | Roll back the most recent migration batch                      |
| `bun zt migrate:fresh`        | Alias: drop all tables and re-run all migrations               |
| `bun zt migrate:fresh --seed` | Rebuild the schema from scratch, then run the seeders          |
| `bun zt migrate:status`       | Show the status (run / pending / batch) of each migration file |
| `bun zt migrate:generate`     | Auto-generate a migration from model schema changes            |
| `bun zt db:seed`              | Run all seeders from `database/seeders/`                       |

> **Danger** — `migrate --fresh` and `migrate:fresh` drop every table before
> re-running migrations. Never run them against a production database.

### Generators

| Command                                              | Creates                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `bun zt make:model Post`                             | `app/models/Post.ts`                                                       |
| `bun zt make:controller PostController [--resource]` | `app/controllers/PostController.ts`                                        |
| `bun zt make:middleware RequireAdmin`                | `app/middleware/RequireAdminMiddleware.ts`                                 |
| `bun zt make:command SendDigest`                     | `app/commands/SendDigestCommand.ts`                                        |
| `bun zt make:request StorePost`                      | `app/requests/StorePostRequest.ts`                                         |
| `bun zt make:notification OrderShipped`              | `app/notifications/OrderShippedNotification.ts`                            |
| `bun zt make:job ProcessPayment`                     | `app/jobs/ProcessPaymentJob.ts`                                            |
| `bun zt make:event UserRegistered`                   | `app/events/UserRegisteredEvent.ts`                                        |
| `bun zt make:listener SendWelcome`                   | `app/listeners/SendWelcomeListener.ts`                                     |
| `bun zt make:observer UserObserver [--model User]`   | `app/observers/UserObserver.ts`                                            |
| `bun zt make:policy PostPolicy [--model Post]`       | `app/policies/PostPolicy.ts`                                               |
| `bun zt make:resource UserResource`                  | `app/resources/UserResource.ts`                                            |
| `bun zt make:migration create_posts_table`           | `database/migrations/{timestamp}_create_posts_table.ts`                    |
| `bun zt make:factory PostFactory`                    | `database/factories/PostFactory.ts`                                        |
| `bun zt make:seeder PostSeeder`                      | `database/seeders/PostSeeder.ts`                                           |
| `bun zt make:provider Payment [--no-register]`       | `app/providers/PaymentProvider.ts` + registers in `bootstrap/providers.ts` |
| `bun zt make:package billing`                        | Full `packages/billing/` package skeleton                                  |

### Queue

| Command                                        | Description                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| `bun zt queue:work [--queue default] [--once]` | Process jobs. Daemon in production; `--once` for CI. |
| `bun zt queue:failed`                          | List all failed jobs                                 |
| `bun zt queue:retry <id\|all>`                 | Retry one failed job or all failed jobs              |
| `bun zt queue:flush [--queue name] [--force]`  | Delete all failed jobs from the database             |

### Cache

| Command              | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `bun zt cache:clear` | Clear all cached values from the configured cache store |

### Scheduler

| Command                | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `bun zt schedule:list` | List all registered scheduled tasks with their next run time |

## References

The command surface lives in `@zerotal/core`. The base `Command` class is what
you extend; `CommandRunner` (resolved from the container as `"commands"`) is the
registry and dispatcher.

### Command static metadata

| Field         | Type        | Description                               |
| ------------- | ----------- | ----------------------------------------- |
| `commandName` | `string`    | The name invoked on the CLI.              |
| `description` | `string`    | Shown in `list` and `help`.               |
| `args`        | `ArgDef[]`  | Positional arguments the command accepts. |
| `flags`       | `FlagDef[]` | Named flags the command accepts.          |
| `needsApp`    | `boolean`   | Whether the bootstrapped app is injected. |

`ArgDef` is `{ name: string; required?: boolean; default?: string }`. `FlagDef`
is `{ name: string; short?: string; type: "string" | "boolean" | "number"; description?: string; default?: unknown }`.

### Command instance members

| Member  | Signature                                     | Description                                      |
| ------- | --------------------------------------------- | ------------------------------------------------ |
| `run`   | `run(): Promise<void>`                        | The work the command performs (abstract).        |
| `args`  | `Record<string, string>`                      | Parsed positional arguments, set before `run()`. |
| `flags` | `Record<string, string \| boolean \| number>` | Parsed flags, set before `run()`.                |
| `app`   | `unknown`                                     | The application instance, set before `run()`.    |

### Output helpers

| Method    | Signature                                        | Description                  |
| --------- | ------------------------------------------------ | ---------------------------- |
| `info`    | `info(msg: string): void`                        | Green success line.          |
| `warn`    | `warn(msg: string): void`                        | Yellow warning line.         |
| `error`   | `error(msg: string): void`                       | Red line, written to stderr. |
| `line`    | `line(msg: string): void`                        | Cyan line.                   |
| `dim`     | `dim(msg: string): void`                         | Dimmed line.                 |
| `write`   | `write(msg: string): void`                       | Raw write, no newline.       |
| `newLine` | `newLine(): void`                                | Blank line.                  |
| `section` | `section(title: string): void`                   | Bold heading.                |
| `table`   | `table(rows: [string, string][], indent?): void` | Aligned two-column rows.     |

### Prompts

| Method    | Signature                                                             | Description                       |
| --------- | --------------------------------------------------------------------- | --------------------------------- |
| `ask`     | `ask(question: string, defaultValue?: string): Promise<string>`       | Text input with optional default. |
| `confirm` | `confirm(question: string, defaultValue?: boolean): Promise<boolean>` | Yes/no confirmation.              |
| `choice`  | `choice(question: string, options: string[]): Promise<string>`        | Pick one from a numbered list.    |
| `secret`  | `secret(question: string): Promise<string>`                           | Hidden input on a Unix TTY.       |

### CommandRunner

| Method            | Signature                                                                               | Description                                            |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `register`        | `register(Cmd: CommandClass, aliases?: string[]): void`                                 | Register a command class under its name and aliases.   |
| `registerAll`     | `registerAll(commandClasses: CommandClass[]): void`                                     | Register several classes at once.                      |
| `command`         | `command(definition: CommandDefinition, aliases?: string[]): CommandClass`              | Build and register a closure command.                  |
| `registerCommand` | `registerCommand(definition: CommandDefinition, aliases?: string[]): CommandClass`      | Alias for `command()`.                                 |
| `registerLazy`    | `registerLazy(name: string, thunk: CommandThunk, aliases?: string[]): void`             | Register a command imported lazily on first call.      |
| `discover`        | `discover(dir: string): Promise<string[]>`                                              | Import a directory and register found command classes. |
| `run`             | `run(argv: string[]): Promise<void>`                                                    | Parse argv, run the command, and `process.exit()`.     |
| `callInProcess`   | `callInProcess(argv: string[], parameters?): Promise<{ code: number; output: string }>` | Run in-process, capture output, no exit.               |

## Next steps

- [Scaffolding](/docs/scaffolding) — what the `make:` generators produce.
- [Scheduler](/docs/scheduler) — register tasks that `schedule:list` reports.
- [Queue](/docs/queue) — the worker and queue commands in context.
- [Container](/docs/container) — how commands resolve their dependencies.
  </content>
  </invoke>
