import { describe, it, expect, afterEach } from "bun:test";
import { Span, NoopSpan, _randomHex } from "./Span.ts";
import { currentSpan, SpanContext } from "./SpanContext.ts";
import { Tracer } from "./Tracer.ts";
import { withSpan, _setGlobalTracer, _getGlobalTracer } from "./withSpan.ts";
import { NoopExporter } from "./exporters/NoopExporter.ts";
import type { SpanExporter } from "./exporters/SpanExporter.ts";
import type { SpanData } from "./Span.ts";

// ── MemoryExporter — captures spans for assertions ────────────────────────────

class MemoryExporter implements SpanExporter {
  readonly spans: SpanData[] = [];
  async export(span: SpanData): Promise<void> {
    this.spans.push(span);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTracer(exporter?: SpanExporter) {
  return new Tracer({ exporter: exporter ?? new MemoryExporter() });
}

// ── _randomHex ────────────────────────────────────────────────────────────────

describe("_randomHex()", () => {
  it("returns a hex string of length bytes*2", () => {
    expect(_randomHex(8)).toHaveLength(16);
    expect(_randomHex(16)).toHaveLength(32);
  });

  it("contains only hex characters", () => {
    expect(_randomHex(8)).toMatch(/^[0-9a-f]+$/);
  });

  it("produces unique values", () => {
    expect(_randomHex(8)).not.toBe(_randomHex(8));
  });
});

// ── Span ──────────────────────────────────────────────────────────────────────

describe("Span", () => {
  it("starts with unset status and no endMs", () => {
    const span = new Span("test");
    expect(span.data.status.code).toBe("unset");
    expect(span.data.endMs).toBeUndefined();
    expect(span.isEnded).toBe(false);
  });

  it("end() records endMs once", () => {
    const span = new Span("test");
    span.end();
    const first = span.data.endMs!;
    span.end(); // second call is a no-op
    expect(span.data.endMs).toBe(first);
    expect(span.isEnded).toBe(true);
  });

  it("setAttribute / setAttributes merge into data.attributes", () => {
    const span = new Span("test");
    span.setAttribute("a", 1).setAttributes({ b: "x", c: true });
    expect(span.data.attributes).toMatchObject({ a: 1, b: "x", c: true });
  });

  it("setStatus records code and optional message", () => {
    const span = new Span("test");
    span.setStatus("error", "boom");
    expect(span.data.status).toEqual({ code: "error", message: "boom" });
  });

  it("addEvent appends to events array", () => {
    const span = new Span("test");
    span.addEvent("cache.miss").addEvent("db.query", { table: "users" });
    expect(span.data.events).toHaveLength(2);
    expect(span.data.events[0]!.name).toBe("cache.miss");
    expect(span.data.events[1]!.attributes).toMatchObject({ table: "users" });
  });

  it("recordException adds an exception event with error fields", () => {
    const span = new Span("test");
    const error = new Error("boom");
    span.recordException(error);
    expect(span.data.events[0]!.name).toBe("exception");
    expect(span.data.events[0]!.attributes!["exception.message"]).toBe("boom");
  });

  it("durationMs is positive after end()", async () => {
    const span = new Span("test");
    await Bun.sleep(5);
    span.end();
    expect(span.durationMs).toBeGreaterThanOrEqual(5);
  });

  it("child span inherits parent traceId", () => {
    const parent = new Span("parent");
    const child = new Span("child", parent.data.spanId, parent.data.traceId);
    expect(child.data.traceId).toBe(parent.data.traceId);
    expect(child.data.parentId).toBe(parent.data.spanId);
  });
});

// ── NoopSpan ──────────────────────────────────────────────────────────────────

describe("NoopSpan", () => {
  it("all fluent methods return `this`", () => {
    const noop = new NoopSpan();
    expect(noop.setAttribute("x", 1)).toBe(noop);
    expect(noop.setStatus("ok")).toBe(noop);
    expect(noop.addEvent("e")).toBe(noop);
    expect(noop.recordException(new Error())).toBe(noop);
  });

  it("end() does not set endMs", () => {
    const noop = new NoopSpan();
    noop.end();
    expect(noop.data.endMs).toBeUndefined();
  });
});

// ── SpanContext ───────────────────────────────────────────────────────────────

describe("SpanContext / currentSpan()", () => {
  it("returns undefined outside a run()", () => {
    expect(currentSpan()).toBeUndefined();
  });

  it("returns the active span inside a run()", async () => {
    const span = new Span("active");
    await SpanContext.run({ span }, async () => {
      expect(currentSpan()).toBe(span);
    });
  });

  it("is isolated between concurrent async contexts", async () => {
    const spanA = new Span("A");
    const spanB = new Span("B");
    const results: (Span | undefined)[] = [];

    await Promise.all([
      SpanContext.run({ span: spanA }, async () => {
        await Bun.sleep(2);
        results.push(currentSpan());
      }),
      SpanContext.run({ span: spanB }, async () => {
        results.push(currentSpan());
      }),
    ]);

    expect(results).toContain(spanA);
    expect(results).toContain(spanB);
  });
});

// ── Tracer ────────────────────────────────────────────────────────────────────

describe("Tracer.withSpan()", () => {
  it("exports the span after the callback resolves", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    await tracer.withSpan("my-op", async (span) => {
      span.setAttribute("x", 1);
    });

    expect(mem.spans).toHaveLength(1);
    expect(mem.spans[0]!.name).toBe("my-op");
    expect(mem.spans[0]!.attributes["x"]).toBe(1);
    expect(mem.spans[0]!.endMs).toBeDefined();
    expect(mem.spans[0]!.status.code).toBe("ok");
  });

  it("exports the span and re-throws when the callback throws", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    await expect(
      tracer.withSpan("bad-op", async () => {
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");

    expect(mem.spans).toHaveLength(1);
    expect(mem.spans[0]!.status.code).toBe("error");
    expect(mem.spans[0]!.events[0]!.name).toBe("exception");
    expect(mem.spans[0]!.events[0]!.attributes!["exception.message"]).toBe("oops");
  });

  it("propagates traceId to child spans automatically", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    await tracer.withSpan("parent", async () => {
      await tracer.withSpan("child", async () => {});
    });

    expect(mem.spans).toHaveLength(2);
    const [child, parent] = mem.spans; // exported in completion order: child first
    expect(child!.traceId).toBe(parent!.traceId);
    expect(child!.parentId).toBe(parent!.spanId);
  });

  it("marks root spans with no parentId", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    await tracer.withSpan("root", async () => {});

    expect(mem.spans[0]!.parentId).toBeUndefined();
  });

  it("sets the span kind from options", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    await tracer.withSpan("http-call", async () => {}, { kind: "client" });

    expect(mem.spans[0]!.kind).toBe("client");
  });

  it("drops spans shorter than minDurationMs", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem, minDurationMs: 10_000 });

