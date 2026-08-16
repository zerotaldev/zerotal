import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import type { Application } from "@zerotal/core";
import {
  HttpContext,
  RequestContext,
  FrameworkEvents,
  RequestHandled,
  RequestFailed,
  OutgoingRequestCompleted,
} from "@zerotal/core";
import { preventNPlusOne, installOrmObservability } from "@zerotal/orm";
import { _resetNPlusOne } from "../../orm/src/db/NPlusOneDetector.ts";
import type { RequestTrace } from "./RequestTrace.ts";
import { TraceStore, traceStore, _setTraceStore } from "./TraceStore.ts";
import { DevtoolsInjectionMiddleware, startDevtoolsStream } from "./DevtoolsInjectionMiddleware.ts";
import {
  startDevtoolsTracing,
  stopDevtoolsTracing,
  startConsoleCapture,
  stopConsoleCapture,
  traceSink,
  _setHeaderAllowlist,
} from "./tracing.ts";

// The ORM contributes query/N+1 spans to the trace through the `devtools.trace`
// sink, exactly as its provider wires it in a real app. A minimal app stub exposes
// that binding so the integration below drives the real ORM → devtools path.
const _fakeApp = {
  container: { tryMake: (k: string) => (k === "devtools.trace" ? traceSink : undefined) },
} as unknown as Application;
let _disposeOrmObservability: (() => void) | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fakeCtx(url = "http://localhost/users"): HttpContext {
  return HttpContext.fake(url);
}

/**
 * Simulates a full request/response cycle: runs `inner` inside a request
 * context, then emits RequestHandled (as Application would) so tracing fires.
 */
async function runRequest(
  url: string,
  inner?: (ctx: HttpContext) => Promise<void>,
  status = 200,
): Promise<HttpContext> {
  const ctx = fakeCtx(url);
  const startMs = Date.now();
  await RequestContext.run(ctx, async () => {
    await inner?.(ctx);
    ctx.response = new Response("ok", { status });
  });
  FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));
  return ctx;
}

// ── Global setup ──────────────────────────────────────────────────────────────

// The inspector's endpoints are gated; a suite exercising them has to say it is
// a development process. See `enabled.ts`.
const priorEnv = Bun.env["APP_ENV"];

beforeAll(() => {
  Bun.env["APP_ENV"] = "development";
  // Memory-only: a suite must not write a SQLite file into the package
  // directory just by running.
  _setTraceStore(new TraceStore({ dbPath: null }));
  startDevtoolsTracing();
  startConsoleCapture();
  _disposeOrmObservability = installOrmObservability(_fakeApp);
  preventNPlusOne({ threshold: 100 });
});

