import { Span } from "./Span.ts";
import { SpanContext } from "./SpanContext.ts";
import type { SpanKind } from "./Span.ts";
import type { SpanExporter } from "./exporters/SpanExporter.ts";

export interface TracerOptions {
  exporter: SpanExporter;
  /** Drop spans in which the callback took less than this many ms. Default: 0 (keep all). */
  minDurationMs?: number | undefined;
  /** When true, export() errors are surfaced rather than swallowed. Default: false. */
  rethrowExportErrors?: boolean | undefined;
}

export interface SpanOptions {
  kind?: SpanKind | undefined;
  attributes?: Record<string, string | number | boolean> | undefined;
}

/**
 * Creates and manages spans. Normally one tracer lives for the lifetime of
 * the process, registered via `TelemetryProvider`.
 *
 * @example
 * const tracer = new Tracer({ exporter: new ConsoleExporter() });
 *
 * await tracer.withSpan('do-work', async (span) => {
 *   span.setAttribute('work.type', 'heavy');
 *   await heavyWork();
 * });
 */
export class Tracer {
  private readonly _exporter: SpanExporter;
  private readonly _minDuration: number;
  private readonly _rethrow: boolean;

  constructor(options: TracerOptions) {
    this._exporter = options.exporter;
    this._minDuration = options.minDurationMs ?? 0;
    this._rethrow = options.rethrowExportErrors ?? false;
  }

  /**
   * Runs `fn` inside a new span. The span is automatically ended and exported
   * when `fn` resolves or throws. Child spans created with `withSpan()` inside
   * `fn` will automatically be attached as children.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: SpanOptions = {},
  ): Promise<T> {
    const parent = SpanContext.getStore()?.span;
    const traceId = parent?.data.traceId;
    const span = new Span(name, parent?.data.spanId, traceId, options.kind ?? "internal");

    if (options.attributes) span.setAttributes(options.attributes);

    let result: T;
    try {
      result = await SpanContext.run({ span }, () => fn(span));
      if (span.data.status.code === "unset") span.setStatus("ok");
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus("error", err instanceof Error ? err.message : String(err));
      span.end();
      await this._tryExport(span);
      throw err;
    }

    span.end();
    await this._tryExport(span);
    return result;
  }

  /**
   * Record an already-completed unit of work as a span. Used to bridge synchronous
   * framework events (which carry their own `durationMs`) into the trace pipeline:
   * the span is back-dated by `durationMs`, ended, and exported immediately. It has
   * no parent/active context — these spans represent self-contained, past work.
   */
  async recordCompleted(
    name: string,
    durationMs: number,
    options: SpanOptions & { status?: "ok" | "error"; errorMessage?: string } = {},
  ): Promise<void> {
    const span = new Span(name, undefined, undefined, options.kind ?? "internal");
    const now = Date.now();
    span.data.startMs = now - Math.max(0, durationMs);
    span.data.endMs = now;
    if (options.attributes) span.setAttributes(options.attributes);
    span.setStatus(options.status ?? "ok", options.errorMessage);
    await this._tryExport(span);
  }

  /** Start a span manually. Caller is responsible for calling `span.end()`. */
  startSpan(name: string, options: SpanOptions = {}): Span {
    const parent = SpanContext.getStore()?.span;
    const traceId = parent?.data.traceId;
    const span = new Span(name, parent?.data.spanId, traceId, options.kind ?? "internal");
    if (options.attributes) span.setAttributes(options.attributes);
    return span;
  }

  /** Flush any pending spans and tear down the exporter. */
  async shutdown(): Promise<void> {
    await this._exporter.shutdown?.();
  }

  private async _tryExport(span: Span): Promise<void> {
    if (span.durationMs < this._minDuration) return;
    try {
      await this._exporter.export(span.data);
    } catch (err) {
      if (this._rethrow) throw err;
      // Silently drop — telemetry failures must never affect the application
    }
  }
}
