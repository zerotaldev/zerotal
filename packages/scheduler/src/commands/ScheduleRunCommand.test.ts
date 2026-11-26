import { describe, it, expect, afterEach } from "bun:test";
import { ScheduleRunCommand } from "./ScheduleRunCommand.ts";
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
}

function make(scheduler: SchedulerManager | undefined, name: string) {
  const c = new ScheduleRunCommand();
  const col = new Collector();
  (c as unknown as { _writer: Collector })._writer = col;
  c.args = { name };
  c.flags = {};
  (c as unknown as { app: unknown }).app = {
    container: { tryMake: (k: string) => (k === "scheduler" ? scheduler : undefined) },
  };
  return { c, col };
}

afterEach(() => {
  // The command reports failure through the process exit code, which is global.
  process.exitCode = 0;
});

describe("schedule:run", () => {
  it("runs the named task once, now, whatever its cron says", async () => {
    const s = new SchedulerManager();
    let runs = 0;
    // Once a year: only a manual run can fire it during this test.
    s.job("report", () => {
      runs++;
    }).yearly();
    const { c, col } = make(s, "report");

    await c.run();

    expect(runs).toBe(1);
    expect(col.out).toContain("✓ report finished");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("runs a task its guards would skip", async () => {
    const s = new SchedulerManager();
    let runs = 0;
    s.job("guarded", () => {
      runs++;
    })
      .everyMinute()
      .when(() => false)
      .environments(["nowhere"]);
    const { c } = make(s, "guarded");

    await c.run();

    expect(runs).toBe(1);
  });

  it("exits 1 with the error when the task throws", async () => {
    const s = new SchedulerManager();
    s.job("boom", () => {
      throw new Error("database is locked");
    }).daily();
    const { c, col } = make(s, "boom");

    await c.run();

    expect(col.out).toContain("✖ boom failed");
    expect(col.out).toContain("database is locked");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 and names the registered tasks when none matches", async () => {
    const s = new SchedulerManager();
    s.job("a", () => {}).daily();
    s.job("b", () => {}).daily();
    const { c, col } = make(s, "missing");

    await c.run();

    expect(col.out).toContain('No scheduled task named "missing"');
    expect(col.out).toContain("Registered: a, b");
    expect(process.exitCode).toBe(1);
  });

  it("points at make:schedule when no task is registered", async () => {
    const { c, col } = make(new SchedulerManager(), "anything");

    await c.run();

    expect(col.out).toContain("make:schedule");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 when the scheduler is not registered", async () => {
    const { c, col } = make(undefined, "x");

    await c.run();

    expect(col.out).toContain("Scheduler not registered");
    expect(process.exitCode).toBe(1);
  });
});
