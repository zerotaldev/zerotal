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
bun zt migrate --help    # the same page; -h works too
```

Adding `--help` (or `-h`) to any command prints that page and does **not** run the
command, so it is safe to ask about one you are unsure of. A command that declares
its own `help` flag or `-h` option keeps it, and everything after a bare `--` is
passed to the command as it is.

### Options a command does not take

An option a command does not declare is refused, the command does not run, and the exit code
is 1. The message names the declared option you most likely meant and lists the ones it takes:

```text
$ bun zt route:list --jsn
✖ route:list does not take --jsn. Did you mean --json?
Its options: --method (-m), --path (-p), --name (-n), --verbose (-v), --json.
See: bun zt help route:list
```

Everything after a bare `--` is an operand, not an option, so it is never refused. A command
that hands options on to another tool says so with `static allowUnknownFlags = true` and reads
them from `this.unknownFlags`; `zt test` does, and refuses them itself with a hint to pass them
to `bun test` after `--`.

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
> command class at `app/commands/SendDigest.ts`.

## Closure commands

For one-liners, register a plain definition with a signature string. The
signature's first token is the name; `{arg}` is required, `{arg?}` optional,
`{arg=default}` has a default, `{--flag}` is a boolean flag, and `{--flag=}` /
`{--flag=default}` is a string flag.

```typescript fragment
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

```typescript fragment
// in a service provider or bootstrap script
await runner.discover("./vendor/acme/commands");
```

Every non-test `.ts`/`.js` file under the directory is imported, and any exported
`Command` subclass with a non-empty `commandName` is registered. `discover()`
returns the list of registered names.

## Styled output & prompts

The `Command` base class provides coloured output helpers and interactive
prompts. The prompts read from stdin and only work on a real TTY:

