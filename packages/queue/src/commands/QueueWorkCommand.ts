import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { QueueManager } from "../QueueManager.ts";

export class QueueWorkCommand extends Command {
  static commandName = "queue:work";
  static description = "Process jobs from the queue (run this as a daemon in production)";
  static needsApp = true;

  static flags = [
    {
      name: "queue",
      short: "q",
      type: "string" as const,
      description: "Queue name to process",
      default: "default",
    },
    {
      name: "once",
      type: "boolean" as const,
      description: "Process one job then exit",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const queueName = this.flags["queue"] as string;
    const once = this.flags["once"] as boolean;
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const manager = app.container.makeSync("queue") as QueueManager;

    if (once) {
      const processed = await manager.processNext(queueName);
      this.info(processed ? "Processed 1 job." : "Queue is empty.");
      return;
    }

    this.info(`Processing queue "${queueName}" — Ctrl+C to stop.`);
    while (!manager.isShuttingDown) {
      // Sleep whenever nothing was *claimable* this tick — not merely when the
      // queue is empty. size() counts not-yet-due delayed jobs and jobs reserved
      // by other workers, so keying the sleep off size() busy-spins at 100% CPU
      // whenever a delayed/reserved job exists but nothing is ready.
      const processed = await manager
        .processNext(queueName)
        .catch((err) => (console.error(err), false));
      if (!processed) {
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }
    this.info("Queue worker stopped.");
  }
}
