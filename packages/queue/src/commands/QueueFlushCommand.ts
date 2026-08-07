import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { QueueManager } from "../QueueManager.ts";
import type { QueueDriver } from "../drivers/QueueDriver.ts";

export class QueueFlushCommand extends Command {
  static override commandName = "queue:flush";
  static override description = "Delete all failed jobs from the database";
  static override needsApp = true;

  static override flags = [
    {
      name: "queue",
      short: "q",
      type: "string" as const,
      description: "Only flush failed jobs from the given queue",
      default: "",
    },
    {
      name: "force",
      type: "boolean" as const,
      description: "Skip confirmation prompt",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    const driver = this._driver(app);
    if (!driver) return;

    const queueName = (this.flags["queue"] as string | undefined) ?? "";
    const force = (this.flags["force"] as boolean | undefined) ?? false;

    if (!force) {
      const target = queueName ? `queue "${queueName}"` : "all queues";
      const ok = await this.confirm(
        `This will permanently delete all failed jobs for ${target}. Proceed?`,
      );
      if (!ok) {
        this.info("Aborted.");
        return;
      }
    }

    await driver.clearFailed(queueName || undefined);

    this.info(
      queueName ? `Flushed failed jobs for queue "${queueName}".` : "Flushed all failed jobs.",
    );
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
