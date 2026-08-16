/**
 * Which views a time-travel frame offers, and which one is showing.
 *
 * Tested here rather than in a browser because the interesting frames need a
 * signed-in session to produce: the query an action runs is usually the auth
 * middleware loading the user, so a headless run sees a server pane with nothing
 * under it and never exercises the cases that matter.
 */
import { describe, it, expect } from "bun:test";
import { activePane, brief, framePanes, renderFramePanes, snapshotValue } from "./framePanes.ts";
import type { FrameServerCost } from "./framePanes.ts";
import type { TimelineFrame } from "./timeline.ts";

function frame(over: Partial<TimelineFrame> = {}): TimelineFrame {
  return {
    seq: 1,
    compId: "counterpage-1",
    compName: "CounterPage",
    action: "increment",
    snapshot: { data: { count: [2, {}] }, memo: {} } as unknown as TimelineFrame["snapshot"],
    changed: ["count"],
    html: null,
    ts: 0,
    ...over,
  };
}

function cost(over: Partial<FrameServerCost> = {}): FrameServerCost {
  return {
    durationMs: 5,
    ip: "::1",
    statusCode: 204,
    queries: [],
    logs: [],
    error: null,
    ...over,
  };
}

const ids = (panes: ReturnType<typeof framePanes>): string[] => panes.map((p) => p.id);

describe("framePanes", () => {
  it("offers a Queries pane, counted, when the action ran SQL", () => {
    const panes = framePanes(
      frame(),
      [frame()],
      cost({
        queries: [
          { sql: "select * from users where id = ?", durationMs: 1, rowCount: 1 },
          { sql: "select * from posts", durationMs: 4, rowCount: 12 },
        ],
      }),
    );

    expect(ids(panes)).toContain("queries");
    expect(panes.find((p) => p.id === "queries")!.count).toBe(2);
    expect(panes.find((p) => p.id === "queries")!.html).toContain("select * from users");
  });

  it("leaves the Queries pane out when it ran none", () => {
    expect(ids(framePanes(frame(), [frame()], cost()))).not.toContain("queries");
  });

  it("offers a Logs pane only when the action logged", () => {
    expect(ids(framePanes(frame(), [frame()], cost()))).not.toContain("logs");
    const withLogs = framePanes(
      frame(),
      [frame()],
      cost({ logs: [{ level: "warn", text: "slow" }] }),
    );
    expect(ids(withLogs)).toContain("logs");
    expect(withLogs.find((p) => p.id === "logs")!.count).toBe(1);
  });

  it("says a client expression never left the browser, rather than showing an empty server pane", () => {
    const panes = framePanes(frame({ action: "$set" }), [frame()], null);
    expect(ids(panes)).toEqual(["state", "server"]);
    expect(panes.find((p) => p.id === "server")!.html).toContain("Ran in the browser");
  });

  it("shows what the call sent, and omits the pane for a frame that sent nothing", () => {
    expect(ids(framePanes(frame(), [frame()], null))).not.toContain("sent");
    const panes = framePanes(
      frame({ sent: { args: [5], updates: { note: "typed" } } }),
      [frame()],
      null,
    );
    const sent = panes.find((p) => p.id === "sent")!;
    expect(sent.html).toContain("increment");
    expect(sent.html).toContain("5");
    expect(sent.html).toContain("note");
  });

  it("puts the error where the reader will meet it, on the Server pane", () => {
    const panes = framePanes(frame(), [frame()], cost({ error: "Boom in increment()" }));
    expect(panes.find((p) => p.id === "server")!.html).toContain("Boom in increment()");
  });

  it("diffs against this component's previous frame, not the previous frame overall", () => {
    const older = frame({
      seq: 1,
      snapshot: { data: { count: [1, {}] }, memo: {} } as unknown as TimelineFrame["snapshot"],
    });
    const other = frame({ seq: 2, compId: "other-1", compName: "Other" });
    const current = frame({ seq: 3 });

    const state = framePanes(current, [older, other, current], null).find((p) => p.id === "state")!;
    expect(state.html).toContain("1");
    expect(state.html).toContain("2");
    expect(state.count).toBe(1);
  });
});

describe("activePane", () => {
  it("keeps what the reader picked when the frame in hand has it", () => {
    const panes = framePanes(
      frame(),
      [frame()],
      cost({ queries: [{ sql: "x", durationMs: 1, rowCount: 0 }] }),
    );
    expect(activePane("queries", panes)).toBe("queries");
  });

  it("falls back to the first pane rather than showing nothing", () => {
    // Stepping from an action that queried to one that did not must not leave the
    // frame blank; the preference itself is kept for the next one that has it.
    expect(activePane("queries", framePanes(frame(), [frame()], cost()))).toBe("state");
    expect(activePane("queries", [])).toBe("");
  });
});

describe("renderFramePanes", () => {
  it("marks the showing tab and renders only its body", () => {
    const panes = framePanes(
      frame({ sent: { args: [] } }),
      [frame()],
      cost({ queries: [{ sql: "select 1", durationMs: 1, rowCount: 1 }] }),
    );
    const html = renderFramePanes(panes, "queries");

    expect(html).toContain('data-fsec="queries"');
    expect(html).toContain('class="dsect on" data-fsec="queries"');
    expect(html).toContain("select 1");
    // The other panes are tabs, not bodies — one body at a time.
    expect(html).not.toContain("Ran in the browser");
  });

  it("renders nothing at all for a frame with no panes", () => {
    expect(renderFramePanes([], "sent")).toBe("");
  });
});

describe("value formatting", () => {
  it("unwraps a snapshot tuple so a diff reads 1 → 2", () => {
    expect(snapshotValue([1, {}])).toBe(1);
    expect(snapshotValue(["ada", {}])).toBe("ada");
  });

  it("keeps the metadata when there is any", () => {
    expect(snapshotValue([1, { cast: "int" }])).toEqual({ value: 1, meta: { cast: "int" } });
  });

  it("truncates rather than wrapping", () => {
    expect(brief("x".repeat(300), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
