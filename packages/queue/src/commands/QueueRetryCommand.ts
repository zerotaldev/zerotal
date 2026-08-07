import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { QueueManager } from "../QueueManager.ts";
import type { QueueDriver } from "../drivers/QueueDriver.ts";
import { JobRegistry } from "../JobRegistry.ts";
import type { Job } from "../Job.ts";

export class QueueRetryCommand extends Command {
  static override commandName = "queue:retry";
  static override description = "Retry a failed job by ID (or 'all' to retry everything)";
  static override needsApp = true;

  static override args = [{ name: "id", required: true, description: "Failed job ID, or 'all'" }];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const driver = this._driver(app);
    if (!driver) return;

    const idArg = this.args["id"] as string;
    const all = idArg === "all";
    const id = all ? null : Number(idArg);

    if (!all && isNaN(id!)) {
      this.error(`Invalid ID "${idArg}". Pass a numeric ID or "all".`);
      return;
    }

    const failed = await driver.listFailed();
    const targets = all ? failed : failed.filter((r) => r.id === id);

    if (targets.length === 0) {
      this.error(all ? "No failed jobs found." : `No failed job found with ID ${id}.`);
      return;
    }

    let retried = 0;
    for (const record of targets) {
      const JobClass = JobRegistry.resolve(record.className);

      let instance: Job;
      if (!JobClass) {
        this.warn(`Unknown job class "${record.className}" — skipping ID ${record.id}.`);
        continue;
      }

      const payload = JSON.parse(record.payload) as Record<string, unknown>;
      if (
        "fromPayload" in JobClass &&
        typeof (JobClass as Record<string, unknown>)["fromPayload"] === "function"
      ) {
        instance = (JobClass as { fromPayload(p: Record<string, unknown>): Job }).fromPayload(
          payload,
        );
      } else {
        instance = new (JobClass as new () => Job)();
      }

      await driver.push({
        queue: record.queue,
        className: record.className,
        payload: record.payload,
        attempts: 0,
        maxAttempts: instance.maxAttempts,
        retryDelay: instance.retryDelay,
        availableAt: Math.floor(Date.now() / 1000),
      });

      await driver.deleteFailedRecord(record.id);
      retried++;
    }

    this.info(`Retried ${retried} job(s).`);
  }

  private _driver(app: Application | undefined): QueueDriver | null {
    const manager = app?.container.tryMake("queue") as QueueManager | undefined;
    if (!manager) {
      this.error("Queue driver not registered.");
      return null;
    }
    return (manager as unknown as { _driver: QueueDriver })._driver;
  }
}
