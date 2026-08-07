import { describe, it, expect } from "bun:test";
import { SchedulerManager } from "./SchedulerManager.ts";

const sched = () => new SchedulerManager();
const noop = async () => {};

describe("SchedulerBuilder — frequency helpers", () => {
  it("sub-minute helpers emit 6-field cron with seconds", () => {
    const s = sched();
    expect(s.job("a", noop).everySecond().schedule).toBe("* * * * * *");
    expect(s.job("b", noop).everyFiveSeconds().schedule).toBe("*/5 * * * * *");
    expect(s.job("c", noop).everyThirtySeconds().schedule).toBe("*/30 * * * * *");
  });
  it("minute helpers emit step cron", () => {
    const s = sched();
    expect(s.job("a", noop).everyTwoMinutes().schedule).toBe("*/2 * * * *");
    expect(s.job("b", noop).everyFiveMinutes().schedule).toBe("*/5 * * * *");
    expect(s.job("c", noop).everyFifteenMinutes().schedule).toBe("*/15 * * * *");
    expect(s.job("d", noop).everyThirtyMinutes().schedule).toBe("*/30 * * * *");
  });
  it("time-of-day helpers", () => {
    const s = sched();
    expect(s.job("a", noop).dailyAt("13:30").schedule).toBe("30 13 * * *");
    expect(s.job("b", noop).twiceDaily(1, 13).schedule).toBe("0 1,13 * * *");
    expect(s.job("c", noop).hourlyAt(17).schedule).toBe("17 * * * *");
    expect(s.job("d", noop).everyOddHour().schedule).toBe("0 1-23/2 * * *");
  });
  it("day-of-week filters", () => {
    const s = sched();
    expect(s.job("a", noop).weekdays().schedule).toBe("0 0 * * 1-5");
    expect(s.job("b", noop).weekends().schedule).toBe("0 0 * * 6,0");
    expect(s.job("c", noop).mondays().schedule).toBe("0 0 * * 1");
    expect(s.job("d", noop).days([1, 3]).schedule).toBe("0 0 * * 1,3");
  });
  it("week / month / quarter / year helpers", () => {
    const s = sched();
    expect(s.job("a", noop).twiceWeekly(1, 4).schedule).toBe("0 0 * * 1,4");
    expect(s.job("b", noop).twiceMonthly(1, 16).schedule).toBe("0 0 1,16 * *");
    expect(s.job("c", noop).quarterly().schedule).toBe("0 0 1 1,4,7,10 *");
    expect(s.job("d", noop).quarterlyOn(4, "14:00").schedule).toBe("0 14 4 1,4,7,10 *");
    expect(s.job("e", noop).yearly().schedule).toBe("0 0 1 1 *");
    expect(s.job("f", noop).yearlyOn(6, 1, "17:00").schedule).toBe("0 17 1 6 *");
  });
  it("lastDayOfMonth schedules across 28-31 with a guard", () => {
    const s = sched();
    const t = s.job("a", noop).lastDayOfMonth("15:00");
    expect(t.schedule).toBe("0 15 28-31 * *");
  });
});

describe("ScheduledTask.at() — time modifier", () => {
  it("pins HH:MM on a weekly schedule", () => {
    const s = sched();
    expect(s.job("a", noop).weekly().at("10:30").schedule).toBe("30 10 * * 0");
  });
  it("pins HH:MM on weekdays", () => {
    const s = sched();
    expect(s.job("a", noop).weekdays().at("09:00").schedule).toBe("0 9 * * 1-5");
  });
  it("rewrites minute/hour on a 6-field schedule without losing the seconds field", () => {
    const s = sched();
    expect(s.job("a", noop).everyFiveSeconds().at("08:15").schedule).toBe("*/5 15 8 * * *");
  });
});
