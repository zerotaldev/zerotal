/**
 * The open-channel surface: a package declares how its entries read, records
 * them against a request context, and gets a tab — without devtools shipping a
 * line of code for that package.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { HttpContext, RequestContext, FrameworkEvents, RequestHandled } from "@zerotal/core";
import {
  startDevtoolsTracing,
  stopDevtoolsTracing,
  traceSink,
  traceChannels,
  _resetChannels,
} from "./tracing.ts";
import { TraceStore, traceStore, _setTraceStore } from "./TraceStore.ts";
import { DevtoolsInjectionMiddleware } from "./DevtoolsInjectionMiddleware.ts";

function ctx(url = "http://localhost/"): HttpContext {
  return HttpContext.fake(url);
}

/** Run a request and emit the lifecycle event that finalises its trace. */
async function run(c: HttpContext, body: () => void | Promise<void> = () => {}): Promise<void> {
  const startMs = Date.now();
  await RequestContext.run(c, async () => {
    await body();
    c.response = new Response("ok");
  });
  FrameworkEvents.emit(new RequestHandled(c, startMs, Date.now() - startMs));
}

// The inspector's endpoints are gated; a suite exercising them has to say it is
// a development process. See `enabled.ts`.
const priorEnv = Bun.env["APP_ENV"];

beforeAll(() => {
  Bun.env["APP_ENV"] = "development";
  // Memory-only: a test suite must not write a database into the package directory.
  _setTraceStore(new TraceStore({ dbPath: null }));
  startDevtoolsTracing();
});

