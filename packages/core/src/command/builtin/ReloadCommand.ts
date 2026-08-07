import { join } from "node:path";
import { Command } from "../Command.ts";

/**
 * `bun zt reload` — hot-reloads routes in the running server.
 *
 * Sends SIGUSR2 to the running Zerotal server, which triggers a zero-downtime
 * route hot-swap via `Bun.serve().reload()`. In-flight requests are not
 * dropped — they finish on the old route table while new requests immediately
 * use the updated routes.
 *
 * Requires: a server started with `bun zt serve` (writes .zerotal/server.pid).
 *
 * Platform note: SIGUSR2 is a Unix/macOS signal. On Windows, use WSL or send
 * the signal via another mechanism.
 *
 * @category Serving
 */
export class ReloadCommand extends Command {
  static commandName = "reload";
  static description = "Hot-reload routes in the running server (sends SIGUSR2)";
  static needsApp = false;
  static args = [];
  static flags = [];

  async run(): Promise<void> {
    const pidFile = join(process.cwd(), ".zerotal", "server.pid");

    let rawPid: string;
    try {
      rawPid = await Bun.file(pidFile).text();
    } catch {
      this.error("No .zerotal/server.pid found. Is the server running?");
      process.exit(1);
    }

    const pid = parseInt(rawPid.trim(), 10);
    if (!pid || isNaN(pid)) {
      this.error(`PID file is invalid: "${rawPid.trim()}"`);
      process.exit(1);
    }

    try {
      process.kill(pid, "SIGUSR2");
      this.info(`↺  SIGUSR2 sent to PID ${pid} — routes are reloading.`);
    } catch (error) {
      this.error(`Failed to signal process ${pid}: ${(error as Error).message}`);
      this.dim("Is the server still running? Check with: bun zerotal.ts status");
      process.exit(1);
    }
  }
}
