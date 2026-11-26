import type { Application } from "@zerotal/core";
import { Command, FrameworkEvents } from "@zerotal/core";
import type { ArgDef } from "@zerotal/core";
import type { SchedulerManager } from "../SchedulerManager.ts";
import { TaskFailed } from "../events.ts";
import { _loadSchedulesFile } from "./loadSchedulesFile.ts";

/**
 * `bun zt schedule:run <name>` — run one scheduled task now, once, and exit with
 * its result: 0 when it succeeded, 1 when it threw or no task has that name.
 *
 * For trying a schedule while writing it, and for re-running one by hand after a
 * failure, without waiting for its next tick. The task runs whatever its cron,
 * time window, `environments`, `when()` and `skip()` say, and the run is recorded
 * in the run log like any other (`schedule:runs`).
 */
export class ScheduleRunCommand extends Command {
  static override commandName = "schedule:run";
  static override description = "Run one scheduled task now, once, and exit with its result";
  static override needsApp = true;

  static override args: ArgDef[] = [{ name: "name", required: true }];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const scheduler = app?.container.tryMake("scheduler") as SchedulerManager | undefined;

    if (!scheduler) {
      this.error("Scheduler not registered. Add SchedulerProvider to your providers.");
      process.exitCode = 1;
      return;
    }

    await _loadSchedulesFile(this);

    const name = this.args["name"] ?? "";
    const task = scheduler.tasks.get(name);
    if (!task) {
      const names = [...scheduler.tasks.keys()];
      this.error(`No scheduled task named "${name}".`);
      this.dim(
        names.length > 0
          ? `  Registered: ${names.join(", ")}. \`bun zt schedule:list\` shows when each runs next.`
          : "  No scheduled tasks are registered. Add one with `bun zt make:schedule <Name>`.",
      );
      process.exitCode = 1;
      return;
    }

    // The task reports its own failure only through the log and this event, so
    // listen for the message rather than make the developer go and find it.
    let failure: string | undefined;
    const off = FrameworkEvents.on(TaskFailed, (event) => {
      if (event.name === task.name) failure = event.error;
    });

    this.line(`Running ${task.name}...`);
    try {
      await task.runNow();
    } finally {
      off();
    }

    const took = `${task.lastDurationMs ?? 0} ms`;
    if (task.lastOk === false) {
      this.error(`✖ ${task.name} failed after ${took}${failure ? `: ${failure}` : ""}`);
      process.exitCode = 1;
      return;
    }
    this.info(`✓ ${task.name} finished in ${took}`);
  }
}
