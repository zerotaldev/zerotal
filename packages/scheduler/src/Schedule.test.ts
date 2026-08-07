import { describe, it, expect } from "bun:test";
import { Schedule } from "./Schedule.ts";
import { SchedulerManager, type SchedulerBuilder } from "./SchedulerManager.ts";
import { registerSchedule } from "./conventions.ts";

describe("Schedule base class + registerSchedule", () => {
  it("registers a cron-based schedule with the right name and expression", () => {
    class DailyReport extends Schedule {
      cron = "0 8 * * *";
      ran = false;
      handle() {
        this.ran = true;
      }
    }
    const mgr = new SchedulerManager();
    const inst = new DailyReport();
    const task = registerSchedule(mgr, inst, "DailyReport");

    expect(task).toBeDefined();
    expect(task!.name).toBe("DailyReport");
    expect(task!.schedule).toBe("0 8 * * *");
    expect(mgr.tasks.has("DailyReport")).toBe(true);
  });

  it("supports the fluent frequency() cadence", () => {
    class EveryFive extends Schedule {
      frequency(every: SchedulerBuilder) {
        return every.everyFiveMinutes();
      }
      handle() {}
    }
    const mgr = new SchedulerManager();
    const task = registerSchedule(mgr, new EveryFive(), "EveryFive");
    expect(task!.schedule).toBe("*/5 * * * *");
  });

  it("uses a custom name when provided", () => {
    class X extends Schedule {
      name = "custom-name";
      cron = "* * * * *";
      handle() {}
    }
    const mgr = new SchedulerManager();
    const task = registerSchedule(mgr, new X(), "X");
    expect(task!.name).toBe("custom-name");
    expect(mgr.tasks.has("custom-name")).toBe(true);
  });

  it("invokes handle() when the task runs", async () => {
    let ran = false;
    class R extends Schedule {
      cron = "* * * * *";
      async handle() {
        ran = true;
      }
    }
    const mgr = new SchedulerManager();
    const task = registerSchedule(mgr, new R(), "R");
    await task!.runNow();
    expect(ran).toBe(true);
  });

  it("skips a schedule that defines no cron or frequency", () => {
    class Broken extends Schedule {
      handle() {}
    }
    const mgr = new SchedulerManager();
    const task = registerSchedule(mgr, new Broken(), "Broken");
    expect(task).toBeUndefined();
    expect(mgr.tasks.size).toBe(0);
  });
});
