import { AsyncLocalStorage } from "node:async_hooks";
import type { Span } from "./Span.ts";

interface ActiveContext {
  span: Span;
}

/**
 * Propagates the active span through async call stacks via AsyncLocalStorage.
 * Set by `Tracer.withSpan()`; read by nested `withSpan()` calls to attach
 * child spans to the correct parent.
 */
export const SpanContext = new AsyncLocalStorage<ActiveContext>();

/** Return the currently active span, or `undefined` if none is active. */
export function currentSpan(): Span | undefined {
  return SpanContext.getStore()?.span;
}