```typescript fragment
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

| Command                      | Description                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `bun zt dev`                 | Dev mode: the server plus every registered process (alias: `d`)                            |
| `bun zt dev --only=server`   | Run only the named processes, comma-separated                                              |
| `bun zt dev --without=queue` | Run everything except the named processes                                                  |
| `bun zt dev --list`          | Print what would run, and which provider registered it                                     |
| `bun zt dev --list --json`   | The same, as one JSON document for a script                                                |
| `bun zt dev --stream`        | Interleave prefixed output instead of drawing tabs                                         |
| `bun zt dev --force-build`   | Rebuild assets even when the build cache says they're current                              |
| `bun zt serve`               | Start the HTTP server on `app.port`: `PORT`, else 3000                                     |
| `bun zt serve --port 8080`   | Start on a custom port, over `PORT` and `app.port`                                         |
| `bun zt serve --force`       | If the port is busy, stop whatever holds it                                                |
| `bun zt serve --auto-port`   | If the port is busy, start on the next free port                                           |
| `bun zt reload`              | Hot-reload routes in the running server (sends SIGUSR2)                                    |
| `bun zt status`              | Show live metrics from the running server                                                  |
| `bun zt repl`                | Start an interactive REPL with the bootstrapped app in scope; `import` works at the prompt |
| `bun zt worker`              | Start the background job worker process                                                    |
| `bun zt queue:work -q email` | Process a specific queue                                                                   |
| `bun zt queue:work --once`   | Process one job then exit                                                                  |
| `bun zt test`                | Run the test suite in the `test` environment                                               |
| `bun zt test --randomize`    | Run tests in a random order; `--seed=<n>` replays one                                      |
| `bun zt compile`             | Compile to a binary; Deployment has its limits (alias: `build`)                            |
| `bun zt css:build`           | Build the Tailwind CSS bundle for production                                               |

#### When the port is already taken

`serve` checks the port before it binds, so a busy one is a question rather than
a crash. It tells you which process is holding it — usually a server you forgot
was running — and offers to stop that process and take the port, or to start on
the next free one instead. Pressing Enter takes the next free port, the answer
that cannot cost you anything.

Nothing prompts when there is no terminal to answer, which covers CI, containers,
and anything reading `serve`'s output from a pipe. There it fails with the same
explanation, so use `--force` or `--auto-port` to say up front which way you want
it decided. Both flags work with `serve` and with `dev`.

The dev server is a special case worth knowing about: on every restart it waits a
few seconds for its own previous process to let go of the socket rather than
asking you about it. A prompt on each file save would be unbearable, and the port
is about to free itself anyway.

#### Dev mode and the deck

`bun zt dev` starts the server, the file watcher, and every process a provider or
your app registered — a queue worker, a type-checker, a Stripe listener — in one
terminal, each in its own tab. It subclasses `serve`, so it is the same supervisor,
the same port resolution (`--port`, else `app.port`, which is `PORT` from the shell or `.env`,
else 3000) and the same restart behaviour, plus the flags that only
make sense with a deck on screen — anything true of `serve` is true of it.

`serve --dev` was the old spelling and was retired in 1.13.0; it now fails with a
message rather than starting a plain server. The scaffold's `dev` script runs this,
so `bun run dev` and `bun zt dev` are the same thing.

An app with nothing to build (an API, with no view package and no `app.assets`) gets
the same dev mode as any other: the deck, the queue tab, restarts on save and the
startup-error page. Before 1.19.0 it fell back to a bare `bun --watch` with none of
them.

#### Who can reach the dev server

`bun zt dev` binds `127.0.0.1`, so only this machine can open it. A dev server answers
with stack traces, source code and the inspector, which are not for the rest of the
network. The banner shows a Network line only when something on the network can reach
the server:

```bash
# in your project root
bun zt dev                    # http://localhost:3000, this machine only
bun zt dev --host 0.0.0.0     # also http://<this machine's address>:3000
```

Pass `--host 0.0.0.0` to open the app on a phone or another computer on the same
network, and when `zt dev` runs in a container whose port is published to the host: a
server bound to the container's loopback is not reachable through the published port.
The app opens there; the debug panel and the Inertia recorder still answer this machine
only, so they also need a `gate` (see [Who can reach it](/docs/devtools#who-can-reach-it)).
`bun zt serve` binds every interface unless given `--host`, as before.

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

**A restart or quit asks first.** The server, and every process that runs one of the
app's own `zt` commands (`queue:work`, `schedule:work`), is asked to stop over an IPC
channel and given time to finish what it holds: the queue worker completes the job in
hand, the scheduler lets a running task end. Only a process that has not gone after a
few seconds is killed. A command of your own can do the same with
`onGracefulStopRequest` from `@zerotal/core/dev`:

```ts
// app/commands/SyncCommand.ts
import { onGracefulStopRequest } from "@zerotal/core/dev";

let stopping = false;
const off = onGracefulStopRequest(() => {
  stopping = true; // finish the current batch, then return
});
// ... loop while !stopping, then:
off();
```

The other side is `requestGracefulStop(child, graceMs)`, for a supervisor of your own: it
sends `DEV_SHUTDOWN_MESSAGE` over the child's IPC channel and resolves `true` once the
child has exited, or `false` when there is no channel or the grace period ran out and the
caller still has to kill it. The child can be anything with a `send` and an `exited`
promise (a `StoppableChild`), such as what `Bun.spawn` returns when given an `ipc` handler.

#### When a build or the server fails

A save that breaks something shows the error where you are looking, not only in the
terminal:

- **A frontend build fails** (a syntax error in a React or Vue page, say). The server
  keeps serving the last bundle that built, and every open tab draws the error over
  the page: the file, line and column, and the compiler's message. A tab you open or
  reload while the build is broken shows it too. Save a fix and the tab reloads by
  itself. `Esc` hides the panel.
- **The server will not start** (a syntax error in a Flow page, a model or a route
  file, or an error thrown while booting). Instead of the browser's "connection
  refused", the port answers with a page naming the file, line and message, with the
  code frame, and the terminal says the same. A syntax error is not retried, and only
  a port another process holds is reported as one. Save a fix and the page reloads by
  itself once the server is back. A file that will not import fails the boot under
  `zt dev` rather than being skipped: skipping it left a server answering 404 for every
  route the file declared. `types/routes.generated.ts` is never written from a boot
  that skipped a file, and `zt route:types` refuses to write it then.
- **A request fails with a 500.** The development error page reloads by itself after
  you save a fix, once the restarted server answers, like every other page.

Both are drawn by `/__dev/reload.js`, the same file that does live-reload, with no
inline script or style, so they work under a strict Content-Security-Policy.

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

Colour follows the same rule everywhere the framework writes, in `zt dev` and in every
other command: colour codes go to a terminal, never to a pipe or a file, and never when
`NO_COLOR` is set. `FORCE_COLOR=1` keeps them for a pipe whose reader draws colour.

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
  scheduler
    command          bun zt schedule:work
    registered by    SchedulerProvider
    on change        restarts with the server
```

