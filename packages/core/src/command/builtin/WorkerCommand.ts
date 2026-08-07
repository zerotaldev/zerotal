/**
 * The `worker` command, which boots the app in the worker environment to
 * process background jobs.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt worker` — boots the app in the worker environment to process
 * background jobs. Aliased as `queue:work`.
 *
 * @category Serving
 */
export class WorkerCommand extends Command {
  static commandName = "worker";
  static description = "Start the background job worker process";
  static aliases = ["queue:work"];
  static needsApp = true;

  async run(): Promise<void> {
    // Job classes self-register via the `jobs` convention concern during boot
    // (bootAsWorker → conventions import every app/jobs/*.ts) — no codegen needed.
    this.info("Starting Zerotal worker...");
    await (this.app as import("../../application/Application.ts").Application).bootAsWorker();
    // Keep the process alive — bootAsWorker() registers SIGTERM/SIGINT handlers.
    await new Promise<never>(() => {});
  }
}
