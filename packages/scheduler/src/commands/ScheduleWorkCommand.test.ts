import { describe, it, expect, afterEach } from "bun:test";
import { FrameworkEvents } from "@zerotal/core";
import { ScheduleWorkCommand } from "./ScheduleWorkCommand.ts";
import { SchedulerManager } from "../SchedulerManager.ts";
import { TaskFailed, TaskRan, TaskSkipped } from "../events.ts";

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

/** A scheduler that records whether it was started and stopped, without arming crons. */
class RecordingScheduler extends SchedulerManager {
  calls: string[] = [];
  override start(): void {
    this.calls.push("start");
  }
  override stop(): void {
    this.calls.push("stop");
  }
}

/**
 * The command with its wait replaced: `whileRunning` runs where the process would
 * otherwise sit until SIGTERM, and returning from it stands in for the signal.
 */
function make(scheduler: SchedulerManager | undefined, whileRunning: () => void = () => {}) {
  class TestCommand extends ScheduleWorkCommand {
    protected override async _untilStopped(): Promise<void> {
      whileRunning();
    }
  }
  const c = new TestCommand();
  const col = new Collector();
  (c as unknown as { _writer: Collector })._writer = col;
  c.args = {};
  c.flags = {};
  (c as unknown as { app: unknown }).app = {
    container: { tryMake: (k: string) => (k === "scheduler" ? scheduler : undefined) },
  };
  return { c, col };
}

afterEach(() => {
  process.exitCode = 0;
});

describe("schedule:work", () => {
  it("starts the scheduler, and stops it when signalled", async () => {
    const s = new RecordingScheduler();
    s.job("cleanup", () => {}).dailyAt("02:30");
    const { c } = make(s, () => expect(s.calls).toEqual(["start"]));

    await c.run();

    expect(s.calls).toEqual(["start", "stop"]);
  });

  it("lists each task with its next run", async () => {
    const s = new RecordingScheduler();
    s.job("cleanup", () => {}).dailyAt("02:30");
    const { c, col } = make(s);

    await c.run();

    expect(col.out).toContain("Scheduler running 1 task(s)");
    expect(col.out).toContain("cleanup  30 2 * * *  next ");
  });

  it("says how to add a schedule when there are none, and keeps running", async () => {
    const s = new RecordingScheduler();
    const { c, col } = make(s);

    await c.run();

    expect(col.out).toContain("No scheduled tasks yet");
    expect(col.out).toContain("make:schedule");
    expect(s.calls).toEqual(["start", "stop"]);
  });

  it("prints each run, failure and skip while running, and nothing after", async () => {
    const s = new RecordingScheduler();
    const { c, col } = make(s, () => {
      FrameworkEvents.emit(new TaskRan("cleanup", 12.4, true));
      FrameworkEvents.emit(new TaskFailed("billing", 3, "db locked"));
      FrameworkEvents.emit(new TaskSkipped("report", "window"));
    });

    await c.run();
    FrameworkEvents.emit(new TaskRan("after-stop", 1, true));

    expect(col.out).toContain("✓ cleanup ran in 12 ms");
    expect(col.out).toContain("✖ billing failed: db locked");
    expect(col.out).toContain("- report skipped (window)");
    expect(col.out).not.toContain("after-stop");
  });

  it("exits 1 when the scheduler is not registered", async () => {
    const { c, col } = make(undefined);

    await c.run();

    expect(col.out).toContain("Scheduler not registered");
    expect(process.exitCode).toBe(1);
  });
});
