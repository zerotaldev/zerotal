import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import { CronExpression } from "../CronExpression.ts";
import type { SchedulerManager } from "../SchedulerManager.ts";

export class ScheduleListCommand extends Command {
  static override commandName = "schedule:list";
  static override description = "List scheduled tasks with their next run time";
  static override needsApp = true;

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const scheduler = app?.container.tryMake("scheduler") as SchedulerManager | undefined;

    if (!scheduler) {
      this.error("Scheduler not registered. Add SchedulerProvider to your providers.");
      return;
    }

    const schedulesFile = `${process.cwd()}/app/schedules.ts`;
    if (await Bun.file(schedulesFile).exists()) {
      try {
        await import(schedulesFile);
      } catch (err) {
        this.warn(`Failed to load app/schedules.ts: ${(err as Error).message}`);
      }
    }

    const tasks = [...scheduler.tasks.values()];
    if (tasks.length === 0) {
      this.info("No scheduled tasks registered.");
      return;
    }

    const now = new Date();
    this.section(`Scheduled tasks (${tasks.length})`);
    for (const task of tasks) {
      const next = CronExpression.nextRunAfter(task.schedule, now);
      this.table([
        ["Name", task.name],
        ["Expression", task.schedule],
        ["Description", CronExpression.describe(task.schedule)],
        ["Next run", next ? next.toISOString() : "—"],
      ]);
      this.newLine();
    }
  }
}