    await tracer.withSpan("fast", async () => {});

    expect(mem.spans).toHaveLength(0);
  });

  it("swallows exporter errors by default", async () => {
    class ThrowingExporter implements SpanExporter {
      async export(): Promise<void> {
        throw new Error("network down");
      }
    }
    const tracer = new Tracer({ exporter: new ThrowingExporter() });

    // Should NOT throw
    await expect(tracer.withSpan("op", async () => {})).resolves.toBeUndefined();
  });

  it("re-throws exporter errors when rethrowExportErrors is true", async () => {
    class ThrowingExporter implements SpanExporter {
      async export(): Promise<void> {
        throw new Error("network down");
      }
    }
    const tracer = new Tracer({
      exporter: new ThrowingExporter(),
      rethrowExportErrors: true,
    });

    await expect(tracer.withSpan("op", async () => {})).rejects.toThrow("network down");
  });
});

describe("Tracer.startSpan()", () => {
  it("returns an un-ended span attached to the current context", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });

    let inner: Span | undefined;
    await tracer.withSpan("parent", async (parent) => {
      inner = tracer.startSpan("manual");
      expect(inner.data.parentId).toBe(parent.data.spanId);
    });

    expect(inner!.isEnded).toBe(false); // not exported — caller's responsibility
    expect(mem.spans).toHaveLength(1); // only 'parent' was exported
  });
});

// ── withSpan() global helper ──────────────────────────────────────────────────

describe("withSpan() (global helper)", () => {
  afterEach(() => _setGlobalTracer(undefined));

  it("runs the callback with a NoopSpan when no tracer is registered", async () => {
    let seen: Span | undefined;
    await withSpan("noop-test", async (span) => {
      seen = span;
    });
    expect(seen).toBeInstanceOf(NoopSpan);
  });

  it("delegates to the global tracer when registered", async () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });
    _setGlobalTracer(tracer);

    await withSpan("global-op", async (span) => {
      span.setAttribute("from", "global");
    });

    expect(mem.spans).toHaveLength(1);
    expect(mem.spans[0]!.name).toBe("global-op");
    expect(mem.spans[0]!.attributes["from"]).toBe("global");
  });

  it("_setGlobalTracer / _getGlobalTracer round-trip", () => {
    const tracer = makeTracer();
    _setGlobalTracer(tracer);
    expect(_getGlobalTracer()).toBe(tracer);
    _setGlobalTracer(undefined);
    expect(_getGlobalTracer()).toBeUndefined();
  });
});

// ── Tracer.shutdown() ─────────────────────────────────────────────────────────

describe("Tracer.shutdown()", () => {
  it("calls exporter.shutdown() when it is defined", async () => {
    let shutdownCalled = false;
    const exporter = {
      async export(): Promise<void> {},
      async shutdown(): Promise<void> {
        shutdownCalled = true;
      },
    };
    const tracer = new Tracer({ exporter });
    await tracer.shutdown();
    expect(shutdownCalled).toBe(true);
  });

  it("resolves without error when exporter has no shutdown() method", async () => {
    const exporter = {
      async export(): Promise<void> {},
    };
    const tracer = new Tracer({ exporter });
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });
});

// ── Tracer.startSpan() — options.attributes ───────────────────────────────────

describe("Tracer.startSpan() — with attributes option", () => {
  it("sets initial attributes from options", () => {
    const mem = new MemoryExporter();
    const tracer = new Tracer({ exporter: mem });
    const span = tracer.startSpan("tagged", { attributes: { service: "api", version: 1 } });
    expect(span.data.attributes["service"]).toBe("api");
    expect(span.data.attributes["version"]).toBe(1);
  });
});

// ── NoopExporter ──────────────────────────────────────────────────────────────

describe("NoopExporter", () => {
  it("exports without throwing", async () => {
    const tracer = new Tracer({ exporter: new NoopExporter() });
    await expect(tracer.withSpan("op", async () => {})).resolves.toBeUndefined();
  });
});
