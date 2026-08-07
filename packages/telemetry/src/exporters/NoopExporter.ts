import type { SpanExporter } from "./SpanExporter.ts";
import type { SpanData } from "../Span.ts";

/** Discards all spans. Used when telemetry is explicitly disabled. */
export class NoopExporter implements SpanExporter {
  async export(_span: SpanData): Promise<void> {}
}
