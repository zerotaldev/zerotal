import { describe, it, expect } from "bun:test";
import { ScheduledTask } from "./ScheduledTask.ts";

describe("ScheduledTask — admin introspection", () => {
  it("records last run timing + result on runNow()", async () => {
    const task = new ScheduledTask("greet", "* * * * *", async () => {
      /* ok */
    });
    expect(task.lastRunAt).toBeUndefined();
    expect(task.isRunning).toBe(false);

    await task.runNow();

    expect(task.lastRunAt).toBeInstanceOf(Date);
    expect(task.lastOk).toBe(true);
    expect(typeof task.lastDurationMs).toBe("number");
    expect(task.isRunning).toBe(false);
  });

  it("marks lastOk false when the task throws", async () => {
    const task = new ScheduledTask("boom", "* * * * *", async () => {
      throw new Error("fail");
    });
    await task.runNow(); // _execute swallows the error
    expect(task.lastOk).toBe(false);
    expect(task.lastRunAt).toBeInstanceOf(Date);
  });

  it("computes the next run from the cron expression", () => {
    const task = new ScheduledTask("daily", "0 9 * * *", async () => {});
    const next = task.nextRunAt(new Date("2026-06-15T00:00:00Z"));
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(new Date("2026-06-15T00:00:00Z").getTime());
  });
});
