import { describe, it, expect, beforeEach } from "bun:test";
import {
  computeChanged,
  recordFrame,
  getFrames,
  getFramesFor,
  frameBySeq,
  latestFrameFor,
  currentSeq,
  isLive,
  jumpTo,
  resumeLive,
  setTimelineEnabled,
  setTimelineApplier,
  _resetTimeline,
  type TimelineFrame,
} from "./timeline.ts";
import type { Snapshot, SnapshotData } from "../types.ts";

function snap(id: string, data: Record<string, unknown>): Snapshot {
  const d: SnapshotData = {};
  for (const [k, v] of Object.entries(data)) d[k] = [v, {}];
  return { data: d, memo: { id, name: `${id}-Comp`, path: "/t", children: [] }, checksum: "x" };
}

describe("timeline core", () => {
  beforeEach(() => _resetTimeline());

  describe("computeChanged", () => {
    it("detects added, removed, and changed fields", () => {
      const prev = snap("a", { x: 1, y: 2 }).data;
      const next = snap("a", { x: 1, y: 3, z: 9 }).data; // y changed, z added
      expect(computeChanged(prev, next).sort()).toEqual(["y", "z"]);

      const removed = snap("a", { x: 1 }).data; // y removed
      expect(computeChanged(prev, removed)).toEqual(["y"]);
    });

    it("treats a first frame (no prev) as all fields changed", () => {
      const next = snap("a", { x: 1, y: 2 }).data;
      expect(computeChanged(undefined, next).sort()).toEqual(["x", "y"]);
    });
  });

  it("records nothing while disabled", () => {
    expect(
      recordFrame({
        compId: "a",
        compName: "A",
        action: "mount",
        snapshot: snap("a", { x: 0 }),
        html: "<i/>",
      }),
    ).toBeNull();
    expect(getFrames().length).toBe(0);
  });

  it("keeps the call that produced a frame, and omits it where there was none", () => {
    // The devtools Flow tab shows "what was sent" beside "what changed", and the
    // arguments are known only at dispatch — a frame that did not record them can
    // never recover them. A mount had no call, and must not claim one.
    setTimelineEnabled(true);
    const mount = recordFrame({
      compId: "a",
      compName: "A",
      action: "mount",
      snapshot: snap("a", { count: 0 }),
      html: "<i>0</i>",
    });
    const acted = recordFrame({
      compId: "a",
      compName: "A",
      action: "addTo",
      snapshot: snap("a", { count: 5 }),
      html: "<i>5</i>",
      sent: { args: [5], updates: { note: "typed" } },
    });

    expect(mount!.sent).toBeUndefined();
    expect(acted!.sent).toEqual({ args: [5], updates: { note: "typed" } });
  });

  it("records frames with monotonic seq and per-component changed diff", () => {
    setTimelineEnabled(true);
    recordFrame({
      compId: "a",
      compName: "A",
      action: "mount",
      snapshot: snap("a", { count: 0 }),
      html: "<i>0</i>",
    });
    recordFrame({
      compId: "a",
      compName: "A",
      action: "inc",
      snapshot: snap("a", { count: 1 }),
      html: "<i>1</i>",
    });
    recordFrame({
      compId: "b",
      compName: "B",
      action: "mount",
      snapshot: snap("b", { name: "x" }),
      html: "<i/>",
    });

    const frames = getFrames();
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(frames[0]!.changed).toEqual(["count"]); // first frame → all fields
    expect(frames[1]!.changed).toEqual(["count"]); // 0 → 1
    expect(getFramesFor("a").length).toBe(2);
    expect(getFramesFor("b").length).toBe(1);
    expect(frameBySeq(1)?.action).toBe("inc");
    expect(latestFrameFor("a")?.seq).toBe(1);
  });

  it("caps the ring buffer, dropping the oldest frames", () => {
    setTimelineEnabled(true);
    for (let i = 0; i < 260; i++) {
      recordFrame({
        compId: "a",
        compName: "A",
        action: `s${i}`,
        snapshot: snap("a", { i }),
        html: null,
      });
    }
    const frames = getFrames();
    expect(frames.length).toBe(250);
    expect(frames[0]!.action).toBe("s10"); // first 10 dropped
    expect(frames.at(-1)!.action).toBe("s259");
  });

  it("jumpTo applies the frame and tracks the current (rewound) position", () => {
    setTimelineEnabled(true);
    const applied: TimelineFrame[] = [];
    setTimelineApplier((f) => applied.push(f));

    recordFrame({
      compId: "a",
      compName: "A",
      action: "mount",
      snapshot: snap("a", { count: 0 }),
      html: "<i>0</i>",
    });
    recordFrame({
      compId: "a",
      compName: "A",
      action: "inc",
      snapshot: snap("a", { count: 1 }),
      html: "<i>1</i>",
    });
    expect(isLive("a")).toBe(true); // at the latest

    expect(jumpTo(0)).toBe(true);
    expect(applied.at(-1)!.seq).toBe(0);
    expect(currentSeq("a")).toBe(0);
    expect(isLive("a")).toBe(false); // rewound

    expect(resumeLive("a")).toBe(true);
    expect(applied.at(-1)!.seq).toBe(1);
    expect(isLive("a")).toBe(true);
  });

  it("jumpTo returns false for an unknown seq or with no applier", () => {
    setTimelineEnabled(true);
    recordFrame({
      compId: "a",
      compName: "A",
      action: "mount",
      snapshot: snap("a", { x: 1 }),
      html: null,
    });
    expect(jumpTo(999)).toBe(false); // no such frame
    // applier not set (reset) → jump to a real frame still can't apply
    _resetTimeline();
    setTimelineEnabled(true);
    recordFrame({
      compId: "a",
      compName: "A",
      action: "mount",
      snapshot: snap("a", { x: 1 }),
      html: null,
    });
    expect(jumpTo(0)).toBe(false); // no applier injected
  });
});
