/**
 * The panel's logic, without a DOM.
 *
 * Almost none of this was reachable before the client became a directory: it
 * lived inside the closure `DevTools.start()` opened, so the only thing a test
 * could see was `matchesFilter`. Filtering, folding, and windowing are now
 * ordinary exported functions, and this is the file that keeps them honest.
 */
import { describe, it, expect } from "bun:test";
import {
  buildPathTree,
  facetsActive,
  foldTraceRows,
  matchesFacets,
  matchesFilter,
  methodsPresent,
  noFacets,
  traceGroupKey,
  traceMatches,
  SLOW_MS,
} from "./index.ts";
import { fmt } from "./ui/format.ts";
import type { Facets, PathTreeNode } from "./index.ts";
// By path: the All tab's own mechanics are internal, and a same-package test
// reaching for them is not a reason to widen what the package promises.
import { toggleFacet, windowRange } from "./tabs/all.ts";
import type { RequestTrace, TraceChannelDescriptor } from "../RequestTrace.ts";

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
    responseHeaders: {},
    session: [],
    route: { pattern: "/posts", controller: "PostController", action: "index" },
    auth: null,
    exception: null,
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

describe("buildPathTree", () => {
  /** Walk the tree by dotted path, so assertions read like the input did. */
  function at(tree: Map<string, PathTreeNode>, path: string): PathTreeNode | undefined {
    let node: PathTreeNode | undefined;
    let level = tree;
    for (const part of path.split(".")) {
      node = level.get(part);
      if (!node) return undefined;
      level = node.children;
    }
    return node;
  }

  it("keeps a flat map flat", () => {
    const tree = buildPathTree([
      ["title", {}],
      ["posts", { inertiaType: "defer" }],
    ]);
    expect([...tree.keys()]).toEqual(["title", "posts"]);
    expect(tree.get("posts")!.children.size).toBe(0);
    expect(tree.get("posts")!.attrs).toEqual({ inertiaType: "defer" });
  });

  it("folds a shared prefix into one branch", () => {
    const tree = buildPathTree([
      ["user.name", {}],
      ["user.email", { shared: true }],
    ]);
    expect(tree.size).toBe(1);
    expect([...tree.get("user")!.children.keys()]).toEqual(["name", "email"]);
    expect(at(tree, "user.email")!.attrs).toEqual({ shared: true });
  });

  it("leaves an intermediate branch's attrs null when nothing was recorded against it", () => {
    // The difference between "recorded as an empty object" and "never mentioned"
    // is exactly what a debugging tool must not blur.
    const tree = buildPathTree([["a.b.c", { once: true }]]);
    expect(at(tree, "a")!.attrs).toBeNull();
    expect(at(tree, "a.b")!.attrs).toBeNull();
    expect(at(tree, "a.b.c")!.attrs).toEqual({ once: true });
  });

  it("lets a node be both a branch and a leaf", () => {
    const tree = buildPathTree([
      ["user", { shared: true }],
      ["user.name", {}],
    ]);
    expect(tree.get("user")!.attrs).toEqual({ shared: true });
    expect(tree.get("user")!.children.size).toBe(1);
  });

  it("records a non-object attribute as an empty node rather than dropping the path", () => {
    const tree = buildPathTree([["stats", "not-an-object"]]);
    expect(tree.get("stats")!.attrs).toEqual({});
  });

  it("returns an empty tree for no paths", () => {
    expect(buildPathTree([]).size).toBe(0);
  });
});