afterAll(() => {
  if (priorEnv === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = priorEnv;
  _setTraceStore(null);
  stopDevtoolsTracing();
  stopConsoleCapture();
  _disposeOrmObservability?.();
  FrameworkEvents.clear();
  _resetNPlusOne();
});

beforeEach(() => {
  traceStore().clear();
});

// ── TraceStore ────────────────────────────────────────────────────────────────

describe("TraceStore", () => {
  // Memory-only throughout: these cover the in-memory ring, and a unit test has
  // no business writing a SQLite file into the package directory. Persistence
  // has its own suite in TraceStore.test.ts.
  const store = (capacity?: number): TraceStore =>
    new TraceStore(capacity === undefined ? { dbPath: null } : { dbPath: null, capacity });

  it("stores traces and returns them newest-first", () => {
    const s = store();
    s.push(trace("a"));
    s.push(trace("b"));
    expect(s.all().map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("evicts oldest when over capacity", () => {
    const s = store(2);
    s.push(trace("x"));
    s.push(trace("y"));
    s.push(trace("z"));
    expect(s.all().map((t) => t.id)).toEqual(["z", "y"]);
  });

  it("notifies subscribers on push", () => {
    const s = store();
    const seen: string[] = [];
    s.subscribe((t) => {
      if (t) seen.push(t.id);
    });
    s.push(trace("sub"));
    expect(seen).toEqual(["sub"]);
  });

  it("unsubscribe stops notifications", () => {
    const s = store();
    const seen: string[] = [];
    const unsub = s.subscribe((t) => {
      if (t) seen.push(t.id);
    });
    unsub();
    s.push(trace("gone"));
    expect(seen).toHaveLength(0);
  });

  it("clear empties the list", () => {
    const s = store();
    s.push(trace("x"));
    s.clear();
    expect(s.all()).toHaveLength(0);
  });
});

// ── Request tracing via FrameworkEvents ───────────────────────────────────────

describe("Request tracing via FrameworkEvents", () => {
  it("records method, path, and status code", async () => {
    await runRequest("http://localhost/api/posts");
    const t = traceStore().all()[0]!;
    expect(t.method).toBe("GET");
    expect(t.path).toBe("/api/posts");
    expect(t.statusCode).toBe(200);
  });

  it("records duration >= 0", async () => {
    await runRequest("http://localhost/");
    expect(traceStore().all()[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("assigns a unique id per request", async () => {
    await runRequest("http://localhost/a");
    await runRequest("http://localhost/b");
    const ids = traceStore()
      .all()
      .map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("records a request once even when tracing is started twice", async () => {
    // `DevtoolsProvider.onBooted()` calls start(), and so does every test file
    // here. A second call used to reassign the subscription handles without
    // unsubscribing, stranding the first listener — so `_finaliseTrace` ran once
    // per live listener and each request was recorded as many times as start()
    // had been called.
    startDevtoolsTracing();
    await runRequest("http://localhost/started-twice");

    expect(
      traceStore()
        .all()
        .filter((t) => t.path === "/started-twice"),
    ).toHaveLength(1);
  });

  it("stores requests newest-first", async () => {
    await runRequest("http://localhost/first");
    await runRequest("http://localhost/second");
    expect(traceStore().all()[0]!.path).toBe("/second");
    expect(traceStore().all()[1]!.path).toBe("/first");
  });

  it("starts with empty queries and warnings", async () => {
    await runRequest("http://localhost/");
    const t = traceStore().all()[0]!;
    expect(t.queries).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it("records non-200 status codes", async () => {
    await runRequest("http://localhost/not-found", undefined, 404);
    expect(traceStore().all()[0]!.statusCode).toBe(404);
  });

  it("records 0 status when no response is set", async () => {
    const ctx = fakeCtx("http://localhost/empty");
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      /* no response */
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));
    expect(traceStore().all()[0]!.statusCode).toBe(0);
  });

  it("does not record /__zerotal/* or /__flow/* paths (framework internals)", async () => {
    const ctx = fakeCtx("http://localhost/__zerotal/devtools/sse");
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("ok");
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));
    expect(traceStore().all()).toHaveLength(0);
  });
});

// ── Failed requests ───────────────────────────────────────────────────────────

describe("Failed requests", () => {
  /** Emit RequestFailed as the route dispatcher does when an error escapes. */
  async function runFailure(url: string, message: string, status = 500): Promise<void> {
    const ctx = fakeCtx(url);
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("error", { status });
    });
    FrameworkEvents.emit(new RequestFailed(ctx, startMs, Date.now() - startMs, message, status));
  }

  it("records the error message, which used to be dropped on the floor", async () => {
    await runFailure("http://localhost/boom", "Cannot read property 'id' of undefined");
    const t = traceStore().all()[0]!;
    expect(t.exception).toEqual({
      message: "Cannot read property 'id' of undefined",
      status: 500,
    });
  });

  it("records the status the failure rendered as", async () => {
    await runFailure("http://localhost/nope", "No query results for model [Post]", 404);
    expect(traceStore().all()[0]!.exception?.status).toBe(404);
  });

  it("leaves exception null on a request that completed", async () => {
    await runRequest("http://localhost/fine");
    expect(traceStore().all()[0]!.exception).toBeNull();
  });

  it("skips internal paths on failure exactly as it does on success", async () => {
    await runFailure("http://localhost/__zerotal/devtools/sse", "stream closed");
    expect(traceStore().all()).toHaveLength(0);
  });
});

// ── What Phase 4 added to the trace ───────────────────────────────────────────

describe("Extended request capture", () => {
  it("records response headers as well as request headers", async () => {
    const ctx = fakeCtx("http://localhost/both-halves");
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("ok", { headers: { "content-type": "text/plain" } });
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));

    const t = traceStore().all()[0]!;
    expect(t.responseHeaders["content-type"]).toContain("text/plain");
  });

  it("never records the credentials, whatever the allowlist says", async () => {
    // `cookie` and `authorization` are the request itself, and this trace is
    // written to disk for a day.
    _setHeaderAllowlist(["*"]);
    try {
      const ctx = HttpContext.fake("http://localhost/creds", {
        headers: { authorization: "Bearer sk-live", cookie: "sid=abc", "x-tenant": "acme" },
      });
      const startMs = Date.now();
      await RequestContext.run(ctx, async () => {
        ctx.response = new Response("ok");
      });
      FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));

      const t = traceStore().all()[0]!;
      expect(t.headers["authorization"]).toBeUndefined();
      expect(t.headers["cookie"]).toBeUndefined();
      // …but the header you are actually debugging is now reachable.
      expect(t.headers["x-tenant"]).toBe("acme");
    } finally {
      _setHeaderAllowlist([]);
    }
  });

  it("keeps a custom header out until it is asked for", async () => {
    const ctx = HttpContext.fake("http://localhost/custom", {
      headers: { "x-tenant": "acme" },
    });
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("ok");
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));

    expect(traceStore().all()[0]!.headers["x-tenant"]).toBeUndefined();
  });

  it("records session key names and no session values", async () => {
    const ctx = fakeCtx("http://localhost/session");
    (ctx as unknown as Record<string, unknown>)["session"] = {
      _data: { user_id: 7, _token: "csrf-secret" },
    };
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("ok");
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));

    const t = traceStore().all()[0]!;
    expect(t.session).toEqual(["_token", "user_id"]);
    expect(JSON.stringify(t)).not.toContain("csrf-secret");
  });

  it("has an empty session list when no session middleware is installed", async () => {
    await runRequest("http://localhost/no-session");
    expect(traceStore().all()[0]!.session).toEqual([]);
  });

  it("records the error type and its stack frames", async () => {
    const ctx = fakeCtx("http://localhost/threw");
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      ctx.response = new Response("error", { status: 500 });
    });
    const failure = new TypeError("Cannot read property 'id' of undefined");
    FrameworkEvents.emit(
      new RequestFailed(ctx, startMs, 1, failure.message, 500, failure.name, failure.stack),
    );

    const e = traceStore().all()[0]!.exception!;
    expect(e.type).toBe("TypeError");
    expect(e.frames?.length).toBeGreaterThan(0);
    expect(e.frames![0]).toMatchObject({ file: expect.any(String), line: expect.any(Number) });
  });

  it("records an outgoing call against the request that made it", async () => {
    await runRequest("http://localhost/calls-out", async () => {
      FrameworkEvents.emit(
        new OutgoingRequestCompleted(
          "api.example.com",
          "GET",
          "https://api.example.com/v1",
          200,
          12,
          true,
        ),
      );
    });
    const entry = traceStore().all()[0]!.channels["http"]![0]!;
    expect(entry["host"]).toBe("api.example.com");
    expect(entry["status"]).toBe(200);
    expect(entry["failed"]).toBe(false);
  });

  it("drops an outgoing call made outside any request", async () => {
    // A call from a scheduled task has no trace to belong to.
    traceStore().clear();
    FrameworkEvents.emit(
      new OutgoingRequestCompleted("x.test", "GET", "https://x.test", 200, 1, true),
    );
    expect(traceStore().all()).toHaveLength(0);
  });
});

