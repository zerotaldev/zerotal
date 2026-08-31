import { Command } from "../Command.ts";
import { Gate } from "../../gate/Gate.ts";

/**
 * `bun zt down` — take the site down for maintenance.
 *
 * Every request is answered `503` with `Retry-After`, staff included, because
 * the usual reason a site is down is that its database is being changed
 * underneath it and letting one person in is letting them into that.
 *
 * @example
 * ```bash
 * bun zt down --retry=120
 * bun zt up
 * ```
 *
 * @category Serving
 */
export class DownCommand extends Command {
  static override commandName = "down";
  static override description = "Take the site down for maintenance (503 + Retry-After)";
  static override needsApp = false;
  static override args = [];
  static override flags = [
    {
      name: "retry",
      type: "number" as const,
      description: "Seconds to advertise in Retry-After",
      default: 60,
    },
    { name: "by", type: "string" as const, description: "Who is taking it down" },
  ];

  async run(): Promise<void> {
    const retryAfter = this.flags["retry"] as number;
    const by = this.flags["by"] as string | undefined;

    await Gate.maintenance({ retryAfter, ...(by ? { by } : {}) });

    this.info(`Site is down. Answering 503 with Retry-After: ${retryAfter}.`);
    this.dim("Health checks and static assets stay reachable. `bun zt up` to restore.");
    this.dim("Webhook paths do NOT — declare them in config/gate.ts `allow` first.");
  }
}

/**
 * `bun zt preview` — put the site behind a private preview.
 *
 * The site works normally for anyone holding the token; the public gets a
 * holding page. Unlike `down`, this is not an outage — invited people can
 * transact.
 *
 * @example
 * ```bash
 * bun zt preview                       # generates a token and prints the link
 * bun zt preview --until=2026-09-30
 * ```
 *
 * @category Serving
 */
export class PreviewCommand extends Command {
  static override commandName = "preview";
  static override description = "Put the site behind a private preview link";
  static override needsApp = false;
  static override args = [];
  static override flags = [
    {
      name: "token",
      type: "string" as const,
      description: "Token to use. Generated when omitted; pass a new one to rotate",
    },
    {
      name: "until",
      type: "string" as const,
      description: "ISO date the preview lifts, e.g. 2026-09-30",
    },
    { name: "by", type: "string" as const, description: "Who is raising it" },
    { name: "url", type: "string" as const, description: "Base URL to print the link against" },
  ];

  async run(): Promise<void> {
    // Generated rather than asked for by default. A token typed by a person is
    // the one thing standing between the public and an unlaunched site, and
    // nothing rate-limits guesses at it.
    const token =
      (this.flags["token"] as string | undefined) ?? crypto.randomUUID().replace(/-/g, "");
    const until = this.flags["until"] as string | undefined;
    const by = this.flags["by"] as string | undefined;
    const base = (this.flags["url"] as string | undefined) ?? "https://your-site";

    const rotating = Gate.status().mode === "preview";
    await Gate.preview({ token, ...(until ? { until } : {}), ...(by ? { by } : {}) });

    this.info("Site is in private preview.");
    this.newLine();
    this.line(`  ${base}/?preview=${token}`);
    this.newLine();
    this.dim("Keep that link — the token is stored as a hash and cannot be read back.");
    if (rotating) this.warn("Rotated: every previously issued preview cookie has stopped working.");
    if (until) this.dim(`Lifts itself after ${until}.`);
  }
}

/**
 * `bun zt up` — open the site to the public again.
 *
 * @category Serving
 */
export class UpCommand extends Command {
  static override commandName = "up";
  static override description = "Open the site — clears maintenance or preview";
  static override needsApp = false;
  static override args = [];
  static override flags = [];

  async run(): Promise<void> {
    const before = Gate.status();
    await Gate.open();

    if (before.mode === "open") {
      this.info("Site was already open. Nothing to do.");
      return;
    }
    this.info(`Site is open. Was in ${before.mode} since ${before.since ?? "unknown"}.`);
  }
}

/**
 * `bun zt gate:status` — what the gate is doing.
 *
 * @category Diagnostics
 */
export class GateStatusCommand extends Command {
  static override commandName = "gate:status";
  static override description = "Show whether the site is open, in maintenance, or in preview";
  static override needsApp = false;
  static override args = [];
  static override flags = [
    { name: "json", type: "boolean" as const, description: "Print as JSON", default: false },
  ];

  async run(): Promise<void> {
    const status = Gate.status();

    if (this.flags["json"] === true) {
      // `write`, not `line`: the other helpers colour, and a colour code is not
      // JSON.
      this.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (status.mode === "open") {
      this.info("Site is open.");
      return;
    }

    this.table([
      ["Mode", status.mode],
      ["Since", status.since ?? "—"],
      ["Until", status.until ?? "—"],
      ["By", status.by ?? "—"],
      ...(status.mode === "maintenance"
        ? ([["Retry-After", String(status.retryAfter ?? 60)]] as [string, string][])
        : []),
    ]);

    if (status.expired) {
      this.warn("This preview's window has passed — it is no longer gating anything.");
    }
  }
}
