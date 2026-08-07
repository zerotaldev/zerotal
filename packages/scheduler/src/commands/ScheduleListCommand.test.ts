import { describe, it, expect } from "bun:test";
import { ScheduleListCommand } from "./ScheduleListCommand.ts";
import { SchedulerManager } from "../SchedulerManager.ts";

class Collector {
  out = "";
  write(s: string) {
    this.out += s;
  }
  writeLine(s: string) {
    this.out += s + "\n";
  }
  writeError(s: string) {
    this.out += s + "\n";
  }
  flush() {
    const o = this.out;
    this.out = "";
    return o;
  }
}

function make(scheduler?: SchedulerManager) {
  const c = new ScheduleListCommand();
  const col = new Collector();
  (c as unknown as { _writer: Collector })._writer = col;
  (c as unknown as { app: unknown }).app = {
    container: { tryMake: (k: string) => (k === "scheduler" ? scheduler : undefined) },
  };
  return { c, col };
}

describe("schedule:list", () => {
  it("lists tasks with description and next run", async () => {
    const s = new SchedulerManager();
    s.job("cleanup", async () => {}).dailyAt("02:30");
    const { c, col } = make(s);
    await c.run();
    expect(col.out).toContain("cleanup");
    expect(col.out).toContain("30 2 * * *");
    expect(col.out).toContain("At 02:30 AM");
    expect(col.out).toContain("Next run");
  });

  it("reports when there are no tasks", async () => {
    const { c, col } = make(new SchedulerManager());
    await c.run();
    expect(col.out).toContain("No scheduled tasks");
  });

  it("errors when the scheduler is not registered", async () => {
    const { c, col } = make(undefined);
    await c.run();
    expect(col.out).toContain("Scheduler not registered");
  });
});