// ── Redaction at the sink boundary ────────────────────────────────────────────

describe("Redaction at the sink", () => {
  // Redacting in a renderer would protect nothing: the unredacted copy is
  // already in SQLite by the time a panel draws a row.

  it("masks sensitive fields of a channel entry", async () => {
    await runRequest("http://localhost/channel", async (ctx) => {
      traceSink.record(ctx, "test", { user: "ada", api_key: "sk-live-secret" });
    });
    const entry = traceStore().all()[0]!.channels["test"]![0]!;
    expect(entry["user"]).toBe("ada");
    expect(entry["api_key"]).toBe("‹redacted›");
  });

  it("masks the tail of a sensitive cache key", async () => {
    await runRequest("http://localhost/cache", async (ctx) => {
      traceSink.bufferCache(ctx, { op: "hit", key: "session:abc123", durationMs: 1 });
      traceSink.bufferCache(ctx, { op: "hit", key: "posts:page:2", durationMs: 1 });
    });
    const cache = traceStore().all()[0]!.cache;
    expect(cache[0]!.key).toBe("session:‹redacted›");
    expect(cache[1]!.key).toBe("posts:page:2");
  });

  it("masks sensitive fields of a logged object", async () => {
    await runRequest("http://localhost/log-object", async () => {
      console.log({ email: "ada@example.com", password_hash: "argon2id$…" });
    });
    const line = traceStore().all()[0]!.logs[0]!.args[0]!;
    expect(line).toContain("ada@example.com");
    expect(line).not.toContain("argon2id");
    expect(line).toContain("‹redacted›");
  });

  it("captures a circular log argument instead of throwing out of console.log", async () => {
    // JSON.stringify used to run on the raw argument, so `console.log(node)` on
    // anything self-referential threw from inside the console patch.
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;

    await runRequest("http://localhost/log-cycle", async () => {
      expect(() => console.log(node)).not.toThrow();
    });
    expect(traceStore().all()[0]!.logs[0]!.args[0]).toContain("circular");
  });
});

