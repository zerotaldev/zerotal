import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import type { Application } from "@zerotal/core";
import { HttpContext, RequestContext, FrameworkEvents, RequestHandled } from "@zerotal/core";
import { preventNPlusOne, installOrmObservability } from "@zerotal/orm";
import { _resetNPlusOne } from "../../orm/src/db/NPlusOneDetector.ts";
import { DevtoolsInjectionMiddleware } from "./DevtoolsInjectionMiddleware.ts";
import { startDevtoolsTracing, stopDevtoolsTracing, traceSink } from "./tracing.ts";
import { TraceStore, traceStore, _setTraceStore } from "./TraceStore.ts";

// A minimal app stub exposing the `devtools.trace` binding so the ORM's own
// observability bridge contributes query spans, as its provider does in a real app.
const _fakeApp = {
  container: { tryMake: (k: string) => (k === "devtools.trace" ? traceSink : undefined) },
} as unknown as Application;
let _disposeOrmObservability: (() => void) | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ctx(url = "http://localhost/") {
  return HttpContext.fake(url);
}

async function run(c: HttpContext, body?: string, contentType = "text/html"): Promise<HttpContext> {
  const startMs = Date.now();
  await RequestContext.run(c, async () => {
    c.response = new Response(body ?? "<html><body><h1>hi</h1></body></html>", {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  });
  FrameworkEvents.emit(new RequestHandled(c, startMs, Date.now() - startMs));
  return c;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Memory-only: a suite must not write a SQLite file into the package
  // directory just by running.
  _setTraceStore(new TraceStore({ dbPath: null }));
  startDevtoolsTracing();
  _disposeOrmObservability = installOrmObservability(_fakeApp);
  preventNPlusOne({ threshold: 100 });
});

afterAll(() => {
  _setTraceStore(null);
  stopDevtoolsTracing();
  _disposeOrmObservability?.();
  FrameworkEvents.clear();
  _resetNPlusOne();
});

beforeEach(() => {
  traceStore().clear();
});

// ── API routes ────────────────────────────────────────────────────────────────

describe("API routes", () => {
  it("serves traces at /__zerotal/devtools/api/traces", async () => {
    const c = ctx("http://localhost/__zerotal/devtools/api/traces");
    const mw = new DevtoolsInjectionMiddleware();
    const result = await mw.handle(c as never, async () => c.response);
    if (result instanceof Response) c.response = result;
    expect(c.response?.status).toBe(200);
    expect(c.response?.headers.get("content-type")).toContain("application/json");
    const body = await c.response!.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("clears traces via POST /__zerotal/devtools/api/clear", async () => {
    await run(ctx("http://localhost/about"));
    expect(traceStore().all()).toHaveLength(1);
    const c = ctx("http://localhost/__zerotal/devtools/api/clear");
    c.request = new Request("http://localhost/__zerotal/devtools/api/clear", { method: "POST" });
    const mw = new DevtoolsInjectionMiddleware();
    const result = await mw.handle(c as never, async () => c.response);
    if (result instanceof Response) c.response = result;
    expect(c.response?.status).toBe(204);
    expect(traceStore().all()).toHaveLength(0);
  });

  it("does not call next() for API routes", async () => {
    let called = false;
    const c = ctx("http://localhost/__zerotal/devtools/api/traces");
    const mw = new DevtoolsInjectionMiddleware();
    await mw.handle(c as never, async () => {
      called = true;
      return c.response;
    });
    expect(called).toBe(false);
  });
});

// ── Injected client bundle ─────────────────────────────────────────────────────

describe("client bundle", () => {
  it("serves a browser JS bundle at /__zerotal/devtools/client.js", async () => {
    const c = ctx("http://localhost/__zerotal/devtools/client.js");
    const mw = new DevtoolsInjectionMiddleware();
    const result = await mw.handle(c as never, async () => c.response);
    if (result instanceof Response) c.response = result;
    expect(c.response?.status).toBe(200);
    expect(c.response?.headers.get("content-type")).toContain("javascript");
    const js = await c.response!.text();
    expect(js.length).toBeGreaterThan(1000); // a real bundle, not a stub
    expect(js).not.toContain("build failed");
  });
});

// ── Passthrough ───────────────────────────────────────────────────────────────

describe("passthrough", () => {
  it("passes non-devtools requests through unchanged", async () => {
    const c = await run(ctx());
    const html = await c.response!.text();
    expect(html).toContain("<h1>hi</h1>");
    expect(html).not.toContain("__ZT_DT__");
  });

  it("passes JSON responses through unchanged", async () => {
    const c = await run(ctx(), '{"ok":true}', "application/json");
    expect(await c.response!.text()).toBe('{"ok":true}');
  });
});

// ── Trace recording (via FrameworkEvents) ─────────────────────────────────────

describe("trace recording", () => {
  it("stores a trace for every non-internal request", async () => {
    await run(ctx("http://localhost/about"));
    expect(traceStore().all()).toHaveLength(1);
    expect(traceStore().all()[0]!.path).toBe("/about");
  });

  it("does NOT record internal paths (/__zerotal/*, /__flow/*, /__dev/*)", async () => {
    const c = ctx("http://localhost/__zerotal/devtools/api/clear");
    const startMs = Date.now();
    await RequestContext.run(c, async () => {
      c.response = new Response("ok");
    });
    FrameworkEvents.emit(new RequestHandled(c, startMs, Date.now() - startMs));
    expect(traceStore().all()).toHaveLength(0);
  });

  it("records query spans from real SQL", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE inj_t (id INTEGER PRIMARY KEY)`;

    const c = ctx("http://localhost/q");
    const startMs = Date.now();
    await RequestContext.run(c, async () => {
      await new QueryBuilder("inj_t", db).get();
      c.response = new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    });
    FrameworkEvents.emit(new RequestHandled(c, startMs, Date.now() - startMs));

    const t = traceStore().all()[0]!;
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.sql).toContain("inj_t");
    await db.end();
  });

  it("api/traces returns the recorded trace", async () => {
    await run(ctx("http://localhost/tracked"));
    const c2 = ctx("http://localhost/__zerotal/devtools/api/traces");
    const mw = new DevtoolsInjectionMiddleware();
    const result = await mw.handle(c2 as never, async () => c2.response);
    if (result instanceof Response) c2.response = result;
    const list = (await c2.response!.json()) as { path: string }[];
    expect(list[0]!.path).toBe("/tracked");
  });
});
