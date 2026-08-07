import type { SpanData } from "../Span.ts";

/** Receives completed spans and sends them to a backend. */
export interface SpanExporter {
  export(span: SpanData): Promise<void>;
  /** Called on graceful shutdown — flush pending spans and close connections. */
  shutdown?(): Promise<void>;
}
