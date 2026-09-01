---
title: Logger
description: Record structured, multi-channel application logs and auto-capture framework signals like slow queries and request errors.
---

# Logger

`zerotal/logger` is Zerotal's structured logger. It gives you a multi-channel
`LogManager` (console, file, daily-rotating, stack, null), a global `Log` facade
you can call anywhere, HTTP access logging via `LoggerMiddleware`, and automatic
logging of framework signals (slow queries, N+1, failed jobs, auth events,
request errors) by subscribing to the [FrameworkEvents](/docs/events)
instrumentation bus.

## Getting Started

The logger ships as part of `@zerotal/core` — there is nothing extra to install. Import it from the `zerotal/logger` subpath:

```ts
import { Log, LogProvider } from "zerotal/logger";
```

## Register the provider

Add `LogProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { LogProvider } from "zerotal/logger";

const providers = [
  // …your other providers
  LogProvider,
];

export default providers;
```

Registering the provider switches on the following, in lifecycle order:

- `onRegister` — binds the `LogManager` under the `log` container token as a lazy singleton.
- `onBooting` — wires the singleton into `LoggerMiddleware` (`setManager`) and registers it via `app.useOnce()`, so request access logging is active with no manual `.use()`.
- `onBooted` — subscribes to the [FrameworkEvents](/docs/events) bus (slow queries, N+1, failed jobs, scheduled tasks, auth events, request errors).
- `onStopping` — unsubscribes every handler, so nothing leaks between boots or test suites.

> **Note** — `LogProvider` runs in every environment (`web`, `console`,
> `worker`, `test`, `repl`), so `Log` is available in HTTP requests, commands,
> queue workers, and the REPL alike.

## Where logs go by default

Two places, always, with no config file at all:

- **The terminal**, so you can watch what is happening.
- **A dated file** — `storage/logs/YYYY-MM-DD.log`, one per day, kept for 14 days.

They are independent on purpose. Quietening the terminal must not cost you the
record, because the record is what you read after the process exited, after the
scrollback rolled over, on a machine nobody was watching. Both are properties of
the logger rather than channels you route to, so pointing `default` at a file
channel no longer silences your terminal.

> **Note** — The file trail is off when `APP_ENV=test`. The path is relative to
> the working directory, so a suite that boots an app would otherwise grow a
> `storage/logs` directory wherever it happened to run. Ask for it explicitly
> (`file: { path: "./tmp/logs" }`) if a test needs it.

## Configuration

Create `config/logging.ts` and use the `LoggingConfig()` helper, which
deep-merges your options over the defaults so you only specify what you change:

```ts
// config/logging.ts
import { LoggingConfig } from "zerotal/logger";

export default LoggingConfig({
  // Quiet terminal, full trail on disk, a month of history.
  console: { level: "warn" },
  file: { days: 30 },
});
```

| Field         | Required | Default                   | Description                                                        |
| ------------- | -------- | ------------------------- | ------------------------------------------------------------------ |
| `console`     | no       | `{ format: "pretty" }`    | The terminal sink. `false` silences it.                            |
| `file`        | no       | `./storage/logs`, 14 days | The dated file trail. `false` turns it off.                        |
| `default`     | no       | `"app"`                   | Name of the channel that `Log.info()` (and friends) also write to. |
| `channels`    | no       | `{}`                      | Named map of extra destinations, discriminated by `driver`.        |
| `slowQueryMs` | no       | `1000`                    | Queries slower than this (ms) are auto-logged at `warn`.           |

### The two sinks

```ts fragment
// config/logging.ts
export default LoggingConfig({
  console: { level: "info", format: "json" }, // or false
  file: { path: "./var/log/app", days: 30, level: "debug" }, // or false
});
```

`console` takes `level` (default `debug`) and `format` (`"pretty"` or `"json"`).
`file` takes `path`, `days`, and `level` — which also defaults to `debug`, so the
trail records everything even when the console is filtered. That asymmetry is the
point: you decide what to _watch_ without deciding what to _keep_.

Turning the file off is reasonable in a container that ships stdout to a
collector:

```ts fragment
// config/logging.ts
export default LoggingConfig({ file: false });
```

### Named channels

Channels are _extra_ destinations layered on top of the two sinks, for routing a
subsystem somewhere specific:

