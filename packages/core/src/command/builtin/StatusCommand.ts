import { Command } from "../Command.ts";

/**
 * `bun zt status` — shows live metrics from the running server.
 *
 * Fetches GET /__zerotal/health from the running server and pretty-prints the
 * metrics: uptime, pending HTTP requests, open WebSockets, memory, Bun version.
 *
 * The health endpoint is auto-enabled in development. For production, set
 * `health: true` in config/app.ts.
 *
 * @category Diagnostics
 */
export class StatusCommand extends Command {
  static commandName = "status";
  static description = "Show live metrics from the running server";
  static needsApp = false;
  static args = [];
  static flags = [
    {
      name: "port",
      short: "p",
      type: "number" as const,
      description: "Port the server is listening on",
      default: 3000,
    },
    {
      name: "host",
      type: "string" as const,
      description: "Server hostname",
      default: "localhost",
    },
  ];

  async run(): Promise<void> {
    const port = this.flags["port"] as number;
    const host = this.flags["host"] as string;
    const url = `http://${host}:${port}/__zerotal/health`;

    let data: Record<string, unknown>;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.error(`Health endpoint returned ${res.status}.`);
        this.dim("Make sure app.health is enabled and the server is running.");
        process.exit(1);
      }
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      this.error(`Could not reach ${url}`);
      this.dim("Start the server with: bun zerotal.ts serve");
      process.exit(1);
    }

    const memory = data.memory as { heapUsed?: number; rss?: number } | undefined;
    const formatMegabytes = (bytes: number | undefined) =>
      bytes !== undefined ? `${Math.round(bytes / 1024 / 1024)} MB` : "—";

    this.section("Zerotal Server Status");
    this.table([
      ["Status", String(data.status ?? "?")],
      ["Bun", String(data.version ?? "?")],
      ["Uptime", `${Math.floor(Number(data.uptime ?? 0))} s`],
      ["Pending requests", String(data.pendingRequests ?? 0)],
      ["Open WebSockets", String(data.pendingWebSockets ?? 0)],
      ["Heap used", formatMegabytes(memory?.heapUsed)],
      ["RSS", formatMegabytes(memory?.rss)],
    ]);
    this.newLine();
  }
}
