import { describe, it, expect } from "bun:test";
import {
  flowSlider,
  flowToggleGroup,
  flowCalendar,
  flowChart,
  flowCommand,
  flowCommandScore,
} from "./headless.ts";

/** A stand-in for the `$flow` magic, recording what a factory writes. */
function magic(initial: Record<string, unknown> = {}) {
  const state = { ...initial };
  return {
    writes: [] as [string, unknown][],
    $get(prop: string) {
      return state[prop];
    },
    $set(prop: string, value: unknown) {
      state[prop] = value;
      this.writes.push([prop, value]);
    },
  };
}

/** Bind a factory to a fake Alpine context. */
function ctx<T extends object>(factory: T, extra: Record<string, unknown> = {}): T & any {
  return Object.assign(factory, { $flow: magic(), $el: { querySelector: () => null }, ...extra });
}

describe("flowSlider", () => {
  it("tracks the value locally while dragging, without telling the server", () => {
    const flow = magic({ volume: 20 });
    const s = ctx(flowSlider({ name: "volume", min: 0, max: 100, step: 1 }), { $flow: flow });
    s.init();

    s.onInput({ target: { value: "75" } } as never);
    expect(s.value).toBe(75);
    expect(s.dragging).toBe(true);
    // The whole point: no round-trip per frame of the drag.
    expect(flow.writes).toHaveLength(0);
  });

  it("syncs once the drag settles", () => {
    const flow = magic({ volume: 20 });
    const s = ctx(flowSlider({ name: "volume", min: 0, max: 100, step: 1 }), { $flow: flow });
    s.init();
    s.onInput({ target: { value: "75" } } as never);
    s.commit();

    expect(flow.writes).toEqual([["volume", 75]]);
    expect(s.dragging).toBe(false);
  });

  it("seeds from the server value, so the first paint is right", () => {
    const s = ctx(flowSlider({ name: "volume", min: 0, max: 100, step: 1 }), {
      $flow: magic({ volume: 42 }),
    });
    s.init();
    expect(s.value).toBe(42);
    expect(s.percent()).toBe(42);
  });

  it("clamps the fill rather than overflowing the track", () => {
    const s = ctx(flowSlider({ name: "v", min: 0, max: 50, step: 1 }), { $flow: magic({ v: 90 }) });
    s.init();
    expect(s.percent()).toBe(100);
  });
});

describe("flowToggleGroup", () => {
  it("flips locally and syncs, so the press lands before the round-trip", () => {
    const flow = magic({ view: "list" });
    const t = ctx(flowToggleGroup({ name: "view" }), { $flow: flow });
    t.init();

    expect(t.isOn("list")).toBe(true);
    t.toggle("grid");
    expect(t.isOn("grid")).toBe(true);
    expect(t.isOn("list")).toBe(false);
    expect(flow.writes).toEqual([["view", "grid"]]);
  });

  it("deselects on a second press, so a single-choice group can be cleared", () => {
    const flow = magic({ view: "list" });
    const t = ctx(flowToggleGroup({ name: "view" }), { $flow: flow });
    t.init();
    t.toggle("list");
    expect(t.selected).toEqual([]);
    expect(flow.writes).toEqual([["view", null]]);
  });

  it("accumulates in multiple mode and writes an array", () => {
    const flow = magic({ tags: ["a"] });
    const t = ctx(flowToggleGroup({ name: "tags", multiple: true }), { $flow: flow });
    t.init();
    t.toggle("b");
    expect(t.selected).toEqual(["a", "b"]);
    expect(flow.writes.at(-1)).toEqual(["tags", ["a", "b"]]);
  });
});

