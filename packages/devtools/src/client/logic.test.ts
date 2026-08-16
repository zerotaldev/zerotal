import { describe, it, expect } from "bun:test";
import { matchesFilter } from "./client.ts";
import type { RequestTrace } from "./RequestTrace.ts";

function trace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    id: "t1",
    requestId: "r1",
    method: "GET",
    path: "/posts",
    statusCode: 200,
    startMs: 0,
    durationMs: 1,
    queries: [],
    warnings: [],
    memory: 0,
    queryParams: {},
    headers: {},
    route: { pattern: "/posts", controller: "PostController", action: "index" },
    auth: null,
    logs: [],
    mail: [],
    cache: [],
    jobs: [],
    channels: {},
    ...overrides,
  };
}

describe("matchesFilter", () => {
  it("matches everything when the box is empty or whitespace", () => {
    expect(matchesFilter(trace(), "")).toBe(true);
    expect(matchesFilter(trace(), "   ")).toBe(true);
  });

  it("matches on the path", () => {
    expect(matchesFilter(trace({ path: "/orders/42" }), "orders")).toBe(true);
    expect(matchesFilter(trace({ path: "/orders/42" }), "invoices")).toBe(false);
  });

  it("matches on the method, case-insensitively", () => {
    expect(matchesFilter(trace({ method: "POST" }), "post")).toBe(true);
  });

  it("matches on a bare status code", () => {
    expect(matchesFilter(trace({ statusCode: 500 }), "500")).toBe(true);
    expect(matchesFilter(trace({ statusCode: 200 }), "500")).toBe(false);
  });

  it("matches on the controller and action", () => {
    expect(matchesFilter(trace(), "postcontroller")).toBe(true);
    expect(matchesFilter(trace(), "index")).toBe(true);
  });

  it("narrows with each term rather than widening", () => {
    const failing = trace({ path: "/posts", statusCode: 500 });
    const ok = trace({ path: "/posts", statusCode: 200 });

    expect(matchesFilter(failing, "posts 500")).toBe(true);
    expect(matchesFilter(ok, "posts 500")).toBe(false);
  });

  it("tolerates a trace with no matched route", () => {
    expect(matchesFilter(trace({ route: null }), "posts")).toBe(true);
    expect(matchesFilter(trace({ route: null, path: "/x" }), "posts")).toBe(false);
  });

  it("ignores extra whitespace between terms", () => {
    expect(matchesFilter(trace({ statusCode: 500 }), "  posts    500 ")).toBe(true);
  });
});
