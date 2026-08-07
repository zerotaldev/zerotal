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

beforeAll(() => {
  // Memory-only: a test suite must not write a database into the package directory.
  _setTraceStore(new TraceStore({ dbPath: null }));
  startDevtoolsTracing();
});

afterAll(() => {
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

describe("GET /api/channels", () => {
  it("serves the declared descriptors", async () => {
    traceSink.channel({ id: "auth", label: "Auth", badge: "event", warn: "failed" });

    const c = ctx("http://localhost/__zerotal/devtools/api/channels");
    const res = (await new DevtoolsInjectionMiddleware().handle(
      c as never,
      async () => undefined,
    )) as Response;

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; warn?: string }>;
    expect(body[0]!.id).toBe("auth");
    expect(body[0]!.warn).toBe("failed");
  });
});

describe("the trace's own fields", () => {
  it("reports heap in use rather than a hardcoded zero", async () => {
    // `memory` was documented and rendered in three places while always being 0.
    await run(ctx("http://localhost/mem"));
    expect(traceStore().all()[0]!.memory).toBeGreaterThan(0);
  });
});
