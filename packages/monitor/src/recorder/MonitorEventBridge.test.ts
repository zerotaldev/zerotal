import { describe, it, expect, afterEach } from "bun:test";
import {
  FrameworkEvents,
  RequestHandled,
  RequestFailed,
  OutgoingRequestCompleted,
} from "@zerotal/core";
import { MonitorStore } from "../MonitorStore.ts";
import { installMonitorEventBridge } from "./MonitorEventBridge.ts";

// The host bridge owns only the core request lifecycle + the per-request
// correlation drain. Feature packages contribute their own events (queries, cache,
// mail, jobs, auth, realtime) through the store — they buffer against a context
// with store.bufferQuery / markNPlus, exactly as the ORM's own bridge does here.

describe("MonitorEventBridge", () => {
  afterEach(() => FrameworkEvents.clear());

  it("records a request with the queries buffered against its context", async () => {
    const store = new MonitorStore({ slowQueryMs: 10 });
    const dispose = installMonitorEventBridge(store);

    const ctx = {
      request: { method: "GET" },
      url: { pathname: "/posts/42" },
      response: { status: 200 },
      _routeDef: { pattern: "/posts/:id" },
      user: { email: "u@x.com", id: 7 },
      ip: () => "1.2.3.4",
    };
    // A feature package (the ORM) buffers its queries against the context while the
    // request is in flight; the bridge drains them when the request finalises.
    store.bufferQuery(ctx, { ms: 8, sql: "SELECT * FROM posts" });
    store.bufferQuery(ctx, { ms: 4, sql: "SELECT * FROM comments" });
    FrameworkEvents.emit(new RequestHandled(ctx, 0, 30));

    const snap = await store.snapshot("1h");
    const row = snap.requests.find((r) => r.path === "/posts/:id");
    expect(row).toBeDefined();
    expect(row!.method).toBe("GET");
    expect(row!.queries).toHaveLength(2);
    expect(row!.queries[0]!.sql).toContain("FROM posts");
    // User (email preferred) and IP captured from the context.
    expect(row!.user).toBe("u@x.com");
    expect(row!.ip).toBe("1.2.3.4");
    // Route grouped by the matched template, not the raw path.
    expect(row!.path).toBe("/posts/:id");

    dispose();
  });

  it("ignores the panel's own routes and internal paths", async () => {
    const store = new MonitorStore();
    const dispose = installMonitorEventBridge(store);

    FrameworkEvents.emit(
      new RequestHandled(
        {
          request: { method: "GET" },
          url: { pathname: "/monitor/requests" },
          response: { status: 200 },
        },
        0,
        5,
      ),
    );
    const snap = await store.snapshot("1h");
    expect(snap.requests).toHaveLength(0);
    dispose();
  });

  it("records a failed request as a grouped exception linked to its trace", async () => {
    const store = new MonitorStore({ slowQueryMs: 10 });
    const dispose = installMonitorEventBridge(store);

    FrameworkEvents.emit(
      new RequestFailed(
        { url: { pathname: "/checkout" } },
        0,
        12,
        "ValidationError: bad input",
        422,
      ),
    );

    const snap = await store.snapshot("1h");

    // Exceptions — grouped with the recovered type + request path.
    const exc = snap.exceptions.find((e) => e.type === "ValidationError");
    expect(exc).toBeDefined();
    expect(exc!.location).toBe("/checkout");

    // The failed request links to its error so its trace explains the failure.
    const failed = snap.requests.find((r) => r.path === "/checkout");
    expect(failed!.status).toBe(422);
    expect(failed!.error).toBe("ValidationError: bad input");

    dispose();
  });

  it("records outgoing HTTP calls", async () => {
    const store = new MonitorStore();
    const dispose = installMonitorEventBridge(store);

    FrameworkEvents.emit(
      new OutgoingRequestCompleted(
        "api.stripe.com",
        "POST",
        "https://api.stripe.com/v1/charges",
        200,
        42,
        true,
      ),
    );

    const snap = await store.snapshot("1h");
    expect(snap.outgoingHttp.some((h) => h.host === "api.stripe.com")).toBe(true);
    dispose();
  });

  it("stops recording after dispose()", async () => {
    const store = new MonitorStore();
    const dispose = installMonitorEventBridge(store);
    dispose();

    FrameworkEvents.emit(
      new RequestHandled(
        {
          request: { method: "GET" },
          url: { pathname: "/after-dispose" },
          response: { status: 200 },
        },
        0,
        5,
      ),
    );
    const snap = await store.snapshot("1h");
    expect(snap.requests.some((r) => r.path === "/after-dispose")).toBe(false);
  });
});
