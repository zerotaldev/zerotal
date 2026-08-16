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

Drag the strip along the panel's top edge to resize it; the height is kept. The
button cycling `◐ ● ○` in the bar switches the theme between following your
system, dark, and light — for when the panel and the page you are debugging
disagree.

### Keyboard

The panel's shortcuts fire **only while the panel has focus** — click it once.
It is an overlay on your application, and binding `j` globally would navigate the
trace list every time you typed into one of your own forms. `Alt+D` is the
exception, because it is how you reach a panel that does not have focus yet.

| Key       | Does                                 |
| --------- | ------------------------------------ |
| `Alt+D`   | Toggle the panel (works anywhere)    |
| `j` / `↓` | Select the next request              |
| `k` / `↑` | Select the previous request          |
| `1`–`9`   | Jump to the nth tab                  |
| `/`       | Open **All** and focus the filter    |
| `Esc`     | Leave the filter, or close the panel |

`j` and `k` step through the _filtered_ list, so narrowing first and stepping
after works the way you would expect.

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

Two sections, switched in the tab strip.

**Requests** is the trace stream — what the app just did. Nine built-in tabs, each
focused on a different concern for the current request, plus a tab for every
[channel](#contributing-a-tab) an installed package declares. New traces stream in
live; click any row in the **All** tab to pin an older request and inspect it
across every tab.

**[App](#the-app-section)** is the framework map — what the app _is_: its routes,
config, container, providers, events, and the commands and scheduled tasks that
have run. Two sections rather than fifteen tabs in one scrolling strip, because
they answer different questions.

The floating panel and the standalone dashboard at `/__zerotal/devtools` are the
same panel — the dashboard is it mounted full-window. A tab added by any package
therefore appears in both.

### Queries tab

The default tab — shows an overview of the request followed by every SQL query
executed:

- Route pattern + `Controller@action`
- **The error**, when the request threw — message and status, above everything
  else, because on a failed request that is the answer
- Duration, query count, total DB time, heap memory, and the authenticated user
- **N+1 warnings** — flagged when the same query shape repeats during a request,
  each with the eager-load that removes it and the call that suppresses it
- Each query: SQL, bindings, duration bar, row count, and **the line of your code
  that ran it** — see [Editor links](#editor-links)

### Timeline tab

Everything the request did, on one waterfall: queries, cache operations, mail,
jobs, log lines, and channel entries, each placed by its offset from the request
start and sized by its duration. Every entry already carried that offset — the
waterfall is what makes "what was waiting on what" legible instead of a column of
numbers you have to order in your head.

Above it, **what the browser measured** for this page load: time to first byte,
parse, load, and first contentful paint. Server duration reported as though it
were the user's experience is a panel's most misleading number — a 12ms response
the browser then spends 900ms painting is a slow page. Kept visibly separate from
the waterfall, because these describe the page and not this request.

### Logs tab

Every `console.log`, `.debug`, `.info`, `.warn`, and `.error` call captured
during the request, with an offset timestamp and level colour-coding.

### Request tab

Both halves of the exchange: the status line, query string parameters, request
headers, response headers, and the **names** of the keys in the session.

Headers are an allowlist rather than a denylist, because a trace is persisted —
a header nobody thought to deny is a header on disk for a day. `devtools.headers`
opens up the ones you are actually debugging; `cookie` and `authorization` are
never recorded whatever you ask for, because they _are_ the request.

Session **keys only**, never values. "Is the CSRF token there, did the flash
survive the redirect, is the user id set" are all answered by the keys, and the
values are this request's real state.

### Exception tab

For a request that threw: the error's type, its message, and the full stack with
every frame a [link into your editor](#editor-links).

Framework frames are kept and dimmed rather than dropped. You read a stack trace
to find out how you got somewhere, and a trace with the middle removed does not
tell you that — but in a forty-frame trace the six you wrote should be the ones
that stand out.

### Mail tab

Every mail notification sent or queued during the request — notification class
name, recipients, subject, send time, and queued/sent status. Each one carries a
**Preview**, collapsed by default, that renders the actual email in a fully
sandboxed frame: no scripts, no same-origin access, no navigation. That is not
optional hardening — the panel lives on your app's own origin, so rendering a
template's markup inline would make any user input inside a mail a self-XSS.

### Cache tab

Every cache operation performed during the request — `has`, `hit`, `miss`,
`write`, `forget`, and `flush` — with the key, operation type, TTL, and offset
timestamp.

### Jobs tab

Every job dispatched (or processed synchronously) during the request — class
name, queue, status (`dispatched` / `completed` / `failed`), duration, and any
error message.

### Channel tabs

One tab per channel an installed package declares — **Inertia** from
[`@zerotal/inertia`](/docs/inertia/devtools), **Auth** from
[`@zerotal/auth`](/docs/authentication), **Flow** from
[`@zerotal/flow`](/docs/flow), and any your own packages add. Each is rendered
from the channel's own descriptor, in whichever
[presentation](#choosing-a-presentation) it asked for, so the tab exists without
DevTools shipping code for it. See [Contributing a tab](#contributing-a-tab).

### All tab

The full request history for the current session, with a filter box and a row of
facet chips. Click any row to pin that request's trace in all other tabs. A
request that threw is marked in red and carries its error message inline, so you
can find the one that broke without opening each in turn.

**Text** narrows rather than widens: `posts 500` finds failing requests to
`/posts`, matching method, path, status code, and the matched route's pattern,
controller, and action.

**Facets** compose with it and with each other. Method chips list only the verbs
actually recorded — an app that only ever GETs gets one chip, not five. Then
`2xx`/`3xx`/`4xx`/`5xx`, and three toggles:

| Chip     | Keeps                                                                 |
| -------- | --------------------------------------------------------------------- |
| `errors` | Requests that threw, plus any `4xx` or `5xx` — a rendered 404 counts. |
| `slow`   | Over 300ms, the same line the duration colouring already draws.       |
| `n+1`    | Requests carrying an N+1 warning.                                     |

Picking two chips in one row means either; picking chips in two rows means both.
`POST` with `5xx` is failing writes, not writes-or-failures.

Above 200 rows the list renders only what the viewport can reach, so a large
`capacity` is a list you can scroll rather than thousands of nodes.

Requests a channel says belong together are folded into one entry under the
oldest of them, with a `+N` toggle to open the rest. One thing you did is often
several requests — a page visit and the deferred props that arrive after it —
and listing them as unrelated siblings is how the request you are reading gets
pushed off the top. Which requests correlate is the channel's to declare; see
[`traceGroup`](#choosing-a-presentation).

The panel remembers where you were — whether it was open, which tab you were on,
and what you had filtered to — across a reload. On a page you are reloading
_because_ you are debugging it, that is the wrong moment to lose your place.

## The App section

Everything above reads the trace stream. These six read the framework's own
registries — which existed all along and were CLI-only or invisible, so "is that
route even registered", "who bound `cache`", and "does anything actually listen
to `OrderPlaced`" were questions you answered by reading source.

| Tab           | Shows                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| **Routes**    | Method, path, name, handler, middleware. GETs are clickable.                     |
| **Config**    | The resolved tree, flattened to dotted paths, secrets masked.                    |
| **Container** | Every binding, its kind, and which provider bound it.                            |
| **Providers** | Boot order — which decides who wins a contested binding — and per-provider cost. |
| **Events**    | Application listeners and framework subscribers, in one list.                    |
| **Commands**  | Console commands and scheduled tasks, with outcome and duration.                 |

All six share one read of one map, taken when you first open the section and
cached after — six requests for it would be six answers that can disagree. The
`↻` button re-reads it, for the case where a provider registered a route late.

> **Note** — The Config tab masks a bare `key` as well as everything the
> [redaction rules](#redaction) already cover, because `app.key` is your
> application's encryption key. `dsn` too. Config is the one place secrets are
> supposed to live, so it gets the benefit of the doubt in the other direction.

**Commands** is the answer to the thing the rest of the panel structurally cannot
show: a scheduled task that fails at 03:00 has no request to hang off, so until
now it left no trace in the tool whose job is to show you what your app did. The
feed keeps the last 200 entries for the life of the process.

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

| Option          | Type                     | Default                    | Purpose                                                      |
| --------------- | ------------------------ | -------------------------- | ------------------------------------------------------------ |
| `enabled`       | `boolean \| null`        | `null`                     | `null` follows the dev-surface gate; `true`/`false` decides. |
| `gate`          | `DevtoolsGate \| null`   | `null`                     | Who may read it outside development. See below.              |
| `capacity`      | `number`                 | `100`                      | Traces kept in memory and reloaded on start.                 |
| `dbPath`        | `string \| null`         | `.zerotal/devtools.sqlite` | History file. `null` keeps traces in memory only.            |
| `pruneHours`    | `number`                 | `24`                       | How long a persisted trace survives.                         |
| `redact`        | `RedactionOptions`       | `{ enabled: true }`        | Whether sensitive values are masked. See below.              |
| `editor`        | `EditorName \| null`     | `"vscode"`                 | Which editor `file:line` links open.                         |
| `editorPathMap` | `Record<string, string>` | `{}`                       | Rewrite captured paths for editing on another machine.       |
| `captureSource` | `boolean`                | `true`                     | Capture the call site of each query and log line.            |
| `headers`       | `string[]`               | `[]`                       | Extra request headers to record. `["*"]` for all.            |

`ZT_DEVTOOLS_DB` and `ZT_DEVTOOLS_PRUNE_HOURS` still set `dbPath` and
`pruneHours` when no config file is present.

### Editor links

Every location the panel shows is a link that opens it: a query's call site, a
log line's, a stack frame. Going from "this query is slow" to the line that ran
it is the most frequent move in a debugging session, and without this it is two
manual searches.

```typescript
// config/devtools.ts
export default DevtoolsConfig({
  editor: "cursor", // vscode | vscode-insiders | cursor | windsurf | zed | webstorm
});
```

Set `editor: null` to render locations as plain text instead.

**Editing on a different machine.** The process recording a trace is often not
the one with your editor on it — a container reports `/app/src/Foo.ts` for a file
that lives at `~/project/src/Foo.ts`. Map it home:

```typescript
export default DevtoolsConfig({
  editorPathMap: { "/app": "/Users/you/project" },
});
```

Longest prefix wins, so a specific mapping can sit inside a general one.

**What it costs.** One stack walk per recorded query and log line, filtered to
application frames. Measured at roughly **two microseconds, flat from stack depth
5 to 80** — the engine builds the trace lazily, so depth barely registers. A
request running forty queries pays about 0.08ms. It is on by default and only
ever runs while the inspector itself is running; `captureSource: false` turns it
off.

A query with no application frame above it — one from a seeder, or from inside a
package — shows no location rather than pointing at a file you did not write.

### Redaction

A trace does not stay on screen: it streams to the browser **and** is written to
`.zerotal/devtools.sqlite`, where it sits for a day. What it carries is the
request's real values — the password on a registration, a reset token, every
customer email a listing selects by. So they are masked by default:

```text
SELECT * FROM users WHERE email = ‹redacted› AND id = 42
```

Masking happens where a value enters the trace, not where the panel draws it.
Redacting in a renderer would protect nothing: by then the unredacted copy is
already on disk. Four things are covered:

| What                              | Matched on                           |
| --------------------------------- | ------------------------------------ |
| **Query bindings**                | the column each one sets or compares |
| **Channel entries**               | each field name, at every depth      |
| **Objects passed to `console.*`** | each field name, at every depth      |
| **Cache keys**                    | each segment of the key              |

One rule decides all four: a name is sensitive when it contains `password`,
`token`, `secret`, `session`, `api_key`, … — matched as substrings, so
`password` covers `password_hash`. `id` and the timestamp columns are always
shown, so a trace stays readable.

Two deliberate choices about the edges. A binding that cannot be attributed to a
column is masked — guessing the other way is what writes a password to disk. And
a cache key keeps its name and loses only what follows it, so `password_reset:9f2c`
records as `password_reset:‹redacted›` and the Cache tab stays legible.

Redaction reads _names_, never contents: a bare string is never inspected for
things that look like secrets. `console.log(user)` is masked field by field;
`console.log("token is abc123")` is recorded as written.

Open individual names back up, close extra ones, or turn it off entirely:

```typescript
// config/devtools.ts
export default DevtoolsConfig({
  redact: {
    allow: ["email"], // show these in full
    deny: ["nickname"], // mask these too
    // enabled: false,   // mask nothing — only when nothing sensitive is in reach
  },
});
```

#### Applying the same rule yourself

The masking functions are exported, so a package contributing its own
[channel](#contributing-a-tab) — or anything else that writes to the trace — can
hold the line the panel holds, using the app's own `allow` and `deny`:

| Function                        | Signature                                                               | Use for                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `redactValue(value, options?)`  | `(value: unknown, o?: RedactionOptions) => unknown`                     | Anything with named fields. Walks deeply, replaces cycles, caps depth.                   |
| `redactCacheKey(key, options?)` | `(key: string, o?: RedactionOptions) => string`                         | A key that welds a name to a value. Keeps the name, masks what follows a sensitive part. |
| `redactBindings(sql, b, o?)`    | `(sql: string, bindings: unknown[], o?: RedactionOptions) => unknown[]` | Query bindings, attributed to their columns via the SQL.                                 |
| `isSensitiveName(name, o?)`     | `(name: string, o?: RedactionOptions) => boolean`                       | The predicate itself, when you need to make the decision rather than apply it.           |

`redactValue` returns a bare scalar unchanged — there is no name to judge it by —
so pass the object, not the field.

All of them run one walk, `redactGraph` from `@zerotal/core/security`, which is
also what the [Inertia recorder](/docs/inertia/devtools) uses. Reach for it
directly when you are recording values somewhere else and need the same three
problems solved — cycles, a depth bound, and values like `Date` or `File` that
read better flat than walked — but want your own markers:

```typescript
import { redactGraph } from "@zerotal/core/security";

const safe = redactGraph(payload, {
  sensitive: (key) => /password|token/i.test(key),
  mask: "[hidden]",
  circular: "[cycle]",
  tooDeep: "[deep]",
  maxDepth: 8,
});
```

Those five fields, plus an optional `flatten` for values you would rather render
than walk, are `RedactGraphOptions`.

It is a traversal, not a policy: the predicate and the markers are yours, because
a debug panel's `‹redacted›` is a display choice while an adapter implementing a
published protocol has its markers specified for it.

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
| `/__zerotal/devtools/api/map`      | `GET`  | The framework map — routes, config, container, …   |
| `/__zerotal/devtools/api/clear`    | `POST` | Clear all stored traces                            |

> **Danger** — These endpoints expose request headers, SQL with its bindings,
> session key names, stack traces, and rendered mail. They are all behind one
> gate: a development process always passes, and anywhere else the absence of a
> `gate` is a refusal. See [Running it outside development](#running-it-outside-development).

## Reading traces programmatically

The same in-memory store that feeds the panel is reachable as `traceStore()`, so
you can read traces or react to new ones for custom metrics:

```typescript
// in a script or provider
import { traceStore } from "@zerotal/devtools";

// All traces stored in memory (up to `capacity`, most recent first)
const traces = traceStore().all();

// Find slow requests
const slow = traces.filter((t) => t.durationMs > 500);

// Find requests with N+1 warnings
const nplus = traces.filter((t) => t.warnings.length > 0);

// Find requests that threw
const failed = traces.filter((t) => t.exception !== null);

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

## Running it outside development

By default the inspector follows the same gate as the stack-trace error page: on
under `zt dev`, off in a deployed process, with nothing to configure. That is the
right default and it was, until recently, the only option — so the way people ran
the inspector on a shared staging box was to lie about `APP_ENV`.

There is now a supported way:

```typescript
// config/devtools.ts
export default DevtoolsConfig({
  enabled: true, // explicit; `null` follows the dev-surface gate
  gate: (request) => request.headers.get("X-Debug-Key") === Bun.env["DEBUG_KEY"],
});
```

Four rules, and they are the point of it:

- **A development process always passes.** A gate that can lock you out of your
  own laptop is a gate that gets switched off, and then nothing is gated.
- **Anywhere else, no gate is a refusal.** An app that turned the inspector on
  outside development without saying who may read it has not made a decision this
  code should make for it. A gate that _throws_ is also a refusal — failing open
  there would turn a typo in an authorization check into an open inspector.
- **One gate answers for everything.** The stream, the trace JSON, the dashboard,
  and the panel bundle expose the same request data. Two gates that can disagree
  is how a dev-only surface ends up serving request headers in production.
- **Refusals are 404, not 403.** Outside development the honest answer to an
  unauthenticated stranger is that there is nothing here.

> **Danger** — Traces contain request headers, SQL with its bindings, session key
> names, stack traces, and rendered mail. Gate accordingly, and prefer
> `enabled: false` to a weak gate.

Auto-injection of the panel script is development-only. On a gated environment
the tag would go into every visitor's HTML and then 404 in their console, so
there the way in is the dashboard at `/__zerotal/devtools`.

To switch it off entirely without removing the provider:

```typescript
// config/devtools.ts
export default DevtoolsConfig({ enabled: false });
```

Or omit the provider:

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
| `capacity`      | `readonly capacity: number`                                    | How many traces this store keeps. Sent to the panel so it trims to the same depth.               |

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

  // Presentation — see below
  render?: "rows" | "tree" | "table" | "kv" | "grouped";
  treeField?: string;
  treeBadge?: string;
  groupBy?: string;
  flags?: string[];
  traceGroup?: string;
}
```

#### Choosing a presentation

A flat list of rows is the right shape for an audit feed and the wrong one for a
prop map or a route table. `render` picks a different one — still declared as
data, so the panel ships no code for your package either way.

| `render`    | Shape                                                     | Also reads               |
| ----------- | --------------------------------------------------------- | ------------------------ |
| `"rows"`    | One block per entry: badge, title, meta. **The default.** | —                        |
| `"tree"`    | A map of dotted paths, drawn as branches and leaves.      | `treeField`, `treeBadge` |
| `"table"`   | One row per entry, `meta` as columns. For many entries.   | —                        |
| `"kv"`      | Every field of every entry. For few entries, many fields. | —                        |
| `"grouped"` | Rows collected under a shared value.                      | `groupBy`                |

Two hints apply to any presentation:

- **`flags`** — fields rendered as a bare chip when truthy. A flag is named by
  its _field_, so `{ shared: true }` reads as **shared** rather than
  `shared: true`, which is how a row ends up saying nothing at a glance. Under
  `"tree"` they apply per node.
- **`traceGroup`** — the field whose value correlates whole _traces_ on the All
  tab. One user action can be several requests; traces sharing a value here fold
  into one expandable entry under the oldest of them, instead of scattering down
  the list and pushing what you were reading off the top.

`"tree"` takes a **flat map of dotted paths**, not a nested object —
`{ "user.name": {…}, "user.email": {…} }` becomes one `user` branch with two
leaves. Each node's own fields become its `treeBadge` chip, its `flags`, and a
dim attribute line, so you describe what a node _is_ without the panel knowing
what any of it means:

```typescript
trace.channel({
  id: "widgets",
  label: "Widgets",
  render: "tree",
  treeField: "nodes", // the entry field holding the path map
  treeBadge: "kind", // each node's leading chip
  flags: ["cached", "stale"], // each node's boolean chips
});

trace.record(ctx, "widgets", {
  nodes: {
    "sidebar.filters": { kind: "list", cached: true },
    "sidebar.tags": { kind: "list", source: "api" },
  },
});
```

Badge chips are accented by hashing their own text, so repeated values keep a
consistent colour and stay tellable apart without the panel holding a list of
every value any package might use.

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
  headers: Record<string, string>; // allowlisted; never auth/cookie
  responseHeaders: Record<string, string>;
  session: string[]; // key names only, never values
  route: RouteInfo | null;
  auth: AuthInfo | null;
  /** The error that ended the request, or null when it completed normally. */
  exception: ExceptionInfo | null;
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
  source?: SourceLocation; // the app line that ran it, when one was found
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
  source?: SourceLocation;
}

interface ExceptionInfo {
  message: string;
  status: number; // the status the rendered error response used
  type?: string; // the error's class name
  frames?: SourceLocation[]; // innermost first, framework frames kept
}

interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
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

### Testing what you contribute

The panel is markup, and markup is awkward to assert on. Everything in it that is
_logic_ is exported from `@zerotal/devtools/client`, so you can check how your
channel's rows will filter, fold, and nest without a browser:

| Export                             | Answers                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `matchesFilter(trace, query)`      | Would this trace survive the filter box?                     |
| `matchesFacets(trace, facets)`     | Would it survive the facet chips?                            |
| `traceMatches(trace, query, f)`    | Both at once — what the All tab actually asks.               |
| `methodsPresent(traces)`           | Which method chips are worth offering.                       |
| `noFacets()` / `facetsActive(f)`   | An empty `Facets` set, and whether one narrows anything.     |
| `SLOW_MS`                          | Where the `slow` chip draws its line, so a test can agree.   |
| `buildPathTree(paths)`             | What tree does my `"tree"` channel's dotted path map become? |
| `traceGroupKey(trace, channels)`   | Which channel field correlates this trace, if any?           |
| `foldTraceRows(matches, ch, open)` | The rows the All tab draws, with correlated requests folded. |

`PathTreeNode` is `{ children: Map<string, PathTreeNode>; attrs: Record<string, unknown> | null }`.
A branch that nothing was recorded against has `attrs: null`, which is
meaningfully different from `{}` — a node can be both a branch and a leaf.

`foldTraceRows` returns a flat `TraceRow[]`, each row carrying its index into the
unfiltered list plus whether it heads a group (`groupKey`, `groupSize`) or is a
folded follow-up (`child`).

## Next steps

- [Logger](/docs/logger) — structured logging that surfaces in the Logs tab.
- [Query builder](/docs/query-builder) — the queries DevTools traces and flags for N+1.
- [Events](/docs/events) — the `FrameworkEvents` that DevTools subscribes to.
- [Telemetry](/docs/telemetry) — production-grade metrics once you move past the dev panel.
- [Testing](/docs/testing/index) — assert on requests without the floating panel.