Your app has the last word. `app.dev.disable` removes a process by name, and
registering the same name again replaces it rather than adding a second tab:

```ts fragment
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

What a save restarts or rebuilds is listed in
[Hot reload](/docs/assets#what-triggers-a-restart-and-what-only-rebuilds); `app.dev.watch`
adds paths of your own to either list.

Packages register their own — see
[Registering a dev process](/docs/package-development#registering-a-dev-process).

### Inspection

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `bun zt version`       | Show the Zerotal, Bun and app versions                 |
| `bun zt about`         | Installed Zerotal packages, and what else ships        |
| `bun zt route:list`    | List all registered routes (`--json` for a script)     |
| `bun zt route:types`   | Write `types/routes.generated.ts` (`--check` in CI)    |
| `bun zt doctor`        | Check the app for silent misconfigurations (`--json`)  |
| `bun zt key:generate`  | Generate a new `APP_KEY` and write it to `.env`        |
| `bun zt key:rotate`    | Replace `APP_KEY`, keeping the old one to decrypt with |
| `bun zt init:env`      | Create `.env` from `.env.example`, secrets generated   |
| `bun zt lint:packages` | Check every workspace package against convention rules |
| `bun zt upgrade`       | Apply the codemods for a version upgrade               |

#### What does this app have, and what else is there?

`bun zt about` lists the Zerotal packages installed in the app with their versions, then the
framework packages it does not have, each with the needs it covers, the command to add it and
its docs page:

```text
Zerotal 1.x.y  ·  Bun 1.3.14  ·  shop 0.0.1

Installed
  @zerotal/arch           1.x.y
  @zerotal/core           1.x.y  (through zerotal)
  @zerotal/notifications  1.x.y
  zerotal                 1.x.y

Available, not installed
  @zerotal/tenancy
    Multi-tenancy
    bun add @zerotal/tenancy  ·  https://zerotal.dev/docs/tenancy
