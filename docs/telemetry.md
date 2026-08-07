---
title: Telemetry
description: Trace requests and operations across your app with OTLP-compatible spans and zero SDK dependencies.
---

# Telemetry

Distributed tracing for Zerotal applications: a self-contained tracer with an
OTLP-compatible span model, `AsyncLocalStorage` context propagation, and pluggable
exporters — no OpenTelemetry SDK dependency. Wrap any operation in `withSpan()` and
it becomes a timed, attributed node in a trace.

## Getting Started

```bash
# in your project root
bun add @zerotal/telemetry
```

## Register the provider

Add `TelemetryProvider` to the providers array in `bootstrap/providers.ts`. List it
**before** other providers so the global tracer is ready when the rest of the
application boots:

```typescript
// bootstrap/providers.ts
import { TelemetryProvider } from "@zerotal/telemetry";
import { DatabaseProvider } from "@zerotal/orm";

const providers = [
  TelemetryProvider,
  DatabaseProvider,
  // …your other providers
];

export default providers;
```

Registering the provider switches on the following hooks (in lifecycle order):

- `onRegister` — binds the `Tracer` as a lazy singleton under the `telemetry`
  container key, built from `config/telemetry.ts`.
- `onBooted` — resolves that tracer and installs it as the global tracer used by
  `withSpan()` and `currentSpan()`.
- `onStopping` — shuts the tracer down (flushing the exporter) and clears the
  global reference, so nothing leaks between boots or test suites.

> **Note** — The provider is active in the `web`, `console`, `test`, and `repl`
> environments. Until `onBooted` runs, `withSpan()` falls back to a no-op span, so
> early call sites never throw.

## Configuration

Create `config/telemetry.ts`. Use the `TelemetryConfig()` helper (or `satisfies
TelemetryConfigShape`) so every field stays type-checked. The `otlp` block is only
read when `exporter` is `'otlp'`:

```typescript
// config/telemetry.ts
import { TelemetryConfig } from "@zerotal/telemetry";
import { env } from "zerotal";

export default TelemetryConfig({
  exporter: "noop", // 'noop' | 'console' | 'otlp'
  serviceName: env("APP_NAME", "zerotal-app"),
  serviceVersion: env("APP_VERSION", "0.0.0"),
  minDurationMs: 0, // drop spans shorter than this (0 = keep all)

  // Only used when exporter is 'otlp':
  otlp: {
    endpoint: env("OTLP_ENDPOINT", "http://localhost:4318/v1/traces"),
    headers: { "x-honeycomb-team": env("HONEYCOMB_API_KEY", "") },
  },
});
```

| Field            | Required | Default                             | Description                                                        |
| ---------------- | -------- | ----------------------------------- | ------------------------------------------------------------------ |
| `exporter`       | no       | `'noop'`                            | Where spans go: `'noop'`, `'console'`, or `'otlp'`.                |
| `serviceName`    | no       | `'zerotal-app'`                     | Service name sent as a resource attribute.                         |
| `serviceVersion` | no       | `'0.0.0'`                           | Service version sent as a resource attribute.                      |
| `minDurationMs`  | no       | `0`                                 | Drop spans whose callback ran for fewer ms than this (`0` = keep). |
| `otlp.endpoint`  | no       | `'http://localhost:4318/v1/traces'` | OTLP HTTP/JSON endpoint. Only read when `exporter` is `'otlp'`.    |
| `otlp.headers`   | no       | `{}`                                | Extra request headers, e.g. an API key.                            |

### Which exporter should I use?

- **`noop`** — production default until you wire up a backend, and the value in
  tests. Spans are created but discarded, so call sites stay cheap.
- **`console`** — local development. Prints readable span data to stdout so you can
  see traces without a collector.
- **`otlp`** — staging and production. Ships spans to any OTLP HTTP/JSON backend
  (Honeycomb, Grafana Tempo, Jaeger, an OpenTelemetry Collector, …).

## Basic usage

`withSpan()` is the primary call-site API. It uses the global tracer registered by
`TelemetryProvider`; if no tracer is registered the callback still runs with a no-op
span — no error is thrown, no import guard needed.

```typescript
// in a service or controller
import { withSpan } from "@zerotal/telemetry";

async function processOrder(id: string) {
  return withSpan("process-order", async (span) => {
    span.setAttribute("order.id", id);
    span.setAttribute("order.source", "web");

    const order = await Order.findOrFail(id);
    await notifyWarehouse(order);
  });
}
```