afterAll(() => {
  if (priorEnv === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = priorEnv;
  stopDevtoolsTracing();
  _setTraceStore(null);
  FrameworkEvents.clear();
});

beforeEach(() => {
  traceStore().clear();
  _resetChannels();
});

describe("channel registry", () => {
  it("declares a channel and returns it in display order", () => {
    traceSink.channel({ id: "b", label: "Bravo", order: 20 });
    traceSink.channel({ id: "a", label: "Alpha", order: 10 });

    expect(traceChannels().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("defaults undeclared order to the back of the strip", () => {
    traceSink.channel({ id: "early", label: "Early", order: 5 });
    traceSink.channel({ id: "late", label: "Late" });

    expect(traceChannels().map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("breaks an order tie by label so the strip is stable", () => {
    traceSink.channel({ id: "z", label: "Zulu" });
    traceSink.channel({ id: "m", label: "Mike" });

    expect(traceChannels().map((c) => c.label)).toEqual(["Mike", "Zulu"]);
  });

  it("re-declaring an id replaces it rather than duplicating the tab", () => {
    traceSink.channel({ id: "auth", label: "Auth" });
    traceSink.channel({ id: "auth", label: "Authentication" });

    expect(traceChannels()).toHaveLength(1);
    expect(traceChannels()[0]!.label).toBe("Authentication");
  });
});

describe("recording channel entries", () => {
  it("lands entries on the trace under their channel id", async () => {
    traceSink.channel({ id: "auth", label: "Auth", badge: "event" });

    const c = ctx("http://localhost/login");
    await run(c, () => {
      traceSink.record(c, "auth", { event: "login", user: "ada" });
    });

    const trace = traceStore().all()[0]!;
    expect(trace.channels["auth"]).toHaveLength(1);
    expect(trace.channels["auth"]![0]!["event"]).toBe("login");
    expect(trace.channels["auth"]![0]!["user"]).toBe("ada");
  });

  it("stamps each entry's offset from the request start", async () => {
    const c = ctx("http://localhost/x");
    await run(c, async () => {
      traceSink.record(c, "auth", { event: "first" });
      await Bun.sleep(12);
      traceSink.record(c, "auth", { event: "second" });
    });

    const entries = traceStore().all()[0]!.channels["auth"]!;
    expect(entries[0]!.offsetMs).toBeGreaterThanOrEqual(0);
    expect(entries[1]!.offsetMs).toBeGreaterThanOrEqual(entries[0]!.offsetMs);
  });

  it("keeps separate channels separate", async () => {
    const c = ctx("http://localhost/x");
    await run(c, () => {
      traceSink.record(c, "auth", { event: "login" });
      traceSink.record(c, "flow", { component: "Counter" });
    });

    const trace = traceStore().all()[0]!;
    expect(Object.keys(trace.channels).sort()).toEqual(["auth", "flow"]);
  });

  it("records against an undeclared channel, so a late declaration still shows the entries", async () => {
    const c = ctx("http://localhost/x");
    await run(c, () => {
      traceSink.record(c, "not-yet-declared", { detail: "buffered anyway" });
    });

    expect(traceStore().all()[0]!.channels["not-yet-declared"]).toHaveLength(1);
  });

  it("leaves channels empty when nothing was recorded", async () => {
    await run(ctx("http://localhost/quiet"));
    expect(traceStore().all()[0]!.channels).toEqual({});
  });

  it("does not leak entries from one request into the next", async () => {
    const first = ctx("http://localhost/one");
    await run(first, () => traceSink.record(first, "auth", { event: "login" }));

    const second = ctx("http://localhost/two");
    await run(second);

    const traces = traceStore().all();
    expect(traces[0]!.path).toBe("/two");
    expect(traces[0]!.channels).toEqual({});
    expect(traces[1]!.channels["auth"]).toHaveLength(1);
  });
});

describe("presentation hints", () => {
  // The panel picks a tree, a table, or a grouped list from these. They cross the
  // wire as data like every other field on the descriptor, which is the whole
  // reason a package can have a prop tree without shipping a renderer into
  // devtools — so what matters here is that they survive the trip intact.

  it("carries the render hints to the panel unchanged", async () => {
    traceSink.channel({
      id: "inertia",
      label: "Inertia",
      badge: "requestType",
      render: "tree",
      treeField: "propMeta",
      treeBadge: "inertiaType",
      flags: ["shared", "once"],
      traceGroup: "batchId",
    });

    const c = ctx("http://localhost/__zerotal/devtools/api/channels");
    const res = (await new DevtoolsInjectionMiddleware().handle(
      c as never,
      async () => undefined,
    )) as Response;

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({
      id: "inertia",
      render: "tree",
      treeField: "propMeta",
      treeBadge: "inertiaType",
      flags: ["shared", "once"],
      traceGroup: "batchId",
    });
  });

  it("leaves a descriptor that declares none of them alone", async () => {
    // The default is the flat row list every existing channel already gets.
    traceSink.channel({ id: "auth", label: "Auth", badge: "event", warn: "failed" });

    const c = ctx("http://localhost/__zerotal/devtools/api/channels");
    const res = (await new DevtoolsInjectionMiddleware().handle(
      c as never,
      async () => undefined,
    )) as Response;

    const body = (await res.json()) as Array<{ id: string; warn?: string; render?: string }>;
    expect(body[0]!.id).toBe("auth");
    expect(body[0]!.warn).toBe("failed");
    expect(body[0]!.render).toBeUndefined();
  });
});

describe("one request, both halves", () => {
  it("puts a channel entry and that request's queries on the same trace", async () => {
    // The join Phase 2 exists for. Nothing matches a key: an entry recorded
    // against the request context lands on that request's trace by construction,
    // so "is this page slow because of the query or the deferred prop" is one
    // view rather than two tools that cannot see each other.
    const { SQL } = await import("bun");
    const { QueryBuilder } = await import("@zerotal/orm");
    const { installOrmObservability } = await import("@zerotal/orm");

    const dispose = installOrmObservability({
      container: { tryMake: (k: string) => (k === "devtools.trace" ? traceSink : undefined) },
    } as never);
    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE ch_posts (id INTEGER PRIMARY KEY)`;

    traceSink.channel({ id: "inertia", label: "Inertia", render: "tree", treeField: "propMeta" });

    const c = ctx("http://localhost/posts");
    await run(c, async () => {
      await new QueryBuilder("ch_posts", db).get();
      traceSink.record(c, "inertia", {
        component: "Posts/Index",
        propMeta: { posts: { inertiaType: "defer" } },
      });
    });

    const trace = traceStore().all()[0]!;
    expect(trace.queries).toHaveLength(1);
    expect(trace.channels["inertia"]).toHaveLength(1);
    expect(trace.requestId).toBe(c.requestId);

    await db.end();
    dispose();
  });
});

describe("the trace's own fields", () => {
  it("reports heap in use rather than a hardcoded zero", async () => {
    // `memory` was documented and rendered in three places while always being 0.
    await run(ctx("http://localhost/mem"));
    expect(traceStore().all()[0]!.memory).toBeGreaterThan(0);
  });
});
