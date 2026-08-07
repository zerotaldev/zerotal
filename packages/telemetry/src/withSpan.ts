import type { Span } from "./Span.ts";
import { NoopSpan } from "./Span.ts";
import type { SpanOptions } from "./Tracer.ts";

// Module-level tracer reference — set by TelemetryProvider on boot.
let _globalTracer: import("./Tracer.ts").Tracer | undefined;

/** @internal — called by TelemetryProvider */
export function _setGlobalTracer(tracer: import("./Tracer.ts").Tracer | undefined): void {
  _globalTracer = tracer;
}

/** @internal — exposed for testing */
export function _getGlobalTracer(): import("./Tracer.ts").Tracer | undefined {
  return _globalTracer;
}

/**
 * Runs `fn` inside a named span using the global tracer registered by
 * `TelemetryProvider`. If no tracer is registered the callback runs normally
 * and receives a no-op span — no error is thrown.
 *
 * @example
 * import { withSpan } from '@zerotal/telemetry';
 *
 * async function processOrder(id: string) {
 *   return withSpan('process-order', async (span) => {
 *     span.setAttribute('order.id', id);
 *     // ...
 *   });
 * }
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  if (_globalTracer) {
    return _globalTracer.withSpan(name, fn, options);
  }
  // No tracer — run the callback with a no-op span so call sites are always safe
  return fn(new NoopSpan());
}
