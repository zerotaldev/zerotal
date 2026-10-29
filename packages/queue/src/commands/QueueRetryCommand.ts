import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { QueueManager } from "../QueueManager.ts";
import { _requeue } from "../QueueManager.ts";
import type { QueueDriver } from "../drivers/QueueDriver.ts";

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
      // The job's own maxAttempts and retryDelay, on the queue it failed on: the same helper
      // the admin and monitor retry buttons go through.
      if (!(await _requeue(driver, record.className, record.payload, record.queue))) {
        this.warn(`Unknown job class "${record.className}" — skipping ID ${record.id}.`);
        continue;
      }

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