The span is automatically:

- Ended when the callback resolves or throws.
- Exported to the configured backend.
- Set to `status: ok` on success.
- Set to `status: error` with an exception event on throw (the error is re-thrown).

Pass `kind` and initial `attributes` as a third options argument:

```typescript
// in a service
await withSpan(
  "http.outbound",
  async (span) => {
    /* … */
  },
  { kind: "client", attributes: { "http.method": "POST" } },
);
```

## Working with spans

The `Span` passed to your callback is fluent — every mutator returns the span.

### Attributes

Attribute values must be `string | number | boolean`.

```typescript
// inside a withSpan() callback
span.setAttribute("db.table", "orders"); // single
span.setAttributes({ "db.rows": 5, "cache.hit": true }); // batch
```

### Status

The default status is `'unset'`; the exporter treats it the same as `'ok'`.
`setStatus()` accepts only `'ok'` or `'error'`:

```typescript
// inside a withSpan() callback
span.setStatus("ok");
span.setStatus("error", "payment gateway timeout");
```

### Events

Events are timestamped log lines attached to a span — useful for recording
significant moments inside a long operation.

```typescript
// inside a withSpan() callback
span.addEvent("cache.miss");
span.addEvent("db.query", { table: "orders", rows: 5 });
```

### Recording exceptions

`recordException()` adds an `exception` event carrying the error's type, message,
and stack:

```typescript
// inside a withSpan() callback
try {
  await chargeCard(amount);
} catch (err) {
  span.recordException(err as Error);
  span.setStatus("error", (err as Error).message);
  throw err;
}
```

> **Tip** — `withSpan()` already records the exception and sets `error` status when
> your callback throws. Only call `recordException()` yourself when you catch and
> swallow the error inside the callback.

## Context propagation

Child spans created inside a `withSpan()` callback automatically inherit the parent
trace ID and attach as children — no manual wiring. Context flows through the async
call stack via `AsyncLocalStorage`.

```typescript
// in a request handler
await withSpan("handle-request", async () => {
  // These nested spans automatically become children:
  await withSpan("validate-input", async () => {
    /* … */
  });
  await withSpan("query-db", async () => {
    /* … */
  });
  await withSpan("render-response", async () => {
    /* … */
  });
});
```

The active span is reachable anywhere in the async stack via `currentSpan()`, which
returns `undefined` when no span is active:

```typescript
// in any helper called within a span
import { currentSpan } from "@zerotal/telemetry";

function logWithTrace(message: string) {
  const span = currentSpan();
  console.log({ message, traceId: span?.data.traceId });
}
```

## Observability model — one substrate, many readers

