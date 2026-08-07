# @zerotal/telemetry

> OpenTelemetry-style distributed tracing with zero external SDK dependency.

A self-contained tracer with an OTLP-compatible span model, `AsyncLocalStorage` context propagation, and pluggable exporters. Wrap any operation in `withSpan()` and child spans automatically inherit the parent trace; export to the console, an OTLP endpoint, or a custom exporter.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/telemetry
```

## Setup

Register the provider in `bootstrap/providers.ts`. List it **before** other providers so the global tracer is ready when the rest of the application boots:

```ts
import { TelemetryProvider } from "@zerotal/telemetry";
```

## Usage

`withSpan()` is the primary call-site API. It uses the global tracer; the span is ended, exported, and its status set automatically:

```ts
import { withSpan } from "@zerotal/telemetry";

async function processOrder(id: string) {
  return withSpan("process-order", async (span) => {
    span.setAttribute("order.id", id);
    const order = await Order.findOrFail(id);
    await notifyWarehouse(order);
  });
}
```

Nested `withSpan()` calls automatically become children of the active span; the current span is available anywhere in the async stack:

```ts
import { currentSpan } from "@zerotal/telemetry";

await withSpan("handle-request", async () => {
  await withSpan("validate-input", async () => {
    /* … */
  });
  await withSpan("query-db", async (span) => {
    span.addEvent("db.query", { table: "orders", rows: 5 });
  });
});

const traceId = currentSpan()?.data.traceId;
```

Trace every HTTP request with `TelemetryMiddleware` (register after `LoggerMiddleware`):

```ts
import { TelemetryMiddleware } from "@zerotal/telemetry";

app.use([LoggerMiddleware, TelemetryMiddleware]);
```

For advanced scenarios, create a `Tracer` directly with a chosen exporter:

```ts
import { Tracer, ConsoleExporter } from "@zerotal/telemetry";

const tracer = new Tracer({ exporter: new ConsoleExporter(), minDurationMs: 5 });

await tracer.withSpan("my-op", async (span) => {
  span.setAttribute("foo", "bar");
});
```

## Exports

- `withSpan` — global helper to run a callback inside an auto-managed span.
- `currentSpan` — read the active span anywhere in the async call stack.
- `Span` / `NoopSpan` — span primitives (`setAttribute`, `setAttributes`, `setStatus`, `addEvent`, `recordException`, `end`).
- `SpanContext` — `AsyncLocalStorage`-backed context propagation.
- `Tracer` — create a tracer with `withSpan()` and `startSpan()` for manual lifetime management.
- `TelemetryMiddleware` — creates a `server`-kind root span per HTTP request; `.with({ spanName })` to customize.
- Exporters: `NoopExporter` (default), `ConsoleExporter`, `OtlpExporter` (any OTLP HTTP/JSON backend).
- `TelemetryProvider` — service provider; registers the global tracer.
- `TelemetryConfig` — config factory.
- Types: `SpanData`, `SpanEvent`, `SpanStatus`, `SpanStatusCode`, `SpanKind`, `TracerOptions`, `SpanOptions`, `SpanExporter`, `OtlpExporterOptions`, `TelemetryOptions`, `TelemetryConfigShape`.

## Documentation

- [Telemetry](../../docs/telemetry.md)
