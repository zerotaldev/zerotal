import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { QueueManager } from "../QueueManager.ts";
import type { QueueDriver } from "../drivers/QueueDriver.ts";

export class QueueFailedCommand extends Command {
  static override commandName = "queue:failed";
  static override description = "List all failed jobs";
  static override needsApp = true;

  static override flags = [
    {
      name: "queue",
      short: "q",
      type: "string" as const,
      description: "Filter by queue name",
      default: "",
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const driver = this._driver(app);
    if (!driver) return;

    const queueName = (this.flags["queue"] as string | undefined) ?? "";
    const records = await driver.listFailed(queueName || undefined);

    if (records.length === 0) {
      this.info("No failed jobs found.");
      return;
    }

    this.section(`Failed jobs (${records.length})`);
    for (const r of records) {
      const err = r.error.length > 70 ? r.error.slice(0, 70) + "…" : r.error;
      this.table([
        ["ID", String(r.id)],
        ["Queue", r.queue],
        ["Class", r.className],
        ["Attempts", String(r.attempts)],
        ["Failed at", r.failedAt],
        ["Error", err],
      ]);
      this.newLine();
    }
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
