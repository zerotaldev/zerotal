import type { Application } from "@zerotal/core";
import { Command } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { onGracefulStopRequest } from "@zerotal/core/dev";
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
    const removeStopHandlers = this._onStopRequest(
      () => {
        if (manager.isShuttingDown) return;
        // The second-press hint only for someone at a terminal; `zt dev` asks once.
        this.dim(
          process.stdin.isTTY
            ? "Stopping after the current job — Ctrl+C again to stop now."
            : "Stopping after the current job.",
        );
        void manager.drain();
      },
      () => process.exit(130),
    );
    try {
      await this._work(manager, queues);
    } finally {
      removeStopHandlers();
    }
    this.info("Queue worker stopped.");
  }

  /**
   * Take jobs until the manager is draining.
   *
   * Each job is awaited before the flag is read again, so when this returns no job this loop
   * took is still running.
   */
  private async _work(manager: QueueManager, queues: string[]): Promise<void> {
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
  }

  /**
   * Call `drain` when asked to stop, and `force` when a signal asks a second time.
   *
   * Asked by `zt dev` over IPC on every restart and on quit, by a process manager with
   * SIGTERM, by a developer with Ctrl+C. Without this the worker had no stop handler at all:
   * every one of those killed it where it stood, mid-job, and the job stayed reserved until its
   * lease ran out. A second signal is the way out of a job that will not finish.
   *
   * Only a second *signal* forces it. Ctrl+C in `zt dev` reaches the worker as a signal (the
   * terminal sends it to the whole process group) and `zt dev` then asks over IPC as well: two
   * requests for one keypress, which must not cut the running job short.
   *
   * @returns A function that removes the handlers.
   * @internal
   */
  protected _onStopRequest(drain: () => void, force: () => void): () => void {
    let draining = false;
    let signals = 0;
    const ask = (): void => {
      if (draining) return;
      draining = true;
      drain();
    };
    const onSignal = (): void => {
      signals++;
      if (signals > 1) return force();
      ask();
    };
    const offIpc = onGracefulStopRequest(ask);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return () => {
      offIpc();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
  }
}
