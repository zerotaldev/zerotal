// Core primitives
export { Span, NoopSpan, _randomHex } from "./Span.ts";
export type { SpanData, SpanEvent, SpanStatus, SpanStatusCode, SpanKind } from "./Span.ts";

// Context propagation
export { SpanContext, currentSpan } from "./SpanContext.ts";

// Tracer
export { Tracer } from "./Tracer.ts";
export type { TracerOptions, SpanOptions } from "./Tracer.ts";

// Global helper
export { withSpan } from "./withSpan.ts";

// Exporters
export type { SpanExporter } from "./exporters/SpanExporter.ts";
export { NoopExporter } from "./exporters/NoopExporter.ts";
export { ConsoleExporter } from "./exporters/ConsoleExporter.ts";
export { OtlpExporter } from "./exporters/OtlpExporter.ts";
export type { OtlpExporterOptions } from "./exporters/OtlpExporter.ts";

// Middleware
export { TelemetryMiddleware } from "./middleware/TelemetryMiddleware.ts";
export type { TelemetryOptions } from "./middleware/TelemetryMiddleware.ts";

// Provider
export { TelemetryProvider } from "./provider/TelemetryProvider.ts";

// Event → span bridge (FrameworkEvents → trace pipeline)
export { installEventBridge } from "./bridge.ts";

// Config factory + types
export { TelemetryConfig } from "./config.ts";
export type { TelemetryConfigShape } from "./config.ts";
