import { describe, it, expect, afterEach } from "bun:test";
import { Carbon } from "./Carbon.ts";

describe("Carbon test clock", () => {
  afterEach(() => {
    Carbon.release();
  });

  it("freezes now at an absolute instant", () => {
    Carbon.setTestNow("2025-01-01T00:00:00Z");

    expect(Carbon.now().toISOString()).toBe("2025-01-01T00:00:00Z");
    expect(Carbon.isFrozen()).toBe(true);
  });

  it("returns the same instant on repeated reads while frozen", () => {
    Carbon.freeze("2025-06-15T12:30:00Z");

    const first = Carbon.now().toISOString();
    const second = Carbon.now().toISOString();

    expect(second).toBe(first);
  });

  it("releases back to the real clock", () => {
    Carbon.setTestNow("2020-01-01T00:00:00Z");
    Carbon.release();

    expect(Carbon.isFrozen()).toBe(false);
    expect(Carbon.now().year).toBeGreaterThan(2020);
  });

  it("travelTo jumps to an absolute point", () => {
    Carbon.travelTo("2026-03-04T00:00:00Z");
    expect(Carbon.now().toISOString()).toBe("2026-03-04T00:00:00Z");
  });

  it("travel moves relative to the frozen point", () => {
    Carbon.freeze("2025-01-01T00:00:00Z");
    Carbon.travel({ days: 8 });

    expect(Carbon.now().toISOString()).toBe("2025-01-09T00:00:00Z");
  });

  it("travel accepts negative amounts", () => {
    Carbon.freeze("2025-01-10T00:00:00Z");
    Carbon.travel({ days: -3 });

    expect(Carbon.now().toISOString()).toBe("2025-01-07T00:00:00Z");
  });

  it("moves the predicates that read now", () => {
    const target = Carbon.create("2025-05-05T12:00:00Z");

    Carbon.setTestNow("2025-05-05T09:00:00Z");
    expect(target.isFuture()).toBe(true);
    expect(target.isToday()).toBe(true);

    Carbon.setTestNow("2025-05-06T09:00:00Z");
    expect(target.isPast()).toBe(true);
    expect(target.isYesterday()).toBe(true);

    Carbon.setTestNow("2025-05-04T09:00:00Z");
    expect(target.isTomorrow()).toBe(true);
  });

  it("moves Carbon.today() and its neighbours", () => {
    Carbon.setTestNow("2025-02-10T15:00:00Z");

    expect(Carbon.today("UTC").toDateString()).toBe("2025-02-10");
    expect(Carbon.tomorrow("UTC").toDateString()).toBe("2025-02-11");
    expect(Carbon.yesterday("UTC").toDateString()).toBe("2025-02-09");
  });

  it("withTestNow releases even when the body throws", async () => {
    await expect(
      Carbon.withTestNow("2025-01-01T00:00:00Z", () => {
        throw new Error("inner");
      }),
    ).rejects.toThrow("inner");

    expect(Carbon.isFrozen()).toBe(false);
  });

  it("withTestNow restores a previously frozen clock rather than releasing it", async () => {
    Carbon.setTestNow("2025-01-01T00:00:00Z");

    await Carbon.withTestNow("2030-01-01T00:00:00Z", () => {
      expect(Carbon.now().year).toBe(2030);
    });

    expect(Carbon.now().year).toBe(2025);
  });
});