```ts fragment
// config/logging.ts
export default LoggingConfig({
  channels: {
    audit: { driver: "daily", path: "./storage/logs/audit", days: 90 },
  },
});

// elsewhere
Log.channel("audit").info("permission granted", { userId, ability });
```

An entry routed to a channel still reaches the console and the trail — with one
exception that keeps output honest: a channel that already covers a sink
suppresses that baseline for its own entries. A `console` channel does not print
twice; a `single`/`daily` channel does not write the same entry to two files. A
`stack` inherits the coverage of its members.

`null` is not an exception. It discards its own writes; it does not suppress the
record.

## Channel drivers

Each channel is a `{ driver: … }` entry under `channels`, discriminated by its
`driver` field:

| Driver    | Config fields             | Behaviour                                                                                                                            |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `console` | `level?`, `format?`       | Writes to `process.stdout`. `format: 'pretty'` (default) for coloured terminal lines; `format: 'json'` for one JSON object per line. |
| `single`  | `level?`, `path`          | Appends JSON lines to one file at `path`. Creates parent directories as needed; write errors are swallowed.                          |
| `daily`   | `level?`, `path`, `days?` | One date-stamped JSON file (`YYYY-MM-DD.log`) per day under `path/`. When `days` is set, files older than that many days are pruned. |
| `stack`   | `level?`, `channels`      | Fan-out: each entry is written to every listed child channel simultaneously.                                                         |
| `null`    | —                         | Discards everything. Use in test environments.                                                                                       |

> **Warning** — The `daily` driver only prunes old files when you set `days`. Omit
> `days` and files accumulate indefinitely. A `stack` referencing an unknown child
> channel throws at construction time.

### Switching destinations per environment

The two sinks already cover the common case, so this is for the extras:

```ts fragment
// config/logging.ts
export default LoggingConfig({
  // Machine-readable terminal output in production, human-readable locally.
  console: { format: process.env.APP_ENV === "production" ? "json" : "pretty" },
  // Keep a year of audit history in production only.
  ...(process.env.APP_ENV === "production"
    ? { channels: { audit: { driver: "daily", path: "./storage/logs/audit", days: 365 } } }
    : {}),
});
```

### Writing your own channel

A channel is one method. Implement `LogChannel` and register it as a driver when the five
built-ins do not reach where you need entries to go — a hosted log service, a socket, a table:

```typescript
import type { LogChannel, LogEntry } from "zerotal/logger";

class WebhookChannel implements LogChannel {
  constructor(private readonly url: string) {}

  async write(entry: LogEntry): Promise<void> {
    // Failures are swallowed on purpose: a logging sink that throws turns a
    // warning into an outage, and the entry it was carrying is lost either way.
    await fetch(this.url, { method: "POST", body: JSON.stringify(entry) }).catch(() => {});
  }
}
```

The built-ins implement the same interface and are exported, so a custom channel can wrap one
rather than reimplement it — `StackChannel` is itself only a fan-out over other channels.

### Types

| Type            | What it is                                                                     |
| --------------- | ------------------------------------------------------------------------------ |
| `LogLevel`      | `"debug" \| "info" \| "warn" \| "error" \| "fatal"` — the severity ladder.     |
| `LogEntry`      | One record: level, message, context, scope, timestamp, and any captured error. |
| `LogChannel`    | The one-method sink contract: `write(entry): Promise<void>`.                   |
| `BoundLogger`   | A logger pinned to a channel and/or a fixed context bag.                       |
| `ChannelConfig` | The discriminated union of the five driver configs below.                      |
| `LoggerOptions` | What `LoggingConfig()` accepts.                                                |
| `TableData`     | Rows for `Log.table()`.                                                        |

The five built-in channels are exported under their own names — `ConsoleChannel`,
`SingleChannel`, `DailyChannel`, `StackChannel`, `NullChannel` — each matching the `driver`
value in the table above.

## The Log facade

`Log` is a static proxy over the `LogManager` singleton. Use it anywhere —
controllers, services, commands, event listeners:

```ts fragment
// in a controller or service
import { Log } from "zerotal/logger";

Log.debug("User lookup started", { userId: 42 });
Log.info("Order created", { orderId: order.id, total: order.total });
Log.warn("Rate limit close", { ip, remaining: 2 });
Log.error("Payment failed", { orderId }, err);
Log.fatal("Database unreachable", { host: dbHost }, err);
```

Every level shares the same signature:

