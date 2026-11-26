import type { Application } from "@zerotal/core";
import { Command, FrameworkEvents } from "@zerotal/core";
import type { SchedulerManager } from "../SchedulerManager.ts";
import { TaskFailed, TaskRan, TaskSkipped } from "../events.ts";
import { _loadSchedulesFile } from "./loadSchedulesFile.ts";

/**
 * `bun zt schedule:work` — run the scheduler in the foreground, and nothing else,
 * until stopped.
 *
 * This is what `bun zt dev` runs in its `scheduler` tab. `bun zt worker` runs
 * schedules too, but it also consumes the queue, which `zt dev` already does in
 * its `queue` tab; running both would put two consumers on one queue. Production
 * keeps using `bun zt worker`.
 *
 * Each run, failure and skip is printed as it happens, so the tab shows whether
 * a schedule fired without going to the run log.
 */
export class ScheduleWorkCommand extends Command {
  static override commandName = "schedule:work";
  static override description = "Run the scheduler in the foreground until stopped";
  static override needsApp = true;

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const scheduler = app?.container.tryMake("scheduler") as SchedulerManager | undefined;

    if (!scheduler) {
      this.error("Scheduler not registered. Add SchedulerProvider to your providers.");
      process.exitCode = 1;
      return;
    }

    await _loadSchedulesFile(this);

    const tasks = [...scheduler.tasks.values()];
    if (tasks.length === 0) {
      this.dim(
        "No scheduled tasks yet. Add one with `bun zt make:schedule <Name>`; " +
          "under `bun zt dev` this restarts on the next save.",
      );
    } else {
      this.line(`Scheduler running ${tasks.length} task(s):`);
      const now = new Date();
      for (const task of tasks) {
        const next = task.nextRunAt(now);
        this.dim(`  ${task.name}  ${task.schedule}  next ${next ? next.toISOString() : "never"}`);
      }
    }

    const unsubscribe = [
      FrameworkEvents.on(TaskRan, (event) => {
        this.info(`✓ ${event.name} ran in ${Math.round(event.durationMs)} ms`);
      }),
      FrameworkEvents.on(TaskFailed, (event) => {
        this.error(`✖ ${event.name} failed: ${event.error}`);
      }),
      FrameworkEvents.on(TaskSkipped, (event) => {
        this.dim(`- ${event.name} skipped (${event.reason})`);
      }),
    ];

    scheduler.start();
    try {
      await this._untilStopped();
    } finally {
      scheduler.stop();
      for (const off of unsubscribe) off();
    }
  }

  /**
   * Resolve on SIGINT or SIGTERM. The dev supervisor stops this process with
   * SIGTERM; a developer running it by hand presses Ctrl+C. Returning lets the
   * command runner exit with code 0 once the scheduler has stopped.
   *
   * @internal
   */
  protected _untilStopped(): Promise<void> {
    return new Promise<void>((resolve) => {
      const stop = (): void => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        resolve();
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  }
}
