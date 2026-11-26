/**
 * What the scheduler writes to the app's log for each run.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Application } from "@zerotal/core";
import { FrameworkEvents } from "@zerotal/core";
import { TaskFailed, TaskRan } from "./events.ts";
import { installSchedulerObservability } from "./observability.ts";

type Entry = { level: string; message: string; context: Record<string, unknown> };

/** An app that has a `log` binding and nothing else the bridge looks for. */
function appWithLog(entries: Entry[]): Application {
  const sink = (level: string) => (message: string, context: Record<string, unknown>) =>
    void entries.push({ level, message, context });
  const log = { info: sink("info"), warn: sink("warn"), error: sink("error") };
  return {
    container: { tryMake: (name: string) => (name === "log" ? log : undefined) },
  } as unknown as Application;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe("scheduler log lines", () => {
  // From the 1.18.2 walk: `Scheduled task ran name=… durationMs=14.195999999999998`.
  it("report a run's duration in whole milliseconds", () => {
    const entries: Entry[] = [];
    uninstall = installSchedulerObservability(appWithLog(entries));

    FrameworkEvents.emit(new TaskRan("SendReminders", 14.195999999999998, true));
    FrameworkEvents.emit(new TaskRan("SendReminders", 3.5, false));
    FrameworkEvents.emit(new TaskFailed("SendReminders", 7.4999, "boom"));

    expect(entries.map((e) => [e.message, e.context["durationMs"]])).toEqual([
      ["Scheduled task ran", 14],
      ["Scheduled task failed", 4],
      ["Scheduled task threw", 7],
    ]);
  });
});