```

A package at a different version from the rest is marked, since the packages are released
and tested together. The available list is the capability index that ships in
`@zerotal/arch`, the same one [What Ships](/docs/what-ships) and `AGENTS.md` are built from;
without that package, `about` lists what is installed and says where the index lives. Like
`version`, it needs no booted app. `--json` prints the same report for a script.

#### Which version am I on?

`bun zt version` prints the framework, the runtime and the app:

```
Zerotal  1.11.0
Bun      1.3.14
App      my-app 0.1.0
```

It reports the version that is **running**, which is not always the version that is
installed — a long-running server holds the code it booted with, so an upgrade lands
on disk without reaching it.

`--version` and `-v` answer the same question without booting the application:

```bash
bun zt --version
bun zt --version --json     # for a script
```

Prefer the flag form in scripts: it still answers when the app does not boot, and a
config that no longer validates is exactly when you want to know which version you are
on. Both forms print only the JSON on stdout; `bun zt version --json` boots, and its
boot log goes to stderr (see [Output for scripts](#output-for-scripts)).

If `node_modules` contains a second Bun, the report names it. Nothing executes that
copy — it arrives as a peer dependency — but it is the one an install would use.

### Upgrading between versions

`bun zt upgrade --to <version>` applies the codemods a version gap calls for —
mechanical rewrites the framework can make on your behalf when an API changes.

```bash
bun zt upgrade --to 2.0.0            # print the plan, change nothing
bun zt upgrade --to 2.0.0 --write    # apply it
```

**It writes nothing unless you ask.** That is the opposite of most tools and
deliberate: it rewrites source across your whole project, so the first run should
be something you can read and disagree with. `--from` defaults to the `zerotal`
version in your `package.json`.

The half worth reading is the last one. A codemod that quietly walks past
something it does not understand is worse than none, because the changes it _did_
make suggest the job is finished — so anything it recognised and deliberately did
not touch is listed with a file, a line and a reason:

```text
1 place(s) need a decision this cannot make for you:
  app/models/Post.ts:9  export function all<T extends BaseModel>(rows: T[]): T[] {
    `BaseModel` in a type position. It resolves to the same class as `Model`, so
    this compiles either way — renaming it is a readability call, not a
    correctness one.
```

Run it again after applying: a second run should report no changes. Codemods are
idempotent, and that is the cheapest way to confirm one did what it said.

#### What a release fixed for you

`--notes` prints the changelog entries between two versions instead of running codemods, read
from the changelogs the installed packages ship, so it covers exactly the packages your app has.
It is read-only.

```bash
bun zt upgrade --notes                         # after the version package.json declares, up to the installed one
bun zt upgrade --notes --from 1.9.0 --to 1.15.4
bun zt upgrade --notes --grep smtp             # is my SMTP workaround still needed?
bun zt upgrade --notes --json                  # for tooling and CI
```

Entries come grouped as the changelog groups them, breaking changes first, each with the package
and the version that shipped it. `--grep` searches the whole text of each entry, and entries say
what used to fail, so it is the quickest way to check whether a workaround you carry has outlived
its reason. Install the newer version first: the notes are the ones its packages carry.

Some codemods rewrite nothing and only point. `retired-defaults` lists the lines in
`config/app.ts` that set a value a default used to have and no longer does. Today that is
`cors.origin` set to `"*"`, which older scaffolds wrote and which lets any website read your
responses from a visitor's browser. Whether it was meant is your call, so it is reported with
the file and line and left as it is.

`doctor` runs every static sanity check against the booted app and prints each
finding with its fix: APP_KEY strength, `database.synchronize` colliding with
migration files, a `routes/` directory nothing loads, and class directories
(`app/schedules`, `app/jobs`, `config/storage.ts`) whose consuming provider is
not registered. These failures otherwise fail by _doing nothing_, which is the
most expensive kind to find. Packages can contribute checks via
`app.registerDoctorCheck()`. Exits non-zero when a check fails outright, so it
can gate a deploy.

### Output for scripts

`route:list`, `doctor`, `dev --list`, `version`, `about`, `gate:status` and `upgrade --notes`
take `--json`, which prints one JSON document on stdout and nothing else: no colour, no
headings. The application's boot log, a provider's notice and anything else that would have
gone to stdout are written to stderr for a `--json` run, so the output pipes straight into a
parser:

```bash
# in your project root
bun zt route:list --json | jq '.routes[] | select(.name == null) | .path'
bun zt doctor --json > doctor.json || echo "doctor found a failure"
```

`route:list --json` takes the same filters as the table (`--method`, `--path`, `--name`), and
an empty match is `"routes": []` rather than a warning:

```json
{
  "routes": [
    {
      "method": "GET",
      "path": "/posts",
      "name": "posts.index",
      "controller": "PostController",
      "action": "index",
      "middleware": ["Authenticate"]
    }
  ],
  "ambiguousNames": { "home": ["/", "/welcome"] }
}
```

`name` is `null` for a route without one, `controller` is `"file"` for a file route, and
`ambiguousNames` lists each name given to more than one path, which `route()` refuses.

`doctor --json` exits 1 exactly when `ok` is false. `transport` and `headers` are `null`
unless `--url` is given; with it, they hold each WebSocket path probed through the public URL
and each security header the response carried more than once:

```json
{
  "ok": true,
  "checks": [
    {
      "id": "app-key",
      "label": "APP_KEY",
      "status": "warn",
      "message": "APP_KEY is not set. Sessions, signed URLs and encrypted columns all derive from it; …",
      "fix": "bun zt key:generate"
    }
  ],
  "transport": null,
  "headers": null,
  "summary": { "checks": 12, "warnings": 1, "failures": 0 }
}
```

`dev --list --json` lists each process `zt dev` would start, after `--only` and `--without`.
`argv` is `null` for the server (the orchestrator starts it) and for a process that runs inside
the dev process (`inProcess: true`). `--json` without `--list` is refused:

```json
{
  "processes": [
    {
      "name": "queue",
      "label": "queue",
      "argv": ["bun", "zt", "queue:work"],
      "inProcess": false,
      "registeredBy": "QueueProvider",
      "restart": "on-failure",
      "after": "server",
      "restartsWithServer": false
    }
  ]
}
```

The shapes are exported as types for a TypeScript script: `RouteListJson`, `DoctorJson` and
`DevListJson` from `zerotal/commands`.

### Database

| Command                       | Description                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `bun zt migrate`              | Run all pending migrations                                     |
| `bun zt migrate --fresh`      | Drop all tables, then re-run everything from scratch           |
| `bun zt migrate --seed`       | Run migrations, then run the seeders                           |
| `bun zt migrate --pretend`    | Print the SQL pending migrations would run, and run none of it |
| `bun zt migrate:rollback`     | Roll back the most recent migration batch                      |
| `bun zt migrate:fresh`        | Alias: drop all tables and re-run all migrations               |
| `bun zt migrate:fresh --seed` | Rebuild the schema from scratch, then run the seeders          |
| `bun zt migrate:status`       | Show the status (run / pending / batch) of each migration file |
| `bun zt migrate:generate`     | Auto-generate a migration from model schema changes            |
| `bun zt db:seed`              | Run all seeders from `database/seeders/`                       |
| `bun zt db:backup`            | Take a verified SQLite snapshot with `VACUUM INTO`             |

> **Danger** — `migrate --fresh` and `migrate:fresh` drop every table before
> re-running migrations. Never run them against a production database.

`db:backup` is the counterpart to everything above it: those commands all assume the database
file will still be there. It verifies every snapshot it writes and exits non-zero on any
failure, so it is safe to run from a timer — see
[Deployment](/docs/deployment#back-up-the-database) for the flags and a systemd unit.

### Generators

The generators `zerotal` builds in, and `make:flow` and `make:page`, take `--dry-run` (print
the files and their contents, write nothing) and `--force` (overwrite a file that exists),
refuse a name that is not a class or file name, and exit 1 when they refuse. The generators
other packages add keep their own options; see [Scaffolding](/docs/scaffolding) for the list.

| Command                                              | Creates                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `bun zt make:model Post`                             | `app/models/Post.ts`                                                       |
| `bun zt make:controller PostController [--resource]` | `app/controllers/PostController.ts`                                        |
| `bun zt make:middleware RequireAdmin`                | `app/middleware/RequireAdmin.ts`                                           |
| `bun zt make:command SendDigest`                     | `app/commands/SendDigest.ts`                                               |
| `bun zt make:request StorePostRequest`               | `app/requests/StorePostRequest.ts`                                         |
| `bun zt make:notification OrderShipped`              | `app/notifications/OrderShipped.ts`                                        |
| `bun zt make:job ProcessPayment`                     | `app/jobs/ProcessPayment.ts`                                               |
| `bun zt make:schedule SendReminders`                 | `app/schedules/SendReminders.ts`                                           |
| `bun zt make:event UserRegistered`                   | `app/events/UserRegistered.ts`                                             |
| `bun zt make:listener SendWelcome`                   | `app/listeners/SendWelcome.ts`                                             |
| `bun zt make:observer UserObserver [--model User]`   | `app/observers/UserObserver.ts`                                            |
| `bun zt make:policy PostPolicy [--model Post]`       | `app/policies/PostPolicy.ts`                                               |
| `bun zt make:resource UserResource`                  | `app/resources/UserResource.ts`                                            |
| `bun zt make:resource Task --model Task`             | Inertia apps: routes, request, policy, pages, form and test for `Task`     |
| `bun zt make:route reports`                          | Inertia apps: `app/routes/reports.ts` and the page it renders              |
| `bun zt make:migration create_posts_table`           | `database/migrations/{timestamp}_create_posts_table.ts`                    |
| `bun zt make:factory Post`                           | `database/factories/PostFactory.ts`                                        |
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

| Command                       | Description                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `bun zt schedule:list`        | List all registered scheduled tasks with their next run time                            |
| `bun zt schedule:run <name>`  | Run one task now, once, and exit with its result (0 or 1)                               |
| `bun zt schedule:work`        | Run the scheduler alone in the foreground (the `zt dev` tab)                            |
| `bun zt schedule:runs [name]` | Recent recorded runs, newest first (`--limit` to page)                                  |
| `bun zt make:schedule <Name>` | Create `app/schedules/<Name>.ts`; see [Scheduler](/docs/scheduler#developing-schedules) |

## References

The command surface lives in `@zerotal/core`. The base `Command` class is what
you extend; `CommandRunner` (resolved from the container as `"commands"`) is the
registry and dispatcher.

### Command static metadata

| Field               | Type        | Description                               |
| ------------------- | ----------- | ----------------------------------------- |
| `commandName`       | `string`    | The name invoked on the CLI.              |
| `description`       | `string`    | Shown in `list` and `help`.               |
| `args`              | `ArgDef[]`  | Positional arguments the command accepts. |
| `flags`             | `FlagDef[]` | Named flags the command accepts.          |
| `needsApp`          | `boolean`   | Whether the bootstrapped app is injected. |
| `sharedFlags`       | `FlagDef[]` | Flags a base class gives every subclass.  |
| `allowUnknownFlags` | `boolean`   | Take undeclared options (`false`).        |

`ArgDef` is `{ name: string; required?: boolean; default?: string }`. `FlagDef`
is `{ name: string; short?: string; type: "string" | "boolean" | "number"; description?: string; default?: unknown }`.

### Command instance members

| Member         | Signature                                     | Description                                       |
| -------------- | --------------------------------------------- | ------------------------------------------------- |
| `run`          | `run(): Promise<void>`                        | The work the command performs (abstract).         |
| `args`         | `Record<string, string>`                      | Parsed positional arguments, set before `run()`.  |
| `rest`         | `string[]`                                    | Positionals beyond the declared `args`, in order. |
| `unknownFlags` | `string[]`                                    | Undeclared options, with `allowUnknownFlags`.     |
| `flags`        | `Record<string, string \| boolean \| number>` | Parsed flags, set before `run()`.                 |
| `app`          | `unknown`                                     | The application instance, set before `run()`.     |

### Output helpers

| Method    | Signature                                        | Description                      |
| --------- | ------------------------------------------------ | -------------------------------- |
| `info`    | `info(msg: string): void`                        | Green success line.              |
| `warn`    | `warn(msg: string): void`                        | Yellow warning line.             |
| `error`   | `error(msg: string): void`                       | Red line, written to stderr.     |
| `line`    | `line(msg: string): void`                        | Cyan line.                       |
| `dim`     | `dim(msg: string): void`                         | Dimmed line.                     |
| `write`   | `write(msg: string): void`                       | Raw write, no newline.           |
| `json`    | `json(value: unknown): void`                     | One JSON document, for `--json`. |
| `newLine` | `newLine(): void`                                | Blank line.                      |
| `section` | `section(title: string): void`                   | Bold heading.                    |
| `table`   | `table(rows: [string, string][], indent?): void` | Aligned two-column rows.         |

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
