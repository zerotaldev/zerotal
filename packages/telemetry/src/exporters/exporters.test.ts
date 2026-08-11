/**
 * The exporters — the package's entire output path.
 *
 * Everything upstream of here (spans, context propagation, the event bridge) was
 * already covered, which left the tested part of this package the part that
 * produces nothing observable. An exporter is where telemetry either arrives at a
 * backend correctly or is silently wrong, and both failure modes are quiet:
 *
 * - A mistyped attribute (an integer sent as a string) is accepted by the
 *   transport and rejected or mis-indexed by the backend, so traces look present
 *   and query wrong.
 * - An exporter that throws takes the request down with it. Telemetry failing is
 *   acceptable; telemetry breaking the application is not.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { OtlpExporter } from "./OtlpExporter.ts";
import { ConsoleExporter } from "./ConsoleExporter.ts";
import { NoopExporter } from "./NoopExporter.ts";
import type { SpanData } from "../Span.ts";

function span(over: Partial<SpanData> = {}): SpanData {
  return {
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    parentId: undefined,
    name: "GET /posts",
    kind: "server",
    startMs: 1_700_000_000_000,
    endMs: 1_700_000_000_025,
    attributes: {},
    events: [],
    status: { code: "unset" },
    ...over,
  } as SpanData;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture what the exporter would POST, without a network. */
function captureFetch(): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls };
}

function payloadOf(init: RequestInit): any {
  return JSON.parse(String(init.body));
}

describe("OtlpExporter — transport", () => {
  it("POSTs JSON to the default collector endpoint", async () => {
    const { calls } = captureFetch();
    await new OtlpExporter().export(span());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:4318/v1/traces");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("sends configured auth headers alongside the content type", async () => {
    // Getting this wrong means every span is rejected with a 401 that nothing surfaces.
    const { calls } = captureFetch();
    await new OtlpExporter({
      endpoint: "https://api.honeycomb.io/v1/traces",
      headers: { "x-honeycomb-team": "secret-key" },
    }).export(span());

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://api.honeycomb.io/v1/traces");
    expect(headers["x-honeycomb-team"]).toBe("secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("swallows a failing collector instead of throwing into the request", async () => {
    // The single most important property here. A collector being down, slow, or
    // returning garbage must never surface as a 500 on a user's request.
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(new OtlpExporter().export(span())).resolves.toBeUndefined();
  });
});

describe("OtlpExporter — payload", () => {
  it("nests the span in the resourceSpans → scopeSpans → spans shape", async () => {
    const { calls } = captureFetch();
    await new OtlpExporter({ serviceName: "my-api", serviceVersion: "2.1.0" }).export(span());

    const body = payloadOf(calls[0]!.init);
    const resource = body.resourceSpans[0];
    expect(resource.scopeSpans[0].scope.name).toBe("@zerotal/telemetry");
    expect(resource.scopeSpans[0].spans).toHaveLength(1);

    const attrs: Record<string, unknown> = {};
    for (const a of resource.resource.attributes) attrs[a.key] = a.value.stringValue;
    expect(attrs["service.name"]).toBe("my-api");
    expect(attrs["service.version"]).toBe("2.1.0");
  });

  it("converts milliseconds to nanosecond strings", async () => {
    // OTLP wants nanoseconds as a string; sending millisecond numbers puts every
    // span in 1970 without any error being raised.
    const { calls } = captureFetch();
    await new OtlpExporter().export(span({ startMs: 1_700_000_000_000, endMs: 1_700_000_000_025 }));

    const s = payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.startTimeUnixNano).toBe("1700000000000000000");
    expect(s.endTimeUnixNano).toBe("1700000000025000000");
    expect(typeof s.startTimeUnixNano).toBe("string");
  });

  it("falls back to the start time when a span never ended", async () => {
    const { calls } = captureFetch();
    await new OtlpExporter().export(span({ endMs: undefined }));
    const s = payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.endTimeUnixNano).toBe(s.startTimeUnixNano);
  });

  it("types each attribute by its JavaScript type", async () => {
    // string→stringValue, int→intValue, float→doubleValue, bool→boolValue. A
    // backend indexes on these types, so a number sent as a string stops being
    // aggregatable while still appearing in the trace.
    const { calls } = captureFetch();
    await new OtlpExporter().export(
      span({
        attributes: {
          "http.method": "GET",
          "http.status_code": 200,
          "db.duration_ms": 12.5,
          "http.cached": true,
        },
      }),
    );

    const byKey: Record<string, unknown> = {};
    for (const a of payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0].attributes) {
      byKey[a.key] = a.value;
    }
    expect(byKey["http.method"]).toEqual({ stringValue: "GET" });
    expect(byKey["http.status_code"]).toEqual({ intValue: 200 });
    expect(byKey["db.duration_ms"]).toEqual({ doubleValue: 12.5 });
    expect(byKey["http.cached"]).toEqual({ boolValue: true });
  });

  it("maps span kinds and statuses to their OTLP numbers", async () => {
    const { calls } = captureFetch();
    await new OtlpExporter().export(
      span({ kind: "client", status: { code: "error", message: "HTTP 500" } }),
    );
    const s = payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.kind).toBe(3); // client
    expect(s.status).toEqual({ code: 2, message: "HTTP 500" });

    const { calls: c2 } = captureFetch();
    await new OtlpExporter().export(span({ kind: "server", status: { code: "ok" } }));
    const s2 = payloadOf(c2[0]!.init).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s2.kind).toBe(2); // server
    expect(s2.status.code).toBe(1);
  });

  it("sends an empty parentSpanId for a root span, not null", async () => {
    // A null here is a schema violation; the collector drops the batch.
    const { calls } = captureFetch();
    await new OtlpExporter().export(span({ parentId: undefined }));
    const s = payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0];
    expect(s.parentSpanId).toBe("");
  });

  it("carries span events with their own timestamps and attributes", async () => {
    const { calls } = captureFetch();
    await new OtlpExporter().export(
      span({
        events: [{ name: "cache.miss", timeMs: 1_700_000_000_010, attributes: { key: "posts:1" } }],
      } as Partial<SpanData>),
    );
    const [e] = payloadOf(calls[0]!.init).resourceSpans[0].scopeSpans[0].spans[0].events;
    expect(e.name).toBe("cache.miss");
    expect(e.timeUnixNano).toBe("1700000000010000000");
    expect(e.attributes).toEqual([{ key: "key", value: { stringValue: "posts:1" } }]);
  });
});

describe("ConsoleExporter", () => {
  it("prints the span with its trace, duration and status", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      await new ConsoleExporter().export(
        span({ attributes: { "http.method": "GET" }, status: { code: "ok" } }),
      );
    } finally {
      console.log = original;
    }

    const out = lines.join("\n");
    expect(out).toContain("GET /posts");
    expect(out).toContain("duration=25ms");
    expect(out).toContain("status=ok");
    expect(out).toContain("http.method: GET");
    expect(out).toContain("(root)");
  });

  it("reports an unset status as ok and names the parent when there is one", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      await new ConsoleExporter().export(span({ parentId: "abcdef0123456789" }));
    } finally {
      console.log = original;
    }
    expect(lines.join("\n")).toContain("status=ok");
    expect(lines.join("\n")).toContain("← abcdef01");
  });
});

describe("NoopExporter", () => {
  it("accepts a span and does nothing observable", async () => {
    // The default when telemetry is configured but no backend is: it must not
    // print, throw, or make a request.
    const { calls } = captureFetch();
    await expect(new NoopExporter().export(span())).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
