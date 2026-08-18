import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
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
      description: "Queue name(s) to process, comma-separated. Defaults to config queue.queues",
      default: "",
    },
    {
      name: "once",
      type: "boolean" as const,
      description: "Process one job then exit",
      default: false,
    },
  ];

  /**
   * The queues to drain: the flag if given, else the app's own `queue.queues`.
   *
   * Defaulting to the literal string `"default"` was a silent delivery failure.
   * A job may pin its own queue — `SendNotificationJob` sets `"notifications"` —
   * and `config/queue.ts` lists exactly that queue so the in-process pool drains
   * it (`QueueProvider` reads this same key and loops over every entry). But this
   * command ignored the config and listened on `"default"` alone, so following
   * both documented steps — `Notify.queue(...)`, then `zt queue:work` — queued
   * the mail and then never sent it. Nothing errors: the job sits in a queue
   * nobody is reading, forever.
   *
   * Comma-separated, so one worker can take a subset without a second process.
   * Order is priority order, matching the provider's loop.
   */
  private targetQueues(app: Application): string[] {
    const flag = ((this.flags["queue"] as string) ?? "").trim();
    if (flag) {
      const named = flag
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean);
      if (named.length) return named;
    }
    const config = app.container.makeSync("config") as ConfigManager;
    return config.get<string[]>("queue.queues", ["default"]);
  }

  async run(): Promise<void> {
    const once = this.flags["once"] as boolean;
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("Application not available.");
      return;
    }

    const manager = app.container.makeSync("queue") as QueueManager;
    const queues = this.targetQueues(app);

    if (once) {
      // The first queue with anything claimable wins, so `--once` drains one job
      // rather than one job *per queue*.
      for (const q of queues) {
        if (await manager.processNext(q)) {
          this.info("Processed 1 job.");
          return;
        }
      }
      this.info("Queue is empty.");
      return;
    }

    this.info(`Processing queue(s) [${queues.join(", ")}] — Ctrl+C to stop.`);
    while (!manager.isShuttingDown) {
      // Sleep whenever nothing was *claimable* this tick — not merely when the
      // queue is empty. size() counts not-yet-due delayed jobs and jobs reserved
      // by other workers, so keying the sleep off size() busy-spins at 100% CPU
      // whenever a delayed/reserved job exists but nothing is ready.
      //
      // "Nothing claimable" means across every queue: sleeping after the first
      // empty one would leave a busy second queue waiting out the poll interval.
      let processed = false;
      for (const q of queues) {
        if (manager.isShuttingDown) break;
        const did = await manager.processNext(q).catch((err) => (console.error(err), false));
        processed = processed || did;
      }
      if (!processed) {
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }
    this.info("Queue worker stopped.");
  }
}