describe("flowCalendar", () => {
  it("pages months on the client, with no write at all", () => {
    const flow = magic();
    const c = ctx(flowCalendar({ name: "due", month: "2026-07" }), { $flow: flow });
    c.init();

    c.shift(1);
    expect(c.month).toBe("2026-08");
    c.shift(-2);
    expect(c.month).toBe("2026-06");
    // Browsing is not data; it never reaches the server.
    expect(flow.writes).toHaveLength(0);
  });

  it("wraps the year in both directions", () => {
    const c = ctx(flowCalendar({ month: "2026-12" }));
    c.init();
    c.shift(1);
    expect(c.month).toBe("2027-01");
    c.shift(-1);
    expect(c.month).toBe("2026-12");
    c.shift(-12);
    expect(c.month).toBe("2025-12");
  });

  it("always yields six weeks, so the grid keeps its height", () => {
    const c = ctx(flowCalendar({ month: "2026-02" }));
    c.init();
    expect(c.cells()).toHaveLength(42);
  });

  it("starts weeks on Monday by default", () => {
    const c = ctx(flowCalendar({ month: "2026-07" }));
    c.init();
    // 1 July 2026 is a Wednesday, so a Monday-first grid opens on 29 June.
    expect(c.cells()[0].day).toBe("2026-06-29");
  });

  it("writes only the chosen day", () => {
    const flow = magic();
    const c = ctx(flowCalendar({ name: "due", month: "2026-07" }), { $flow: flow });
    c.init();
    c.shift(1);
    c.select("2026-08-14");
    expect(flow.writes).toEqual([["due", "2026-08-14"]]);
  });

  it("refuses a day outside the allowed range", () => {
    const flow = magic();
    const c = ctx(flowCalendar({ name: "due", month: "2026-07", min: "2026-07-10" }), {
      $flow: flow,
    });
    c.init();
    c.select("2026-07-01");
    expect(flow.writes).toHaveLength(0);
    expect(c.isDisabled("2026-07-01")).toBe(true);
  });

  it("opens on the bound value's month", () => {
    const c = ctx(flowCalendar({ name: "due", month: "2026-07" }), {
      $flow: magic({ due: "2027-03-02" }),
    });
    c.init();
    expect(c.month).toBe("2027-03");
    expect(c.value).toBe("2027-03-02");
  });
});

describe("flowCommandScore", () => {
  it("matches a subsequence, the way a fuzzy-open does", () => {
    expect(flowCommandScore("New Product", "npr")).toBeGreaterThan(0);
  });

  it("rejects characters that are not all present, in order", () => {
    expect(flowCommandScore("Products", "xyz")).toBe(-1);
    expect(flowCommandScore("Products", "stcudorp")).toBe(-1);
  });

  it("ranks an earlier, tighter match higher", () => {
    expect(flowCommandScore("Products", "prod")).toBeGreaterThan(
      flowCommandScore("Pending Orders", "prod"),
    );
  });

  it("treats an empty query as no opinion, leaving declaration order", () => {
    expect(flowCommandScore("anything", "")).toBe(0);
  });
});

describe("flowCommand", () => {
  const items = [
    { label: "Products", href: "/products", group: "Shop" },
    { label: "Orders", href: "/orders", group: "Shop" },
    { label: "Posts", href: "/posts", group: "Blog" },
  ];

  it("lists everything in declaration order until something is typed", () => {
    const c = ctx(flowCommand({ items }));
    expect(c.results().map((r: { label: string }) => r.label)).toEqual([
      "Products",
      "Orders",
      "Posts",
    ]);
  });

  it("filters and ranks as you type", () => {
    const c = ctx(flowCommand({ items }));
    c.query = "prod";
    expect(c.results()[0].label).toBe("Products");
  });

  it("matches on the group, so typing a cluster name finds what is inside it", () => {
    const c = ctx(flowCommand({ items }));
    c.query = "blog";
    expect(c.results().map((r: { label: string }) => r.label)).toEqual(["Posts"]);
  });

  it("marks only the first row of each group, so the heading renders once", () => {
    const c = ctx(flowCommand({ items }));
    expect(c.startsGroup(0)).toBe(true);
    expect(c.startsGroup(1)).toBe(false);
    expect(c.startsGroup(2)).toBe(true);
  });

  it("keeps the highlight inside the result set", () => {
    const c = ctx(flowCommand({ items }));
    c.move(-1);
    expect(c.active).toBe(0);
    c.move(99);
    expect(c.active).toBe(items.length - 1);
  });
});

describe("flowChart", () => {
  const points = [
    { x: 0, label: "Mon", values: [{ label: "Orders", value: "4", color: "red" }] },
    { x: 0.5, label: "Tue", values: [{ label: "Orders", value: "8", color: "red" }] },
    { x: 1, label: "Wed", values: [{ label: "Orders", value: "6", color: "red" }] },
  ];

  it("picks the nearest point to the pointer", () => {
    const c = ctx(flowChart({ points }), {
      $el: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
    });
    c.onMove({ clientX: 92 } as never);
    expect(c.tip().label).toBe("Wed");
    c.onMove({ clientX: 48 } as never);
    expect(c.tip().label).toBe("Tue");
  });

  it("has no tooltip until the pointer is over it, and drops it on leave", () => {
    const c = ctx(flowChart({ points }), {
      $el: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
    });
    expect(c.tip()).toBeNull();
    c.onMove({ clientX: 10 } as never);
    expect(c.tip()).not.toBeNull();
    c.onLeave();
    expect(c.tip()).toBeNull();
  });

  it("survives a zero-width element rather than dividing by it", () => {
    const c = ctx(flowChart({ points }), {
      $el: { getBoundingClientRect: () => ({ left: 0, width: 0 }) },
    });
    c.onMove({ clientX: 10 } as never);
    expect(c.hover).toBe(-1);
  });
});
