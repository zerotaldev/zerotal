/**
 * The request root span.
 *
 * Every child span an application creates with `withSpan()` attaches to whatever
 * this middleware opened. If it opens nothing, traces are a pile of orphans; if
 * it opens one but never closes it on an error path, a failing request leaves a
 * span that never ends and the backend reports it as still running.
 *
 * It also has to be inert when telemetry is not configured — an app that installs
 * the middleware without a tracer should serve requests exactly as before.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { Tracer } from "../Tracer.ts";
import { _setGlobalTracer } from "../withSpan.ts";
import { TelemetryMiddleware } from "./TelemetryMiddleware.ts";
import type { SpanData } from "../Span.ts";
import type { HttpContext, NextFn } from "@zerotal/core";

/** A tracer whose exporter records rather than transmits. */
function recordingTracer(): { tracer: Tracer; spans: SpanData[] } {
  const spans: SpanData[] = [];
  const tracer = new Tracer({
    exporter: {
      export: async (s: SpanData) => void spans.push(s),
    },
  });
  return { tracer, spans };
}

function ctx(over: Record<string, unknown> = {}): HttpContext {
  return {
    request: { method: "get" },
    url: new URL("http://localhost/posts/42"),
    requestId: "req-1",
    response: new Response("ok", { status: 200 }),
    ...over,
  } as unknown as HttpContext;
}

afterEach(() => _setGlobalTracer(null as never));

describe("TelemetryMiddleware", () => {
  it("opens one server-kind root span named for the request", async () => {
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);

    await new TelemetryMiddleware().handle(ctx(), (async () => {}) as NextFn);

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("GET /posts/42");
    expect(spans[0]!.kind).toBe("server");
  });

  it("uppercases the method, so `get` and `GET` produce one span name", async () => {
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);
    await new TelemetryMiddleware().handle(
      ctx({ request: { method: "get" } }),
      (async () => {}) as NextFn,
    );
    expect(spans[0]!.name).toBe("GET /posts/42");
  });

  it("records the standard http.* attributes", async () => {
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);

    await new TelemetryMiddleware().handle(ctx(), (async () => {}) as NextFn);

    const a = spans[0]!.attributes;
    expect(a["http.method"]).toBe("GET");
    expect(a["http.url"]).toBe("http://localhost/posts/42");
    expect(a["http.request_id"]).toBe("req-1");
    expect(a["http.status_code"]).toBe(200);
  });

  it("marks a 5xx as an error and a 2xx as ok", async () => {
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);

    await new TelemetryMiddleware().handle(
      ctx({ response: new Response("boom", { status: 503 }) }),
      (async () => {}) as NextFn,
    );
    expect(spans[0]!.status.code).toBe("error");
    expect(spans[0]!.status.message).toBe("HTTP 503");

    await new TelemetryMiddleware().handle(ctx(), (async () => {}) as NextFn);
    expect(spans[1]!.status.code).toBe("ok");
  });

  it("treats a 4xx as ok — a client error is not a server fault", async () => {
    // Marking 404s as errors makes an error-rate dashboard useless.
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);
    await new TelemetryMiddleware().handle(
      ctx({ response: new Response("nope", { status: 404 }) }),
      (async () => {}) as NextFn,
    );
    expect(spans[0]!.status.code).toBe("ok");
  });

  it("ends the span even when the span body ends without a response", async () => {
    // A span that is never ended shows in a backend as permanently in flight.
    const { tracer, spans } = recordingTracer();
    _setGlobalTracer(tracer);
    await new TelemetryMiddleware().handle(
      ctx({ response: undefined }),
      (async () => {}) as NextFn,
    );
    expect(spans[0]!.endMs).toBeDefined();
    expect(spans[0]!.attributes["http.status_code"]).toBe(0);
  });

  it("runs the chain and returns the response", async () => {
    const { tracer } = recordingTracer();
    _setGlobalTracer(tracer);
    let ran = false;
    const result = await new TelemetryMiddleware().handle(ctx(), (async () => {
      ran = true;
    }) as NextFn);
    expect(ran).toBe(true);
    expect((result as Response).status).toBe(200);
  });

  it("is inert with no tracer configured — the chain still runs", async () => {
    // Installing the middleware without TelemetryProvider must not break serving.
    _setGlobalTracer(null as never);
    let ran = false;
    await new TelemetryMiddleware().handle(ctx(), (async () => {
      ran = true;
    }) as NextFn);
    expect(ran).toBe(true);
  });
});