```ts fragment
// signature — all five levels
Log.info(message: string, context?: Record<string, unknown>, err?: unknown): void
```

- `context` — arbitrary key/value data merged into the structured log entry.
- `err` — an `Error` instance (message + stack captured) or any value (stringified).

## Targeting a specific channel

`Log.channel(name)` returns a `BoundLogger` that writes to the named channel
instead of the configured default:

```ts fragment
// in a controller or service
import { Log } from "zerotal/logger";

const auditLog = Log.channel("daily");
auditLog.info("Admin action", { adminId: user.id, action: "delete_user", targetId });
```

This lets specific modules write to a dedicated channel without changing
`default` for the whole application.

## Adding persistent context

`Log.withContext(extra)` returns a `BoundLogger` (writing to the default channel)
that merges `extra` into every entry. Useful in long-running jobs or to tag a
group of log lines with a shared identifier:

```ts fragment
// in a queue job
import { Log } from "zerotal/logger";

const logger = Log.withContext({ jobId: job.id, queue: job.queue });

logger.info("Job started");
logger.warn("Retrying step", { step: "charge_card", attempt: 2 });
logger.info("Job finished", { durationMs });
// All three entries carry jobId and queue automatically
```

## Scopes: which subsystem is talking

`Log.scope(name)` returns a `BoundLogger` that tags every entry with the part of
the system it came from. The console channel renders the tag as a padded column,
so a boot log reads down the page instead of across it:

```text
01:27:48.682 INFO  [APP]      Application booted {"durationMs":486,"environment":"web","providers":2}
01:27:50.310 INFO  [FLOW]   Compiled 4 page(s), 2 from cache, 3 bind-injected, 8 using runtime
01:27:50.314 INFO  [ROUTER]   Registered 2 static asset routes {"dir":"…/public"}
01:27:50.320 INFO  [APP]      Server listening on http://localhost:3000 {"port":3000}
```

The tag is a real field, not decoration — file and JSON channels keep it as
`scope`, so a log file can be filtered down to one subsystem.

The framework uses this for its own output. Everything a running Zerotal app
reports — boot, routing, the Flow compiler, the queue, the scheduler, page
registry generation — is an ordinary log entry on your configured channels, at a
level you can filter and in a file you can ship. Nothing writes to the terminal
behind the logger's back, which means a `daily` channel captures the framework's
own account of a boot, not just your application's.

The one deliberate exception is the CLI itself. `zt dev`'s banner and its
`[zerotal:dev]` build/restart lines come from the supervisor process that watches
your files, not from the application, and they are interactive terminal output
rather than a record of anything. They stay on stdout.

## How context is rendered

On the console, context is written as `key=value` pairs rather than a JSON blob.
The keys are dimmed so the values carry the eye, and strings stay exactly as you
passed them:

```text
03:19:56.531 INFO  [ROUTER]   Registered 2 static asset routes dir=C:\Projects\app\public
03:19:56.537 INFO  [APP]      Server listening on http://localhost:3000 port=3000
```

Literal strings matter more than they sound. `JSON.stringify` escapes every
backslash, so the same line used to read `{"dir":"C:\\Projects\\app\\public"}` —
a path you cannot copy, in a format that spends its width on punctuation.

A value containing whitespace is quoted (`dir="C:\Program Files\app"`) so the
pairs stay separable; nothing else is escaped. Nested objects and arrays fall
back to compact JSON, which is what they are.

When the pairs would run past the edge of your terminal, they fold onto a
continuation line indented under the message instead:

```text
07:02:37.464 INFO  [FLOW]   Compiled 0 page(s), 0 from cache, 3 bind-injected, 8 using runtime
                              ↳ compiled=0 cached=0 injected=3 runtime=8 ms=82
07:02:37.469 INFO  [ROUTER]   Registered 2 static asset routes dir=C:\Projects\app\public
```

A short bag stays on the message line — one event reading as one line is worth
keeping. A long one is laid out here rather than left to the terminal, which
would break it mid-pair at whatever column it ran out of room and bury the
message it belongs to. Lines are filled greedily with whole pairs, so a
`key=value` is never split across two of them, and only the first continuation
carries the `↳`. The width comes from the terminal; piped or redirected output
assumes a page.

This applies to the console only. File and JSON channels are unchanged — they
write the full `LogEntry` as one JSON line, which is what a collector wants.

## Tables: structured data you can actually read

