# @zerotal/devtools

> A live, in-page development panel that traces every request — SQL queries, N+1 warnings, logs, mail, cache, and jobs.

`@zerotal/devtools` injects a floating debug panel into every HTML response during development. No browser extension required: it shows per-request traces and exposes a `TraceStore` you can read programmatically. `DevtoolsProvider` is a no-op when `APP_ENV=production` or `APP_ENV=prod`.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/devtools
```

## Setup

### 1. Register the provider

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

`DevtoolsProvider` automatically registers `DevtoolsInjectionMiddleware` — you do not need to add it to `.use([…])` manually.

### 2. Start the client panel

In your frontend entry (e.g. `resources/js/app.js`):

```typescript
import { DevTools } from "@zerotal/devtools/client";
DevTools.start(); // optionally { endpoint: "/__zerotal/devtools" }
```

This connects to the SSE stream and mounts the floating panel. Press `Alt+D` (or `Cmd+D` on Mac) to toggle it.

## Usage

### Read traces programmatically

```typescript
import { traceStore } from "@zerotal/devtools";

// All traces stored in memory (up to 100, most recent first)
const traces = traceStore().all();

// Find slow requests / N+1 offenders
const slow = traces.filter((t) => t.durationMs > 500);
const nplus = traces.filter((t) => t.warnings.length > 0);

// Subscribe to new traces (fn receives null on 'clear')
const unsub = traceStore().subscribe((trace) => {
  if (trace === null) return;
  console.log(`${trace.method} ${trace.path} → ${trace.statusCode} (${trace.durationMs}ms)`);
});
unsub();

traceStore().clear();
```

Traces persist to `.zerotal/devtools.sqlite` and reload on restart. Configure in
`config/devtools.ts`:

```ts
import { DevtoolsConfig } from "@zerotal/devtools";

export default DevtoolsConfig({
  capacity: 250,
  dbPath: ".data/devtools.sqlite", // null keeps traces in memory only
  pruneHours: 48,
  redact: { allow: ["email"] }, // query bindings are masked by default
});
```

`ZT_DEVTOOLS_DB` and `ZT_DEVTOOLS_PRUNE_HOURS` still apply when no config
file is present.

## Exports

The package exposes two subpaths:

### `@zerotal/devtools` (`.`)

| Export                        | Kind             | Description                                                                                                      |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DevtoolsProvider`            | provider         | Registers the injection middleware and internal `/__zerotal/devtools` routes (dev only).                         |
| `DevtoolsInjectionMiddleware` | middleware       | Injects the panel into HTML responses. Type: `DevtoolsInjectionOptions`.                                         |
| `TraceStore`, `traceStore`    | class / accessor | In-memory + SQLite-backed trace store (`all`, `push`, `clear`, `subscribe`, `dispose`).                          |
| `DevtoolsConfig`              | config           | Typed `config/devtools.ts` factory. Type: `DevtoolsConfigShape`.                                                 |
| `traceSink`, `traceChannels`  | sink / registry  | The `devtools.trace` surface other packages contribute through.                                                  |
| `redactBindings`              | function         | Mask the bindings of a statement. Type: `RedactionOptions`.                                                      |
| Trace types                   | types            | `RequestTrace`, `QuerySpan`, `NPlusOneWarning`, `MailEntry`, `CacheEntry`, `JobEntry`, `TraceChannelDescriptor`. |

### `@zerotal/devtools/client` (`./client`)

| Export     | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `DevTools` | Browser-side panel; call `DevTools.start()` from your frontend entry. |

## Documentation

- [DevTools](../../docs/devtools.md)