Zerotal has a single source of truth for "what happened and how long it took": the
[`FrameworkEvents`](/docs/events) bus in core. Every subsystem emits timed events
there — `RequestHandled`, `QueryExecuted`, `JobRan`, `TaskRan`, and the
once-per-boot `AppBooted` (which carries the wall-clock boot time, also surfaced in
the [Health](/docs/health) report's `app.bootMs`). The [devtools panel](/docs/devtools)
and the admin Health page read those events directly; core's `HttpMetrics` rolls
them into aggregate p95/throughput.

Telemetry is a **reader** of that substrate, not a parallel one. When
`TelemetryProvider` boots it installs an event bridge that translates each timed
event into a completed span and exports it to your OTLP backend — so external
tracing shows the same signal the panel does, with no extra instrumentation. Core
never depends on telemetry; telemetry subscribes to core. You can install the bridge
manually onto any tracer:

```typescript
import { installEventBridge } from "@zerotal/telemetry";

const dispose = installEventBridge(tracer); // returns an unsubscribe fn
```

Spans you create yourself with `withSpan()` (below) compose on top of this — use them
to trace work that _isn't_ already a framework event.

## Tracing HTTP requests

`TelemetryMiddleware` creates a `server`-kind root span for every incoming HTTP
request. Register it near the top of the middleware stack, after
`LoggerMiddleware`:

```typescript
// bootstrap/middleware.ts (or where the stack is declared)
import { TelemetryMiddleware } from "@zerotal/telemetry";

app.use([
  LoggerMiddleware,
  TelemetryMiddleware,
  /* … */
]);
```

Attributes set automatically:

| Attribute          | Source                                          |
| ------------------ | ----------------------------------------------- |
| `http.method`      | Uppercased request method, e.g. `'GET'`         |
| `http.url`         | `http.url.href`                                 |
| `http.request_id`  | `http.requestId`                                |
| `http.status_code` | Response status, set after the handler runs     |
| `http.route`       | Set only if the pathname changed during routing |

A status of `500` or higher sets the span status to `error`. The span name defaults
to `"METHOD /pathname"` (e.g. `"GET /api/users"`). Override it with a custom
function:

```typescript
// where you register the middleware
TelemetryMiddleware.with({
  spanName: (ctx) => `${ctx.request.method} ${ctx.params.route ?? ctx.url.pathname}`,
});
```

Any `withSpan()` calls inside route handlers or downstream middleware automatically
attach to this root span as children.

## Exporters

An exporter decides where completed spans go. Select one with the `exporter` config
field; the provider wires up the matching class for you.

### NoopExporter

Discards all spans. Active when `exporter` is `'noop'` or unset.

### ConsoleExporter

Prints human-readable span data to stdout. Use during development.

```typescript
// config/telemetry.ts
import { TelemetryConfig } from "@zerotal/telemetry";

export default TelemetryConfig({ exporter: "console" });
```

Output:

```text
# stdout
[telemetry] GET /api/users
  trace=a1b2c3d4e5f6a7b8  span=c3d4e5f6  (root)
  status=ok  duration=12ms
  http.method: GET
  http.status_code: 200
```

### OtlpExporter

Sends spans to any OTLP HTTP/JSON endpoint. Compatible backends:

- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) (self-hosted)
- [Honeycomb](https://honeycomb.io)
- [Grafana Tempo](https://grafana.com/oss/tempo/)
- [Jaeger](https://www.jaegertracing.io/)
- Any vendor that accepts OTLP

```typescript
// config/telemetry.ts
import { TelemetryConfig } from "@zerotal/telemetry";

export default TelemetryConfig({
  exporter: "otlp",
  serviceName: "my-api",
  otlp: {
    endpoint: "https://api.honeycomb.io/v1/traces",
    headers: { "x-honeycomb-team": Bun.env.HONEYCOMB_API_KEY ?? "" },
  },
});
```

> **Note** — Export errors (network failures, etc.) are silently swallowed —
> telemetry failures never affect the application. Set `rethrowExportErrors: true`
> on a manual `Tracer` if you need them surfaced (for example, in a test).

## Manual tracer

For advanced scenarios — testing, multi-tracer setups, or libraries — create and
use a `Tracer` instance directly instead of the global one.

```typescript
// in a library or test
import { Tracer, ConsoleExporter } from "@zerotal/telemetry";

const tracer = new Tracer({
  exporter: new ConsoleExporter(),
  minDurationMs: 5, // drop spans shorter than 5 ms
  rethrowExportErrors: false, // swallow exporter errors (default)
});

await tracer.withSpan("my-op", async (span) => {
  span.setAttribute("foo", "bar");
  await doWork();
});
```

### startSpan — manual lifetime management

Use `startSpan()` for fire-and-forget work, or when the span lifetime doesn't map
neatly to a single async function. The caller owns the lifecycle:

```typescript
// in a stream/queue worker
const span = tracer.startSpan("stream-processor", { kind: "consumer" });
span.setAttribute("queue", "orders");

try {
  await processStream(span);
  span.setStatus("ok");
} catch (err) {
  span.recordException(err as Error);
  span.setStatus("error", (err as Error).message);
  throw err;
} finally {
  span.end(); // ends the span — but does NOT export it
}
```

> **Warning** — `startSpan()` does **not** export automatically, and `span.end()`
> only stamps `endMs` — it does not flush to the exporter. Use `startSpan()` for
> attaching to an existing trace or wrapping a `SpanContext.run()`; prefer
> `withSpan()` for the common case, which exports for you.

## Testing

Implement the `SpanExporter` interface to capture spans in memory and assert on
them. The global-tracer setters live on the `withSpan` module and are internal —
import them from the package entry only where they are re-exported, or prefer
passing your `Tracer` explicitly:

```typescript
// in a test
import { Tracer } from "@zerotal/telemetry";
import type { SpanExporter, SpanData } from "@zerotal/telemetry";

class MemoryExporter implements SpanExporter {
  readonly spans: SpanData[] = [];
  async export(span: SpanData) {
    this.spans.push(span);
  }
}

const mem = new MemoryExporter();
const tracer = new Tracer({ exporter: mem });

await tracer.withSpan("test-op", async (span) => {
  span.setAttribute("x", 1);
});

console.log(mem.spans[0]?.name); // 'test-op'
console.log(mem.spans[0]?.attributes["x"]); // 1
```

> **Note** — To exercise the global `withSpan()` helper in a test, register your
> tracer via `TelemetryProvider` on a booted test app rather than reaching for the
> internal global setters.

## References

### withSpan / currentSpan

| Member        | Signature                                                                                      | Description                                                                |
| ------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `withSpan`    | `withSpan<T>(name: string, fn: (span: Span) => Promise<T>, options?: SpanOptions): Promise<T>` | Run `fn` in a span on the global tracer; no-op span if none is registered. |
| `currentSpan` | `currentSpan(): Span \| undefined`                                                             | The active span in the current async context, or `undefined`.              |

### Tracer

| Method      | Signature                                                                              | Description                                                      |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| constructor | `new Tracer(options: TracerOptions)`                                                   | `exporter` required; `minDurationMs`, `rethrowExportErrors` opt. |
| `withSpan`  | `withSpan<T>(name, fn: (span: Span) => Promise<T>, options?: SpanOptions): Promise<T>` | Create, run, end, and export a span around `fn`.                 |
| `startSpan` | `startSpan(name: string, options?: SpanOptions): Span`                                 | Start an un-ended span; caller must call `end()` (no export).    |
| `shutdown`  | `shutdown(): Promise<void>`                                                            | Flush and tear down the exporter.                                |

### Span

| Method             | Signature                                                                 | Description                                         |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------- |
| `setAttribute`     | `setAttribute(key: string, value: string \| number \| boolean): this`     | Set one attribute.                                  |
| `setAttributes`    | `setAttributes(attrs: Record<string, string \| number \| boolean>): this` | Merge a batch of attributes.                        |
| `setStatus`        | `setStatus(code: "ok" \| "error", message?: string): this`                | Set the span status and optional message.           |
| `addEvent`         | `addEvent(name: string, attributes?: Record<string, unknown>): this`      | Append a timestamped event.                         |
| `recordException`  | `recordException(error: Error): this`                                     | Add an `exception` event with type, message, stack. |
| `end`              | `end(): void`                                                             | Stamp `endMs` (idempotent); does not export.        |
| `durationMs` (get) | `durationMs: number`                                                      | Elapsed ms since start (uses now if not yet ended). |
| `isEnded` (get)    | `isEnded: boolean`                                                        | Whether `end()` has been called.                    |

### SpanData

| Field        | Type                                                     | Description                                                              |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `traceId`    | `string`                                                 | 32-char hex — shared by all spans in the same trace.                     |
| `spanId`     | `string`                                                 | 16-char hex — unique to this span.                                       |
| `parentId`   | `string \| undefined`                                    | Parent's `spanId`, or `undefined` for root spans.                        |
| `name`       | `string`                                                 | Operation name.                                                          |
| `kind`       | `SpanKind`                                               | `'internal'` \| `'server'` \| `'client'` \| `'producer'` \| `'consumer'` |
| `startMs`    | `number`                                                 | Unix timestamp (ms) when the span started.                               |
| `endMs`      | `number \| undefined`                                    | Unix timestamp (ms) when the span ended.                                 |
| `attributes` | `Record<string, string \| number \| boolean>`            | Key/value metadata.                                                      |
| `status`     | `{ code: 'unset' \| 'ok' \| 'error'; message?: string }` | Span status.                                                             |
| `events`     | `SpanEvent[]`                                            | Timestamped log lines attached to the span.                              |

### SpanEvent

| Field        | Type                                   |
| ------------ | -------------------------------------- |
| `name`       | `string`                               |
| `timeMs`     | `number`                               |
| `attributes` | `Record<string, unknown> \| undefined` |

### SpanKind

| Value        | Use                                                         |
| ------------ | ----------------------------------------------------------- |
| `'internal'` | Default — intra-process operation.                          |
| `'server'`   | Handling an inbound request (set by `TelemetryMiddleware`). |
| `'client'`   | Outbound HTTP call or DB query.                             |
| `'producer'` | Enqueuing a message.                                        |
| `'consumer'` | Processing a queued message.                                |

## Next steps

- [Logger](/docs/logger) — pair traces with structured logs.
- [Health](/docs/health) — expose readiness and liveness checks.
- [Middleware](/docs/middleware) — where `TelemetryMiddleware` fits in the stack.
- [Queue](/docs/queue) — trace background jobs with producer/consumer spans.