Past three or four keys, inline context stops being readable — `{"compiled":0,"cached":0,"injected":3,"runtime":8,"ms":124}`
is a wall the eye slides off. `table()` logs the same data and asks the console
to draw it in columns:

```ts fragment
Log.table("Compile summary", { compiled: 0, cached: 2, injected: 3, runtime: 8, ms: 124 });
```

```text
02:03:19.263 INFO  [FLOW]   Compile summary
  ┌──────────┬─────┐
  │ compiled │   0 │
  │ cached   │   2 │
  │ injected │   3 │
  │ runtime  │   8 │
  │ ms       │ 124 │
  └──────────┴─────┘
```

Pass a list of objects instead and each key becomes a column, with a header. A
third argument sets the level, which defaults to `info`:

```ts fragment
Log.table(
  "Pages rendering through the runtime",
  [
    { page: "ListsPage", blocker: "<Demo> is a component", at: "lists.tsx:83:10" },
    { page: "IndexPage", blocker: "key={d.href} is not static", at: "index.tsx:96:15" },
  ],
  "warn",
);
```

```text
02:03:19.263 WARN  [FLOW]   Pages rendering through the runtime
  ┌───────────┬────────────────────────────┬─────────────────┐
  │ page      │ blocker                    │ at              │
  ├───────────┼────────────────────────────┼─────────────────┤
  │ ListsPage │ <Demo> is a component      │ lists.tsx:83:10 │
  │ IndexPage │ key={d.href} is not static │ index.tsx:96:15 │
  └───────────┴────────────────────────────┴─────────────────┘
```

Numeric columns right-align so digits line up, a row missing a key gets a blank
cell rather than shifting the table, and an over-long cell is truncated instead
of wrapping into noise. Strings render literally, so a Windows path reads as
`C:\Projects\app\public` rather than the double-escaped form `JSON.stringify`
produces.

The table is presentation only. The rows are ordinary context, so a `daily` or
`single` channel writes exactly what any other level method would have written —
a list ends up under a `rows` key — and a JSON collector never sees a box-drawing
character. `renderTable(data)` is exported if you want the same lines somewhere
other than a log.

## Log entry shape

Every structured entry written by any channel has this shape:

```ts
// zerotal/logger — LogEntry
interface LogEntry {
  level: "debug" | "info" | "warn" | "error" | "fatal";
  channel: string;
  scope?: string; // subsystem tag, e.g. "app", "flow", "queue"
  display?: "table"; // rendering hint for human-facing channels; ignored by JSON
  message: string;
  timestamp: string; // ISO 8601
  app?: string;
  env?: string;
  hostname: string;
  pid: number;
  requestId?: string; // set automatically inside HTTP requests
  context?: Record<string, unknown>;
  error?: string;
  stack?: string;
}
```

`requestId` is populated automatically when the log call is made within a request
context (i.e. inside a middleware or controller) — no manual threading required.

## Log levels

Entries below a channel's configured `level` are silently dropped (a channel with
no `level` defaults to `debug`, letting everything through):

| Level   | Numeric | Typical use                                            |
| ------- | ------- | ------------------------------------------------------ |
| `debug` | 0       | Verbose diagnostic detail; development only            |
| `info`  | 1       | Normal operational events                              |
| `warn`  | 2       | Recoverable issues, rate-limit proximity, slow queries |
| `error` | 3       | Caught exceptions, request errors                      |
| `fatal` | 4       | Unrecoverable failures, process about to exit          |

## HTTP access logging

`LoggerMiddleware` is registered automatically by `LogProvider`. It times every
request, sets an `X-Request-Id` response header, and emits one line per request.
By default it writes a coloured text line straight to `process.stdout`:

```text
  GET     /posts ......................................... 200    42ms
```

Set the format to `json` (via the `LOG_FORMAT` env var) to route the entry through
the configured `LogManager` channels instead, at `info`/`warn`/`error` by status:

```bash
# in your project root
LOG_FORMAT=json bun run start
```

> **Note** — In text mode the access line goes directly to stdout, not through the
> default channel. Use `LOG_FORMAT=json` when you want request lines persisted to
> your file/daily channels. To drop access logging entirely, omit `LogProvider`
> and register your own middleware.

## Automatic framework signals

Once `LogProvider.onBooted()` runs, it subscribes to the
[FrameworkEvents](/docs/events) bus and logs these signals automatically:

