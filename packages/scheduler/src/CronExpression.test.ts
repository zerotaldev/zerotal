import { describe, it, expect } from "bun:test";
import { CronExpression } from "./CronExpression.ts";

describe("CronExpression — builder", () => {
  it("builds a 5-field expression from method calls", () => {
    expect(new CronExpression().minute(0).hour(8).weekday(1).toString()).toBe("0 8 * * 1");
  });
  it("defaults all fields to *", () => {
    expect(new CronExpression().toString()).toBe("* * * * *");
  });
  it("round-trips an existing expression", () => {
    expect(new CronExpression("30 9 1 6 *").toString()).toBe("30 9 1 6 *");
  });
});

describe("CronExpression.isValid", () => {
  it("accepts valid expressions", () => {
    for (const e of [
      "* * * * *",
      "*/5 * * * *",
      "0 8 * * 1-5",
      "0 0 1,15 * *",
      "30 9 1 6 *",
      "0 0 * * 0",
      "* * * * * *",
    ]) {
      expect(CronExpression.isValid(e)).toBe(true);
    }
  });
  it("rejects invalid expressions", () => {
    for (const e of [
      "99 * * * *",
      "* * * *",
      "0 25 * * *",
      "abc * * * *",
      "0 0 0 * *",
      "*/0 * * * *",
      "5-2 * * * *",
    ]) {
      expect(CronExpression.isValid(e)).toBe(false);
    }
  });
});

describe("CronExpression.describe", () => {
  it("describes the documented example", () => {
    expect(CronExpression.describe("0 8 * * 1-5")).toBe("At 08:00 AM, Monday through Friday");
  });
  it("describes frequency shortcuts", () => {
    expect(CronExpression.describe("* * * * *")).toBe("Every minute");
    expect(CronExpression.describe("*/5 * * * *")).toBe("Every 5 minutes");
    expect(CronExpression.describe("0 * * * *")).toBe("Every hour");
  });
  it("describes a daily time and a single weekday", () => {
    expect(CronExpression.describe("30 13 * * *")).toBe("At 01:30 PM");
    expect(CronExpression.describe("0 9 * * 1")).toBe("At 09:00 AM, Monday");
  });
  it("returns a marker for invalid input", () => {
    expect(CronExpression.describe("99 * * * *")).toBe("Invalid cron expression");
  });
});

describe("CronExpression.nextRunAfter", () => {
  it("computes the next daily 08:00 run", () => {
    const from = new Date("2026-06-15T09:00:00");
    const next = CronExpression.nextRunAfter("0 8 * * *", from)!;
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(16);
  });
  it('computes the next matching minute strictly after "from"', () => {
    const from = new Date("2026-06-15T10:00:00");
    const next = CronExpression.nextRunAfter("*/15 * * * *", from)!;
    expect(next.getMinutes()).toBe(15);
  });
  it("returns null for an invalid expression", () => {
    expect(CronExpression.nextRunAfter("nonsense")).toBeNull();
  });
  it("matches() agrees with a hand-picked time", () => {
    const cron = new CronExpression("0 8 * * 1");
    expect(cron.matches(new Date("2026-06-15T08:00:00"))).toBe(true);
    expect(cron.matches(new Date("2026-06-16T08:00:00"))).toBe(false);
  });
});

describe("*/N steps anchor at the field minimum", () => {
  it("steps day-of-month from the 1st, not from 0", () => {
    // `0 0 */7 * *` means the 1st, 8th, 15th, 22nd, 29th. Anchoring at 0 gave the 7th.
    const cron = new CronExpression("0 0 */7 * *");
    const fires = [1, 8, 15, 22, 29].every((d) => cron.matches(new Date(2026, 0, d, 0, 0)));
    expect(fires).toBe(true);
    expect(cron.matches(new Date(2026, 0, 7, 0, 0))).toBe(false);
  });

  it("steps month from January, not from 0", () => {
    // `0 0 * */3 *` means Jan, Apr, Jul, Oct. Anchoring at 0 gave Mar, Jun, Sep, Dec —
    // two months out.
    const cron = new CronExpression("0 0 * */3 *");
    for (const month of [0, 3, 6, 9]) {
      expect(cron.matches(new Date(2026, month, 1, 0, 0))).toBe(true);
    }
    expect(cron.matches(new Date(2026, 2, 1, 0, 0))).toBe(false);
  });

  it("still steps minute and hour from 0", () => {
    const cron = new CronExpression("*/15 */6 * * *");
    expect(cron.matches(new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(cron.matches(new Date(2026, 0, 1, 6, 30))).toBe(true);
    expect(cron.matches(new Date(2026, 0, 1, 6, 20))).toBe(false);
  });
});

describe("nextRunAfter finds distant occurrences", () => {
  it("resolves a Feb-29 expression to the next leap day", () => {
    // A 370-day horizon reported this as "never runs", after ~320ms of blocking CPU.
    const next = CronExpression.nextRunAfter("0 0 29 2 *", new Date(2026, 0, 1));
    expect(next).not.toBeNull();
    expect(next!.getFullYear()).toBe(2028);
    expect(next!.getMonth()).toBe(1);
    expect(next!.getDate()).toBe(29);
  });

  it("does so quickly, by skipping days that cannot match", () => {
    const t0 = Date.now();
    CronExpression.nextRunAfter("0 0 29 2 *", new Date(2026, 0, 1));
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("still returns the very next minute for a frequent expression", () => {
    const next = CronExpression.nextRunAfter("* * * * *", new Date(2026, 0, 1, 12, 0, 30));
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(1);
  });
});
