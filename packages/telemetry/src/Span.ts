// ── Types ─────────────────────────────────────────────────────────────────────

export type SpanStatusCode = "unset" | "ok" | "error";
export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export interface SpanEvent {
  name: string;
  timeMs: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentId: string | undefined;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs: number | undefined;
  attributes: Record<string, string | number | boolean>;
  status: SpanStatus;
  events: SpanEvent[];
}

// ── Span ──────────────────────────────────────────────────────────────────────

/**
 * A single unit of work in a distributed trace.
 *
 * Spans are created by `Tracer.withSpan()` and `withSpan()`. They are
 * automatically ended and exported when the wrapped callback resolves or
 * throws. Manual `end()` is only needed for fire-and-forget patterns.
 */
export class Span {
  readonly data: SpanData;

  constructor(name: string, parentId?: string, traceId?: string, kind: SpanKind = "internal") {
    this.data = {
      traceId: traceId ?? _randomHex(16),
      spanId: _randomHex(8),
      parentId,
      name,
      kind,
      startMs: Date.now(),
      endMs: undefined,
      attributes: {},
      status: { code: "unset" },
      events: [],
    };
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.data.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, string | number | boolean>): this {
    Object.assign(this.data.attributes, attrs);
    return this;
  }

  setStatus(code: "ok" | "error", message?: string): this {
    this.data.status = message !== undefined ? { code, message } : { code };
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    const event: SpanEvent = { name, timeMs: Date.now() };
    if (attributes !== undefined) event.attributes = attributes;
    this.data.events.push(event);
    return this;
  }

  recordException(error: Error): this {
    return this.addEvent("exception", {
      "exception.type": error.name,
      "exception.message": error.message,
      "exception.stack": error.stack ?? "",
    });
  }

  end(): void {
    if (this.data.endMs === undefined) this.data.endMs = Date.now();
  }

  get durationMs(): number {
    return (this.data.endMs ?? Date.now()) - this.data.startMs;
  }

  get isEnded(): boolean {
    return this.data.endMs !== undefined;
  }
}

// ── NoopSpan ──────────────────────────────────────────────────────────────────

/**
 * A span whose methods are all no-ops.
 * Used when telemetry is disabled so call sites never need null-checks.
 *
 * @internal
 */
export class NoopSpan extends Span {
  constructor() {
    super("noop");
  }
  override setAttribute(_key: string, _value: string | number | boolean): this {
    return this;
  }
  override setAttributes(_attrs: Record<string, string | number | boolean>): this {
    return this;
  }
  override setStatus(_code: "ok" | "error", _message?: string): this {
    return this;
  }
  override addEvent(_name: string, _attributes?: Record<string, unknown>): this {
    return this;
  }
  override recordException(_error: Error): this {
    return this;
  }
  override end(): void {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Random hex for trace and span ids.
 *
 * @internal
 */
export function _randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
