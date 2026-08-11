/**
 * The bounded structures behind the panel's series.
 *
 * These exist so a long-running process cannot grow its monitoring data without
 * limit, which makes their eviction behaviour the thing worth testing: a buffer
 * that quietly stops evicting is a memory leak in the observability layer, and a
 * percentile that is off by one index misreports latency in the direction nobody
 * checks.
 */
import { describe, it, expect } from "bun:test";
import { RingBuffer, TimeWindow, percentile } from "./RingBuffer.ts";

describe("RingBuffer", () => {
  it("starts pre-filled to capacity so a sparkline has a full x-axis", () => {
    const b = new RingBuffer(4);
    expect(b.values()).toEqual([0, 0, 0, 0]);
    expect(new RingBuffer(3, 7).values()).toEqual([7, 7, 7]);
  });

  it("evicts the oldest sample once at capacity", () => {
    const b = new RingBuffer(3);
    b.push(1);
    b.push(2);
    b.push(3);
    expect(b.values()).toEqual([1, 2, 3]);
    b.push(4);
    expect(b.values()).toEqual([2, 3, 4]);
  });

  it("never grows past capacity, however many samples arrive", () => {
    const b = new RingBuffer(5);
    for (let i = 0; i < 1000; i++) b.push(i);
    expect(b.values()).toHaveLength(5);
    expect(b.values()).toEqual([995, 996, 997, 998, 999]);
  });

  it("clamps a nonsensical capacity to one rather than producing an empty buffer", () => {
    // `avg()` and `last()` guard against an empty series, but a zero-capacity
    // buffer would silently discard every sample instead of reporting anything.
    for (const capacity of [0, -5]) {
      const b = new RingBuffer(capacity);
      b.push(42);
      expect(b.values()).toEqual([42]);
      expect(b.last()).toBe(42);
    }
  });

  it("reports last, avg and sum over the retained window only", () => {
    const b = new RingBuffer(3);
    b.push(10);
    b.push(20);
    b.push(30);
    expect(b.last()).toBe(30);
    expect(b.sum()).toBe(60);
    expect(b.avg()).toBe(20);
    // 10 falls out; the statistics must follow the window, not all history.
    b.push(60);
    expect(b.sum()).toBe(110);
    expect(b.avg()).toBeCloseTo(36.667, 2);
  });

  it("hands back a copy, so a caller cannot mutate the series", () => {
    const b = new RingBuffer(2);
    b.push(1);
    const taken = b.values();
    taken[0] = 999;
    expect(b.values()[0]).not.toBe(999);
  });
});

describe("TimeWindow", () => {
  const now = () => Date.now();

  it("keeps items inside the age window and drops those outside it", () => {
    const w = new TimeWindow<{ t: number; v: string }>(1000);
    w.add({ t: now() - 5000, v: "old" });
    w.add({ t: now(), v: "fresh" });
    expect(w.all().map((i) => i.v)).toEqual(["fresh"]);
  });

  it("prunes on add, so an idle-then-busy process does not carry stale items", () => {
    const w = new TimeWindow<{ t: number; v: number }>(1000);
    for (let i = 0; i < 5; i++) w.add({ t: now() - 9999, v: i });
    // Every prior item is outside the window; adding a fresh one clears them.
    w.add({ t: now(), v: 99 });
    expect(w.all()).toHaveLength(1);
  });

  it("caps retained items even when everything is inside the window", () => {
    // The age bound alone is not enough: a burst inside one second could still
    // grow without limit, which is what maxItems is for.
    const w = new TimeWindow<{ t: number; v: number }>(60_000, 10);
    for (let i = 0; i < 200; i++) w.add({ t: now(), v: i });
    expect(w.all()).toHaveLength(10);
    expect(w.all().at(-1)?.v).toBe(199);
  });

  it("within() narrows to a shorter window than the retained one", () => {
    const w = new TimeWindow<{ t: number; v: string }>(60_000);
    w.add({ t: now() - 30_000, v: "half-minute" });
    w.add({ t: now(), v: "now" });
    expect(w.all()).toHaveLength(2);
    expect(w.within(5_000).map((i) => i.v)).toEqual(["now"]);
  });
});

describe("percentile", () => {
  it("returns 0 for an empty sample set rather than NaN", () => {
    // NaN would render as "NaN ms" on the panel; 0 is the honest empty reading.
    expect(percentile([], 95)).toBe(0);
  });

  it("reports the maximum at p100 and the minimum at p0", () => {
    const values = [5, 1, 9, 3];
    expect(percentile(values, 100)).toBe(9);
    expect(percentile(values, 0)).toBe(1);
  });

  it("orders the samples before indexing", () => {
    // The input arrives in arrival order, not sorted; a percentile that skipped
    // the sort would report whatever happened to be at that index.
    expect(percentile([100, 1, 50], 50)).toBe(50);
  });

  it("computes a p95 that sits at the top of the distribution", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
  });

  it("handles a single sample at every percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });
});
