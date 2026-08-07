import type { SpanExporter } from "./SpanExporter.ts";
import type { SpanData } from "../Span.ts";

/**
 * Prints completed spans to stdout in a human-readable format.
 * Intended for development and debugging — not for production use.
 *
 * @example
 * new Tracer({ exporter: new ConsoleExporter() })
 */
export class ConsoleExporter implements SpanExporter {
  async export(span: SpanData): Promise<void> {
    const duration = span.endMs !== undefined ? span.endMs - span.startMs : "?";
    const parent = span.parentId ? `← ${span.parentId.slice(0, 8)}` : "(root)";
    const status = span.status.code === "unset" ? "ok" : span.status.code;
    const attrs = Object.entries(span.attributes)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const lines = [
      `[telemetry] ${span.name}`,
      `  trace=${span.traceId.slice(0, 16)}  span=${span.spanId}  ${parent}`,
      `  status=${status}  duration=${duration}ms`,
    ];
    if (attrs) lines.push(attrs);
    if (span.events.length > 0) {
      lines.push(`  events: ${span.events.map((e) => e.name).join(", ")}`);
    }

    console.log(lines.join("\n"));
  }
}
