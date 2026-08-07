---
title: DevTools
description: See per-request SQL, logs, mail, cache, and jobs in a live in-browser debug panel during development.
---

# DevTools

`@zerotal/devtools` records a trace of every request — SQL queries, N+1
warnings, console logs, mail previews, cache operations, queued jobs, and
whatever else your installed packages contribute — and streams them to a floating
panel in your browser. No browser extension needed: in development the panel is
injected for you, and it connects over Server-Sent Events.

`DevtoolsProvider` is gated to the `web` environment and is a no-op when
`APP_ENV=production` or `APP_ENV=prod`.

## Getting Started

```bash
# in your project root
bun add @zerotal/devtools
```

## Register the provider

Add `DevtoolsProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { DatabaseProvider } from "@zerotal/orm";
import { DevtoolsProvider } from "@zerotal/devtools";

const providers = [
  // …your other providers
  DatabaseProvider,
  DevtoolsProvider,
];

export default providers;
```

The provider declares `static environments = ["web"]`, so it only activates for
web requests. Within that, registering it switches on the following hooks (in
lifecycle order, all of them additionally short-circuited in production):

- `onBooting` — builds the trace store from your [config](#configuration), binds
  `devtools.trace` so other packages can contribute, and registers
  `DevtoolsInjectionMiddleware` via `app.useOnce()`, so you never add it to
  `.use([…])` manually. The middleware serves the panel's API endpoints (see
  [Endpoints](#endpoints)).
- `onBooted` — subscribes to [`FrameworkEvents`](/docs/events) for tracing,
  patches `console.*` to capture logs per request, opens the SSE bridge, then
  prints the inspector banner.
- `onStopping` — unsubscribes, restores the original `console.*` methods, drops
  the declared channels, and closes the trace store.

> **Note** — Nothing happens at import time. The trace store opens its database
> on first use rather than in a constructor, so importing this package in an app
> that runs in production writes nothing and starts no timer. N+1 detection
> itself is owned by the [ORM](/docs/orm/index) provider (and env-gated there);
> DevTools only consumes the `NPlusOneDetected` event and surfaces it.

## Start the client panel

In your frontend entry (`resources/js/app.js`), import and start the client:

```typescript
// resources/js/app.js
import { DevTools } from "@zerotal/devtools/client";

DevTools.start();
```

This connects to the SSE stream and mounts the floating panel at the bottom of
the page. Press `Alt+D` (or `Cmd+D` on Mac) to toggle it open.

`DevTools.start()` accepts three optional fields:

```typescript
// resources/js/app.js
DevTools.start({ endpoint: "/__zerotal/devtools", mode: "floating" }); // defaults
```

| Field      | Required | Default                 | Description                                                           |
| ---------- | -------- | ----------------------- | --------------------------------------------------------------------- |
| `endpoint` | no       | `"/__zerotal/devtools"` | Base path the client uses for the SSE stream and API routes.          |
| `mode`     | no       | `"floating"`            | `"floating"` pins a collapsible bar; `"standalone"` fills the window. |
| `mount`    | no       | `document.body`         | Element to mount into.                                                |

`"standalone"` is what the inspector dashboard at `/__zerotal/devtools` uses —
same renderers, same tabs, mounted full-window instead of docked.

## The panel

The panel has eight built-in tabs, each focused on a different concern for the
current request, plus a tab for every [channel](#contributing-a-tab) an installed
package declares. New traces stream in live; click any row in the **All** tab to
pin an older request and inspect it across every tab.

The floating panel and the standalone dashboard at `/__zerotal/devtools` are the
same panel — the dashboard is it mounted full-window. A tab added by any package
therefore appears in both.

### Queries tab

The default tab — shows an overview of the request followed by every SQL query
executed:

- Route pattern + `Controller@action`
- Duration, query count, total DB time, heap memory, and the authenticated user
- **N+1 warnings** — flagged when the same query shape repeats during a request
- Each query: SQL, bindings, duration bar, row count

### Timeline tab

Everything the request did, on one waterfall: queries, cache operations, mail,
jobs, log lines, and channel entries, each placed by its offset from the request
start and sized by its duration. Every entry already carried that offset — the
waterfall is what makes "what was waiting on what" legible instead of a column of
numbers you have to order in your head.

### Logs tab

Every `console.log`, `.debug`, `.info`, `.warn`, and `.error` call captured
during the request, with an offset timestamp and level colour-coding.

### Request tab

The raw request context: query string parameters and a filtered set of request
headers (only a safe allow-list is kept — auth and cookie headers are dropped).

### Mail tab

Every mail notification sent or queued during the request — notification class
name, recipients, subject, send time, and queued/sent status.

### Cache tab

Every cache operation performed during the request — `has`, `hit`, `miss`,
`write`, `forget`, and `flush` — with the key, operation type, TTL, and offset
timestamp.

### Jobs tab

Every job dispatched (or processed synchronously) during the request — class
name, queue, status (`dispatched` / `completed` / `failed`), duration, and any
error message.

### Channel tabs

One tab per channel an installed package declares — **Auth** from
[`@zerotal/auth`](/docs/authentication), **Flow** from
[`@zerotal/flow`](/docs/flow), and any your own packages add. Rows are
rendered from the channel's own descriptor, so the tab exists without DevTools
shipping code for it. See [Contributing a tab](#contributing-a-tab).

### All tab

The full request history for the current session, with a filter box. Terms
narrow rather than widen, so `posts 500` finds failing requests to `/posts`; the
filter matches method, path, status code, and the matched route's pattern,
controller, and action. Click any row to pin that request's trace in all other
tabs.

## How traces are captured

DevTools never polls or wraps your code. On boot it subscribes to
[`FrameworkEvents`](/docs/events) and buffers each event against the active
request context until the request finishes:

```text
QueryExecuted ────┐
NPlusOneDetected ─┤
MessageSent ──────┤   per-request buffer (WeakMap keyed by HttpContext)
CacheQueried ─────┤        │
JobRan ───────────┤        │ RequestHandled / RequestFailed
channel entries ──┤        │
console.* ────────┘        ▼
                     RequestTrace → traceStore().push()
                               │
                               ▼  SSE
                         browser panel
```

Buffers are keyed by the `HttpContext` in a `WeakMap`, so they are garbage
collected with the request and capture events even from phases that run before
the middleware (such as auth loading the user). Internal framework paths
(`/__zerotal/`, `/__flow/`, `/__dev/`) are skipped so the panel only shows your
own traffic.

DevTools imports no feature package. Each one owns its own bridge — it resolves
`devtools.trace` from the container, and does nothing when devtools is not
installed — so adding or removing a package changes nothing here.

## Configuration

Publish `config/devtools.ts` when you want to change the defaults:

```typescript
// config/devtools.ts
import { DevtoolsConfig } from "@zerotal/devtools";

export default DevtoolsConfig({
  capacity: 250,
  redact: { allow: ["email", "slug"] },
});
```

| Option       | Type               | Default                    | Purpose                                           |
| ------------ | ------------------ | -------------------------- | ------------------------------------------------- |
| `capacity`   | `number`           | `100`                      | Traces kept in memory and reloaded on start.      |
| `dbPath`     | `string \| null`   | `.zerotal/devtools.sqlite` | History file. `null` keeps traces in memory only. |
| `pruneHours` | `number`           | `24`                       | How long a persisted trace survives.              |
| `redact`     | `RedactionOptions` | `{ enabled: true }`        | Whether query bindings are masked. See below.     |

`ZT_DEVTOOLS_DB` and `ZT_DEVTOOLS_PRUNE_HOURS` still set `dbPath` and
`pruneHours` when no config file is present.

### Redacted bindings

A trace does not stay on screen: it streams to the browser **and** is written to
`.zerotal/devtools.sqlite`, where it sits for a day. Bindings are the request's
real values — the password on a registration, a reset token, every customer email
a listing selects by. So they are masked by default:

```text
SELECT * FROM users WHERE email = ‹redacted› AND id = 42
```

Each binding is attributed to the column it sets or compares, and masked when
that column looks sensitive (`password`, `token`, `secret`, `session`, …, matched
as substrings). `id` and the timestamp columns are always shown, so a trace stays
readable. A binding that cannot be attributed to a column is masked — guessing
the other way is what writes a password to disk.

Open individual columns back up, close extra ones, or turn it off entirely:

```typescript
// config/devtools.ts
export default DevtoolsConfig({
  redact: {
    allow: ["email"], // show these in full
    deny: ["nickname"], // mask these too
    // enabled: false,   // show every binding — only when nothing sensitive is in the DB
  },
});
```

## Endpoints

`DevtoolsInjectionMiddleware` serves these paths directly (it short-circuits the
request before it reaches your routes). They exist only when the middleware is
registered — which the provider skips entirely in production:

| Path                               | Method | Description                                        |
| ---------------------------------- | ------ | -------------------------------------------------- |
| `/__zerotal/devtools`              | `GET`  | Standalone inspector dashboard (opens in new tab)  |
| `/__zerotal/devtools/client.js`    | `GET`  | The injected floating-panel bundle                 |
| `/__zerotal/devtools/dashboard.js` | `GET`  | The same panel, mounted full-window                |
| `/__zerotal/devtools/sse`          | `GET`  | Server-sent events stream — `EventSource` endpoint |
| `/__zerotal/devtools/api/traces`   | `GET`  | Recent request traces (JSON)                       |
| `/__zerotal/devtools/api/channels` | `GET`  | Declared trace channels (JSON)                     |
| `/__zerotal/devtools/api/clear`    | `POST` | Clear all stored traces                            |

> **Danger** — These endpoints expose request headers, SQL, and rendered mail.
> Keep `APP_ENV=production` (or `prod`) in any deployed environment so the
> provider never registers the middleware and the paths stay unreachable.

## Reading traces programmatically

The same in-memory store that feeds the panel is reachable as `traceStore()`, so
you can read traces or react to new ones for custom metrics:

```typescript
// in a script or provider
import { traceStore } from "@zerotal/devtools";

// All traces stored in memory (up to 100, most recent first)
const traces = traceStore().all();

// Find slow requests
const slow = traces.filter((t) => t.durationMs > 500);

// Find requests with N+1 warnings
const nplus = traces.filter((t) => t.warnings.length > 0);

// Subscribe to new traces (e.g. for custom metrics)
const unsub = traceStore().subscribe((trace) => {
  if (trace === null) return; // 'clear' event
  console.log(
    `[trace] ${trace.method} ${trace.path} → ${trace.statusCode} (${trace.durationMs}ms)`,
  );
});

// Unsubscribe when done
unsub();

// Clear all stored traces (memory + SQLite)
traceStore().clear();
```

Traces are persisted to `.zerotal/devtools.sqlite` and loaded on restart. Two
environment variables tune persistence:

```ini
# .env
ZT_DEVTOOLS_DB=.data/devtools.sqlite   # default: .zerotal/devtools.sqlite
ZT_DEVTOOLS_PRUNE_HOURS=48             # default: 24
```

> **Note** — If `bun:sqlite` is unavailable, the store degrades silently to
> memory-only: traces still appear in the panel but are not persisted across
> restarts.

## Disabling in staging

`DevtoolsProvider` checks `APP_ENV` on every boot hook. To disable it in a
non-production environment without removing it from `bootstrap/providers.ts`,
set the env to a production value:

```ini
# .env.staging
APP_ENV=production
```

Or conditionally omit the provider entirely:

```typescript
// bootstrap/providers.ts
import type { ServiceProvider } from "zerotal";
import { DatabaseProvider } from "@zerotal/orm";
import { DevtoolsProvider } from "@zerotal/devtools";

const providers: ServiceProvider[] = [DatabaseProvider];
if (Bun.env.APP_ENV !== "production") providers.push(DevtoolsProvider);

export default providers;
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). Devtools is
development-only tooling, so the tests worth writing are about it staying out of
the way — not about the panel itself.

**Assert it never reaches production.** This is the one that matters: the
injection middleware appends a script tag to every HTML response, and a
misconfigured deploy that ships it exposes request traces to your users:

```typescript
// tests/devtools/injection.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("the devtools script is not injected outside development", async () => {
  const app = await createApp(); // helpers boot with env: "test"

  const res = await app.get("/");

  res.assertDontSee("__devtools");
  await app.close();
});
```

**Assert it does not touch non-HTML responses.** A middleware that appends markup
to a JSON body or a file download corrupts it, and the failure shows up as a
parse error somewhere unrelated:

```typescript
// tests/devtools/injection.test.ts
test("JSON responses are left alone", async () => {
  const res = await app.get("/api/posts", { Accept: "application/json" });

  res.assertHeader("Content-Type", "application/json");
  res.assertDontSee("<script");
});
```

**The trace store is an ordinary object**, so a panel plugin you write tests
without a browser:

```typescript
// tests/devtools/plugin.test.ts
import { traceStore } from "@zerotal/devtools";

traceStore().clear();
await app.get("/posts");

expect(traceStore().all()).not.toHaveLength(0);
```

> **Note** — If your suite boots with `env: "test"` (as the scaffolded
> `tests/helpers.ts` does), devtools is inactive and these assertions pass
> trivially. That is the point — they fail only when someone widens the
> environment check, which is exactly when you want to hear about it.

## References

### `TraceStore`

The in-memory ring of recent traces that backs the panel, reached through
`traceStore()`.

It is a function rather than an exported instance because the store opens a
SQLite file: constructing it at module scope meant importing this package wrote
a database into the working directory of every process that did so, production
included. `traceStore()` builds it on first call, and `DevtoolsProvider`
installs one configured from your `config/devtools.ts`.

| Method          | Signature                                                      | Description                                                                                      |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `all()`         | `all(): RequestTrace[]`                                        | Return all stored traces, most recent first.                                                     |
| `push(trace)`   | `push(trace: RequestTrace): void`                              | Add a trace, persist it, and notify subscribers. Called internally by the tracer.                |
| `clear()`       | `clear(): void`                                                | Empty the in-memory store and delete all rows from the SQLite DB.                                |
| `subscribe(fn)` | `subscribe(fn: (t: RequestTrace \| null) => void): () => void` | Register a callback for every new trace; returns an unsubscribe fn. `fn` gets `null` on `clear`. |
| `dispose()`     | `dispose(): void`                                              | Flush pending writes, stop the timers, and close the database.                                   |

### `TraceSink`

Bound in the container as `devtools.trace`. Resolve it with `tryMake` and guard
the result — it is absent when devtools is not installed or the app is in
production.

| Method                                                                       | Signature                                               | Description                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `channel(descriptor)`                                                        | `(d: TraceChannelDescriptor) => void`                   | Declare a channel so its entries get a tab.      |
| `record(ctx, channel, entry)`                                                | `(ctx: object, channel: string, entry: object) => void` | Record one entry; `offsetMs` is stamped for you. |
| `bufferQuery` / `bufferWarning` / `bufferMail` / `bufferCache` / `bufferJob` | `(ctx, entry) => void`                                  | The five signals with bespoke panels.            |

### `TraceChannelDescriptor`

```typescript
// from @zerotal/devtools
interface TraceChannelDescriptor {
  id: string; // unique — also the key under RequestTrace.channels
  label: string; // tab label
  badge?: string; // entry field shown as the row's leading chip
  title?: string; // entry field shown as the row's main text
  meta?: string[]; // entry fields shown as dim metadata
  warn?: string; // entry field whose truthiness marks the row
  order?: number; // position among channel tabs (default 100)
}
```

### `RequestTrace`

The shape pushed to the store and streamed to the panel:

```typescript
// from @zerotal/devtools
interface RequestTrace {
  id: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  startMs: number;
  durationMs: number;
  queries: QuerySpan[];
  warnings: NPlusOneWarning[];
  memory: number; // heap in use as the request finished, in bytes
  queryParams: Record<string, string>;
  headers: Record<string, string>; // safe headers only (no auth/cookie)
  route: RouteInfo | null;
  auth: AuthInfo | null;
  logs: LogEntry[];
  mail: MailEntry[];
  cache: CacheEntry[];
  jobs: JobEntry[];
  /** Entries recorded on open channels, keyed by channel id. */
  channels: Record<string, TraceChannelEntry[]>;
}

interface QuerySpan {
  sql: string;
  bindings: unknown[]; // masked unless the column is allow-listed
  startMs: number;
  durationMs: number;
  rowCount: number;
}

interface NPlusOneWarning {
  sql: string;
  count: number;
}

interface RouteInfo {
  pattern: string;
  controller: string;
  action: string;
}

interface AuthInfo {
  id: unknown;
  name?: unknown;
  email?: unknown;
}

interface LogEntry {
  level: "log" | "debug" | "info" | "warn" | "error";
  args: string[];
  offsetMs: number;
}

interface MailEntry {
  className: string;
  to: string[];
  subject: string;
  html: string;
  durationMs: number;
  queued: boolean;
  offsetMs: number;
}

interface CacheEntry {
  op: "has" | "hit" | "miss" | "write" | "forget" | "flush";
  key: string;
  ttl?: number;
  durationMs: number;
  offsetMs: number;
}

interface JobEntry {
  className: string;
  queue: string;
  status: "dispatched" | "completed" | "failed";
  durationMs: number;
  error?: string;
  offsetMs: number;
}
```

## Contributing a tab

The panel is a **unified dev tool**: any package can add its own tab, and there
are two ways in depending on where the data lives.

- **The data is per-request, and the server has it** — a query, a dispatch, an
  authorization decision. Declare a **channel** and record against the request
  context. DevTools renders the rows for you, and they show up in the Timeline
  waterfall too. This is the usual case.
- **The data only exists in the browser** — a client-side store, a WebSocket
  frame log. Register a **panel plugin** and render it yourself. This is how
  `@zerotal/flow` contributes its
  [time-travel Timeline](/docs/flow/performance#time-travel-devtools).

### Channels — server-side data

Resolve `devtools.trace` from the container, declare how your entries should
read, then record one per event. Guard the lookup: it is absent when devtools is
not installed or the app is in production, and your package must not care.

```typescript
// your-package/src/observability.ts
import { FrameworkEvents, RequestContext } from "zerotal";
import type { Application } from "zerotal";

interface DevtoolsSink {
  channel(descriptor: {
    id: string;
    label: string;
    badge?: string;
    title?: string;
    meta?: string[];
    warn?: string;
    order?: number;
  }): void;
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
}

export function installWidgetObservability(app: Application): () => void {
  const trace = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (!trace) return () => {};

  trace.channel({
    id: "widgets",
    label: "Widgets",
    badge: "op", // leading chip on each row
    title: "name", // the row's main text
    meta: ["durationMs"], // dim metadata beneath it
    warn: "failed", // a truthy value here marks the row and the tab badge
    order: 40, // position among channel tabs
  });

  return FrameworkEvents.on(WidgetRendered, (e) => {
    const ctx = RequestContext.tryGet();
    if (ctx) trace.record(ctx, "widgets", { op: "render", name: e.name, durationMs: e.ms });
  });
}
```

The descriptor crosses the wire to the browser, so it names _fields_ rather than
carrying formatter functions — that is what lets DevTools render a tab for a
package it has never heard of. `offsetMs` is stamped for you, and an entry with a
`durationMs` gets a bar in the Timeline.

Declaring is idempotent and order-independent: re-declaring an id replaces it,
and entries recorded before a channel is declared still appear once it is.

### Panel plugins — browser-side data

From your package's **browser** code, register a panel on the global registry the
panel exposes:

```ts
window.__zerotalDevtools?.register({
  id: "my-panel", // unique — the tab is addressed internally as `plugin:my-panel`
  title: "My Panel", // tab label
  badge: () => items.length || undefined, // optional badge (falsy hides it)
  render: (el) => {
    el.innerHTML = `<p class="empty">Nothing yet</p>`; // render into the shared content area
  },
});

// Push a live update — refresh the badge, and re-render if the tab is open:
window.__zerotalDevtools?.refresh("my-panel");
```

Notes:

- **Order-independent.** The registry is created by whichever runs first (the panel or an extension), so you can register before or after the panel mounts — a late registration (e.g. after a WebSocket connects) adds the tab live.
- **Optional-peer friendly.** Guard with `?.` — if `@zerotal/devtools` isn't on the page, `window.__zerotalDevtools` is undefined and your `register` call is simply skipped (fall back to your own UI if you have one).
- **Themed for free.** `render(el)` writes into the panel's Shadow DOM content area, so the devtools CSS classes (`empty`, `dim`, `sec`, `stitle`, `qrow`, `ibtn`, …) and CSS variables (`--purple`, `--muted`, `--card`, …) are available — your tab matches the panel without shipping styles.
- **Event handling.** `el` (the content area) is persistent across renders; set `el.onclick` with a delegated handler (assignment replaces, so it won't stack).

The `DevtoolsPanelPlugin` type is exported from `@zerotal/devtools` for TypeScript consumers.

## Next steps

- [Logger](/docs/logger) — structured logging that surfaces in the Logs tab.
- [Query builder](/docs/query-builder) — the queries DevTools traces and flags for N+1.
- [Events](/docs/events) — the `FrameworkEvents` that DevTools subscribes to.
- [Telemetry](/docs/telemetry) — production-grade metrics once you move past the dev panel.
- [Testing](/docs/testing/index) — assert on requests without the floating panel.