// ── Integration — real QueryBuilder spans ─────────────────────────────────────

describe("Integration — QueryBuilder spans", () => {
  it("captures query timing and row count for real SQL", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE dt_users (id INTEGER PRIMARY KEY, name TEXT)`;
    await db`INSERT INTO dt_users (name) VALUES ('Alice'), ('Bob')`;

    await runRequest("http://localhost/users", async (_ctx) => {
      await new QueryBuilder("dt_users", db).get();
    });

    const t = traceStore().all()[0]!;
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.sql).toContain("dt_users");
    expect(t.queries[0]!.rowCount).toBe(2);
    expect(t.queries[0]!.durationMs).toBeGreaterThanOrEqual(0);

    await db.end();
  });

  it("captures queries fired before RequestHandled (auth-style scenario)", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE dt_auth (id INTEGER PRIMARY KEY, email TEXT)`;
    await db`INSERT INTO dt_auth (email) VALUES ('user@example.com')`;

    // Query fires BEFORE RequestHandled — simulates AuthMiddleware loading the user
    const ctx = fakeCtx("http://localhost/dashboard");
    const startMs = Date.now();
    await RequestContext.run(ctx, async () => {
      await new QueryBuilder("dt_auth", db).where("id", 1).first(); // "auth query"
      ctx.response = new Response("ok", { status: 200 });
    });
    FrameworkEvents.emit(new RequestHandled(ctx, startMs, Date.now() - startMs));

    const t = traceStore().all()[0]!;
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.sql).toContain("dt_auth");

    await db.end();
  });

  it("does not capture queries made outside a request context", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE dt_outside (id INTEGER PRIMARY KEY)`;
    await new QueryBuilder("dt_outside", db).get(); // no RequestContext active
    expect(traceStore().all()).toHaveLength(0);

    await db.end();
  });

  it("isolates queries per concurrent request", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE dt_iso (id INTEGER PRIMARY KEY, tag TEXT)`;
    await db`INSERT INTO dt_iso (tag) VALUES ('A'), ('B'), ('C')`;

    await Promise.all([
      runRequest("http://localhost/r1", async () => {
        await new QueryBuilder("dt_iso", db).where("tag", "A").first();
      }),
      runRequest("http://localhost/r2", async () => {
        await new QueryBuilder("dt_iso", db).where("tag", "B").first();
        await new QueryBuilder("dt_iso", db).where("tag", "C").first();
      }),
    ]);

    const traces = traceStore().all();
    expect(traces).toHaveLength(2);
    const r1 = traces.find((t) => t.path === "/r1")!;
    const r2 = traces.find((t) => t.path === "/r2")!;
    expect(r1.queries).toHaveLength(1);
    expect(r2.queries).toHaveLength(2);

    await db.end();
  });
});

// ── N+1 warning capture ───────────────────────────────────────────────────────

