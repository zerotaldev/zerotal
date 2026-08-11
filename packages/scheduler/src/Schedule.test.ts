import { describe, it, expect } from "bun:test";
import { Schedule } from "./Schedule.ts";
import { SchedulerManager, type SchedulerBuilder } from "./SchedulerManager.ts";
import { registerSchedule, staticScheduleConfigKeys } from "./conventions.ts";

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

describe("staticScheduleConfigKeys", () => {
  it("flags config declared as static fields", () => {
    class Wrong extends Schedule {
      static cron = "0 3 * * *";
      static timezone = "Africa/Johannesburg";
      handle() {}
    }
    expect(staticScheduleConfigKeys(Wrong)).toEqual(["cron", "timezone"]);
  });

  it("flags a static frequency() method, which is non-enumerable", () => {
    class Wrong extends Schedule {
      static frequency(every: SchedulerBuilder) {
        return every.everyFiveMinutes();
      }
      handle() {}
    }
    expect(staticScheduleConfigKeys(Wrong)).toEqual(["frequency"]);
  });

  it("flags a static name field but not the intrinsic Function.name", () => {
    class Right extends Schedule {
      cron = "* * * * *";
      handle() {}
    }
    class Wrong extends Schedule {
      static name = "popia:sweep";
      cron = "* * * * *";
      handle() {}
    }
    expect(staticScheduleConfigKeys(Right)).toEqual([]);
    expect(staticScheduleConfigKeys(Wrong)).toEqual(["name"]);
  });

  it("does not flag instance config", () => {
    class Right extends Schedule {
      name = "popia:sweep";
      cron = "0 3 * * *";
      timezone = "Africa/Johannesburg";
      withoutOverlapping = true;
      handle() {}
    }
    expect(staticScheduleConfigKeys(Right)).toEqual([]);
  });
});