describe("traceGroupKey", () => {
  const inertia: TraceChannelDescriptor = {
    id: "inertia",
    label: "Inertia",
    traceGroup: "batchId",
  };
  const auth: TraceChannelDescriptor = { id: "auth", label: "Auth" };

  function withBatch(batchId: unknown): RequestTrace {
    return trace({ channels: { inertia: [{ offsetMs: 0, batchId }] } });
  }

  it("keys a trace by the field the channel nominated", () => {
    expect(traceGroupKey(withBatch("visit-1"), [inertia])).toBe("inertia:visit-1");
  });

  it("puts two traces of one batch under the same key", () => {
    expect(traceGroupKey(withBatch("v"), [inertia])).toBe(traceGroupKey(withBatch("v"), [inertia]));
  });

  it("returns null when no channel correlates traces", () => {
    expect(traceGroupKey(withBatch("visit-1"), [auth])).toBeNull();
  });

  it("returns null when the channel recorded nothing on this trace", () => {
    expect(traceGroupKey(trace(), [inertia])).toBeNull();
  });

  it("treats a null or empty value as uncorrelated rather than as a group", () => {
    // Otherwise every trace without a batch collapses into one huge group.
    expect(traceGroupKey(withBatch(null), [inertia])).toBeNull();
    expect(traceGroupKey(withBatch(""), [inertia])).toBeNull();
  });

  it("namespaces the key by channel, so two channels cannot collide on a value", () => {
    const other: TraceChannelDescriptor = { id: "flow", label: "Flow", traceGroup: "batchId" };
    const t = trace({ channels: { flow: [{ offsetMs: 0, batchId: "visit-1" }] } });
    expect(traceGroupKey(t, [other])).toBe("flow:visit-1");
    expect(traceGroupKey(t, [other])).not.toBe(traceGroupKey(withBatch("visit-1"), [inertia]));
  });
});

// ── Facets ────────────────────────────────────────────────────────────────────

describe("matchesFacets", () => {
  const on = (patch: Partial<Facets>): Facets => ({ ...noFacets(), ...patch });

  it("matches everything when nothing is selected", () => {
    expect(matchesFacets(trace(), noFacets())).toBe(true);
  });

  it("treats values within one facet as alternatives", () => {
    const f = on({ methods: ["GET", "POST"] });
    expect(matchesFacets(trace({ method: "GET" }), f)).toBe(true);
    expect(matchesFacets(trace({ method: "POST" }), f)).toBe(true);
    expect(matchesFacets(trace({ method: "DELETE" }), f)).toBe(false);
  });

  it("compounds across facets rather than widening", () => {
    // POST *and* 5xx means failing writes, not writes-or-failures.
    const f = on({ methods: ["POST"], statusClasses: ["5"] });
    expect(matchesFacets(trace({ method: "POST", statusCode: 500 }), f)).toBe(true);
    expect(matchesFacets(trace({ method: "POST", statusCode: 200 }), f)).toBe(false);
    expect(matchesFacets(trace({ method: "GET", statusCode: 500 }), f)).toBe(false);
  });

  it("matches a status class by its leading digit", () => {
    const f = on({ statusClasses: ["4"] });
    expect(matchesFacets(trace({ statusCode: 404 }), f)).toBe(true);
    expect(matchesFacets(trace({ statusCode: 422 }), f)).toBe(true);
    expect(matchesFacets(trace({ statusCode: 500 }), f)).toBe(false);
  });

  it("counts a 4xx or 5xx as an error even when nothing threw", () => {
    // A rendered 404 is a failed request to anyone reading this list; the trace
    // only carries an `exception` when an error escaped the pipeline.
    const f = on({ errors: true });
    expect(matchesFacets(trace({ statusCode: 404 }), f)).toBe(true);
    expect(matchesFacets(trace({ statusCode: 200 }), f)).toBe(false);
    expect(
      matchesFacets(trace({ statusCode: 200, exception: { message: "x", status: 200 } }), f),
    ).toBe(true);
  });

  it("draws the slow line where the duration colouring already does", () => {
    const f = on({ slow: true });
    expect(matchesFacets(trace({ durationMs: SLOW_MS + 1 }), f)).toBe(true);
    expect(matchesFacets(trace({ durationMs: SLOW_MS }), f)).toBe(false);
  });

  it("selects only traces carrying an N+1 warning", () => {
    const f = on({ nPlusOne: true });
    expect(matchesFacets(trace({ warnings: [{ sql: "select 1", count: 3 }] }), f)).toBe(true);
    expect(matchesFacets(trace(), f)).toBe(false);
  });
});