describe("N+1 warning capture", () => {
  it("captures N+1 warnings via FrameworkEvents", async () => {
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");

    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE dw_items (id INTEGER PRIMARY KEY, val TEXT)`;
    await db`INSERT INTO dw_items (val) VALUES ('a'), ('b'), ('c'), ('d'), ('e')`;

    preventNPlusOne({ threshold: 3 });

    await runRequest("http://localhost/n1", async () => {
      await new QueryBuilder("dw_items", db).where("val", "a").first();
      await new QueryBuilder("dw_items", db).where("val", "a").first();
      await new QueryBuilder("dw_items", db).where("val", "a").first();
    });

    await db.end();
    _resetNPlusOne();

    const t = traceStore().all()[0]!;
    expect(t.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Console capture ───────────────────────────────────────────────────────────

describe("Console capture", () => {
  it("captures console.log inside a request in trace logs", async () => {
    await runRequest("http://localhost/log-test", async () => {
      console.log("test-log-message");
    });
    const t = traceStore().all()[0]!;
    const logs = t.logs ?? [];
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const found = logs.some(
      (l) => Array.isArray(l.args) && l.args.some((a) => a.includes("test-log-message")),
    );
    expect(found).toBe(true);
  });
});

// ── DevtoolsInjectionMiddleware — API route handler ───────────────────────────

describe("DevtoolsInjectionMiddleware — API routes", () => {
  beforeEach(() => {
    traceStore().clear();
  });

  async function runInjection(url: string, method = "GET"): Promise<HttpContext> {
    const ctx = HttpContext.fake(url, { method });
    const mw = new DevtoolsInjectionMiddleware();
    await RequestContext.run(ctx, async () => {
      const result = await mw.handle(ctx, async () => {
        ctx.response = new Response("ok", { status: 200 });
        return ctx.response;
      });
      if (result instanceof Response) ctx.response = result;
    });
    return ctx;
  }

  it("returns JSON for GET /__zerotal/devtools/api/traces", async () => {
    const ctx = await runInjection("http://localhost/__zerotal/devtools/api/traces");
    expect(ctx.response?.headers.get("content-type")).toContain("application/json");
    const body = (await ctx.response!.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it("clears traces on POST /__zerotal/devtools/api/clear", async () => {
    traceStore().push(trace("x"));
    const ctx = await runInjection("http://localhost/__zerotal/devtools/api/clear", "POST");
    expect(ctx.response?.status).toBe(204);
    expect(traceStore().all()).toHaveLength(0);
  });

  it("returns event-stream for GET /__zerotal/devtools/sse", async () => {
    const ctx = await runInjection("http://localhost/__zerotal/devtools/sse");
    expect(ctx.response?.headers.get("content-type")).toContain("text/event-stream");
    await ctx.response!.body?.cancel();
  });

  it("closes open streams when the app stops, rather than abandoning them", async () => {
    // The body is chunked, so a process that exits with one half-written leaves
    // the browser holding a truncated response and logging
    // ERR_INCOMPLETE_CHUNKED_ENCODING — under `serve --dev` that is every save.
    // Closing writes the terminating chunk, so the reader sees an ending and
    // EventSource reconnects quietly.
    const stop = startDevtoolsStream();
    const ctx = await runInjection("http://localhost/__zerotal/devtools/sse");
    const reader = ctx.response!.body!.getReader();

    const opening = await reader.read();
    expect(opening.done).toBe(false);

    stop();

    // Bounded, because the failure mode is a read that never resolves — an
    // abandoned stream leaves the reader waiting forever, which would hang the
    // suite rather than fail it.
    const ended = await Promise.race([
      (async () => {
        let done = opening.done;
        while (!done) done = (await reader.read()).done;
        return "closed";
      })(),
      Bun.sleep(500).then(() => "still open"),
    ]);
    expect(ended).toBe("closed");
  });

  it("passes regular requests through to next()", async () => {
    const ctx = await runInjection("http://localhost/page");
    expect(ctx.response?.status).toBe(200);
    const text = await ctx.response!.text();
    expect(text).toBe("ok");
  });

  it("passes JSON responses through unchanged", async () => {
    const ctx = HttpContext.fake("http://localhost/api/data");
    const mw = new DevtoolsInjectionMiddleware();
    await RequestContext.run(ctx, async () => {
      const result = await mw.handle(ctx, async () => {
        ctx.response = new Response('{"ok":true}', {
          headers: { "Content-Type": "application/json" },
        });
        return ctx.response;
      });
      if (result instanceof Response) ctx.response = result;
    });
    expect(await ctx.response!.text()).toBe('{"ok":true}');
  });

  it("passes HTML through without modification", async () => {
    const ctx = HttpContext.fake("http://localhost/page");
    const mw = new DevtoolsInjectionMiddleware();
    await RequestContext.run(ctx, async () => {
      const result = await mw.handle(ctx, async () => {
        ctx.response = new Response("<html><body><p>Hello</p></body></html>", {
          headers: { "Content-Type": "text/html" },
        });
        return ctx.response;
      });
      if (result instanceof Response) ctx.response = result;
    });
    const html = await ctx.response!.text();
    expect(html).not.toContain("__ZT_DT__");
    expect(html).toContain("<p>Hello</p>");
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────

/** A complete trace, so the store is exercised against the shape it really holds. */
function trace(id: string): RequestTrace {
  return {
    id,
    requestId: id,
    method: "GET",
    path: "/",
    statusCode: 200,
    startMs: 0,
    durationMs: 1,
    memory: 0,
    queryParams: {},
    headers: {},
    responseHeaders: {},
    session: [],
    route: null,
    auth: null,
    exception: null,
    queries: [],
    warnings: [],
    logs: [],
    mail: [],
    cache: [],
    jobs: [],
    channels: {},
  };
}