| Event                   | Level          | Condition                                           |
| ----------------------- | -------------- | --------------------------------------------------- |
| `QueryExecuted`         | `warn`         | Query duration ≥ `slowQueryMs`                      |
| `NPlusOneDetected`      | `warn`         | An N+1 access pattern is detected                   |
| `TransactionRolledBack` | `warn`         | A database transaction is rolled back               |
| `MigrationRan`          | `info`/`error` | A migration completes (or fails)                    |
| `JobRan`                | `warn`/`error` | A queued job is retried (`warn`) or fails (`error`) |
| `MessageFailed`         | `error`        | A mail send fails                                   |
| `TaskRan`               | `info`/`error` | A scheduled task ran (or failed its run)            |
| `TaskFailed`            | `error`        | A scheduled task throws                             |
| `LoginSucceeded`        | `info`         | A user authenticates                                |
| `LoginFailed`           | `warn`         | An authentication attempt fails                     |
| `LoggedOut`             | `info`         | A user logs out                                     |
| `AuthorizationDenied`   | `warn`         | An ability check is denied                          |
| `RequestHandled`        | `warn`/`error` | A request returns a 4xx (`warn`) or 5xx (`error`)   |
| `RequestFailed`         | `error`        | The request pipeline throws                         |

> **Tip** — Requests to internal paths (`/__zerotal/`, `/__flow/`, `/__dev/`)
> are skipped, so the dev tooling doesn't flood your logs.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Asserting on a
log usually means asserting on a side-effect nobody else observes, so the logger
gives you a tap.

**`LogManager.tap()` receives every entry** after enrichment and before it
reaches a channel, and returns an unsubscribe function:

```typescript fragment
// tests/logging/AuditTrail.test.ts
import { test, expect, afterEach } from "bun:test";
import { LogManager, type LogEntry } from "zerotal/logger";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

test("a failed charge is logged with the order id", async () => {
  const entries: LogEntry[] = [];
  stop = LogManager.tap((entry) => entries.push(entry));

  await chargeOrder(order); // fails internally

  const failure = entries.find((e) => e.level === "error");
  expect(failure?.message).toContain("Charge failed");
  expect(failure?.context?.orderId).toBe(order.id);
});
```

**Unsubscribe in `afterEach`, not at the end of the test.** Taps are static and
process-wide, so one left installed keeps collecting entries from every later
test in the run — the array grows, the assertions get slower, and a `find()`
starts matching something from a different test.

**Silence the logger in the suite** so a passing run stays readable. The `null`
driver discards everything:

```typescript fragment
// tests/helpers.ts
.useConfig({
  logging: { default: "null", channels: { null: { driver: "null" } } },
})
```

The tap still fires with `null` as the default channel — it runs before the
channel write — so you get quiet output and assertable logs at the same time.

> **Note** — Assert on `entry.context` rather than on the formatted message.
> The message is prose and will be reworded; the context is structured data and
> is what a log search actually queries.

## References

`Log` and every `BoundLogger` returned by `channel()`/`withContext()` share the
same surface:

| Method        | Signature                                                                     | Description                                                      |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `debug`       | `(message: string, context?: Record<string, unknown>, err?: unknown) => void` | Write a `debug`-level entry to the bound channel.                |
| `info`        | `(message: string, context?: Record<string, unknown>, err?: unknown) => void` | Write an `info`-level entry.                                     |
| `warn`        | `(message: string, context?: Record<string, unknown>, err?: unknown) => void` | Write a `warn`-level entry.                                      |
| `error`       | `(message: string, context?: Record<string, unknown>, err?: unknown) => void` | Write an `error`-level entry.                                    |
| `fatal`       | `(message: string, context?: Record<string, unknown>, err?: unknown) => void` | Write a `fatal`-level entry.                                     |
| `channel`     | `(name: string) => BoundLogger`                                               | Bind a logger to a specific channel (`Log` only).                |
| `withContext` | `(extra: Record<string, unknown>) => BoundLogger`                             | Bind a logger that merges `extra` into every entry (`Log` only). |

## Next steps

- [Events](/docs/events) — the FrameworkEvents bus the logger subscribes to.
- [DevTools](/docs/devtools) — per-request log capture in the debug panel.
- [Commands](/docs/commands) — using `Log` inside scheduled commands.
- [Telemetry](/docs/telemetry) — distributed tracing alongside structured logs.