describe("traceMatches", () => {
  it("requires the text and the facets to agree", () => {
    const t = trace({ path: "/posts", statusCode: 500, method: "POST" });
    expect(traceMatches(t, "posts", { ...noFacets(), methods: ["POST"] })).toBe(true);
    expect(traceMatches(t, "orders", { ...noFacets(), methods: ["POST"] })).toBe(false);
    expect(traceMatches(t, "posts", { ...noFacets(), methods: ["GET"] })).toBe(false);
  });
});

describe("toggleFacet", () => {
  it("adds and removes a method", () => {
    const once = toggleFacet(noFacets(), "method", "GET");
    expect(once.methods).toEqual(["GET"]);
    expect(toggleFacet(once, "method", "GET").methods).toEqual([]);
  });

  it("flips the boolean facets", () => {
    expect(toggleFacet(noFacets(), "slow", "").slow).toBe(true);
    expect(toggleFacet(noFacets(), "errors", "").errors).toBe(true);
    expect(toggleFacet(noFacets(), "nplus", "").nPlusOne).toBe(true);
  });

  it("clears everything at once", () => {
    const busy = { ...noFacets(), methods: ["GET"], slow: true, statusClasses: ["5"] };
    expect(toggleFacet(busy, "clear", "")).toEqual(noFacets());
  });

  it("does not modify the set it was given", () => {
    const before = noFacets();
    toggleFacet(before, "method", "GET");
    expect(before.methods).toEqual([]);
  });

  it("ignores a kind it does not know", () => {
    const f = noFacets();
    expect(toggleFacet(f, "nonsense", "x")).toBe(f);
  });
});

describe("facetsActive", () => {
  it("is false only when nothing narrows", () => {
    expect(facetsActive(noFacets())).toBe(false);
    expect(facetsActive({ ...noFacets(), slow: true })).toBe(true);
    expect(facetsActive({ ...noFacets(), methods: ["GET"] })).toBe(true);
  });
});

describe("methodsPresent", () => {
  it("offers only the methods actually recorded, sorted", () => {
    // Listing every HTTP verb would put five dead chips on screen for an app
    // that only ever GETs.
    const traces = [trace({ method: "POST" }), trace({ method: "GET" }), trace({ method: "GET" })];
    expect(methodsPresent(traces)).toEqual(["GET", "POST"]);
  });

  it("is empty for no traces", () => {
    expect(methodsPresent([])).toEqual([]);
  });
});

// ── Folding correlated requests ───────────────────────────────────────────────

describe("foldTraceRows", () => {
  const inertia: TraceChannelDescriptor = {
    id: "inertia",
    label: "Inertia",
    traceGroup: "batchId",
  };

  /** Newest-first, as the panel holds them. */
  function batch(id: string, batchId?: string): RequestTrace {
    return trace({
      id,
      ...(batchId ? { channels: { inertia: [{ offsetMs: 0, batchId }] } } : {}),
    });
  }

  function matches(...traces: RequestTrace[]) {
    return traces.map((trace, index) => ({ trace, index }));
  }

  it("leaves uncorrelated traces as one row each", () => {
    const rows = foldTraceRows(matches(batch("a"), batch("b")), [inertia], new Set());
    expect(rows.map((r) => r.trace.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.groupKey === undefined)).toBe(true);
  });

  it("never merges two uncorrelated traces with each other", () => {
    // The fallback key has to be unique, not shared.
    const rows = foldTraceRows(matches(batch("a"), batch("b"), batch("c")), [inertia], new Set());
    expect(rows).toHaveLength(3);
  });

  it("folds a batch under its oldest member", () => {
    // Newest first, so the visit that started the batch is last in the input.
    const rows = foldTraceRows(
      matches(batch("deferred", "v1"), batch("visit", "v1")),
      [inertia],
      new Set(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trace.id).toBe("visit");
    expect(rows[0]!.groupSize).toBe(1);
  });

  it("keeps the group where its newest member sits", () => {
    // A batch still receiving follow-ups must not sink down the list as it grows.
    const rows = foldTraceRows(
      matches(batch("newest", "v1"), batch("loner"), batch("visit", "v1")),
      [inertia],
      new Set(),
    );
    expect(rows.map((r) => r.trace.id)).toEqual(["visit", "loner"]);
  });

  it("reveals the follow-ups once the group is expanded", () => {
    const rows = foldTraceRows(
      matches(batch("deferred", "v1"), batch("visit", "v1")),
      [inertia],
      new Set(["inertia:v1"]),
    );
    expect(rows.map((r) => [r.trace.id, r.child])).toEqual([
      ["visit", false],
      ["deferred", true],
    ]);
  });

  it("carries the index into the unfiltered list, so a click still selects right", () => {
    const rows = foldTraceRows(
      [
        { trace: batch("x"), index: 7 },
        { trace: batch("y"), index: 9 },
      ],
      [inertia],
      new Set(),
    );
    expect(rows.map((r) => r.index)).toEqual([7, 9]);
  });

  it("is a flat list, so windowing has something to slice", () => {
    const rows = foldTraceRows(
      matches(batch("a", "v"), batch("b", "v"), batch("c", "v")),
      [inertia],
      new Set(["inertia:v"]),
    );
    expect(rows).toHaveLength(3);
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ── Windowed rendering ────────────────────────────────────────────────────────

describe("windowRange", () => {
  it("draws a short list whole", () => {
    // Windowing a short list costs more than it saves, and makes the browser's
    // own find-in-page useless for no reason.
    expect(windowRange(50, 0, 400, 60)).toEqual({ first: 0, count: 50 });
  });

  it("draws only what the viewport can reach once the list is long", () => {
    const { first, count } = windowRange(5000, 0, 400, 0);
    expect(first).toBe(0);
    expect(count).toBeLessThan(100);
    expect(count).toBeGreaterThan(400 / 26);
  });

  it("moves the window with the scroll offset", () => {
    const top = windowRange(5000, 0, 400, 0);
    const deep = windowRange(5000, 5200, 400, 0);
    expect(deep.first).toBeGreaterThan(top.first);
  });

  it("discounts the sticky header, so the first row is not skipped", () => {
    // The filter bar and facet strip sit above the rows inside the same scroller.
    expect(windowRange(5000, 60, 400, 60).first).toBe(0);
  });

  it("never runs past the end of the list", () => {
    const { first, count } = windowRange(300, 100_000, 400, 0);
    expect(first + count).toBeLessThanOrEqual(300);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("never asks for a negative offset", () => {
    expect(windowRange(5000, -50, 400, 60).first).toBe(0);
  });
});

describe("fmt", () => {
  // Both ends of this were wrong at once. A duration measured with
  // performance.now() was interpolated raw, so the always-visible status bar read
  // `3.6370999999926426ms`; a duration a caller had already rounded read `0ms`
  // for a query that plainly took time. Precision has to follow magnitude.

  it("does not print the whole float a high-resolution timer produced", () => {
    expect(fmt(3.6370999999926426)).toBe("3.6ms");
    expect(fmt(2.2338999999992666)).toBe("2.2ms");
  });

  it("keeps the digits that matter below a millisecond", () => {
    expect(fmt(0.42)).toBe("0.42ms");
    expect(fmt(0.4)).toBe("0.4ms");
  });

  it("drops the decimal once it stops carrying information", () => {
    expect(fmt(142.6)).toBe("143ms");
    expect(fmt(30)).toBe("30ms");
    expect(fmt(3)).toBe("3ms");
  });

  it("switches to seconds, and keeps a zero honest", () => {
    expect(fmt(1400)).toBe("1.4s");
    expect(fmt(12_500)).toBe("12.5s");
    expect(fmt(0)).toBe("0ms");
  });

  it("says nothing rather than NaNms when there is no measurement", () => {
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(-1)).toBe("—");
  });
});
