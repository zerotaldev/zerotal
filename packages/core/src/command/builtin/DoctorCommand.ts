/**
 * `bun zt doctor` — run every static sanity check against this app and print
 * the findings with their fixes. Exits 1 when anything is broken outright.
 *
 * With `--url`, it also probes the deployed app's WebSocket transport from the outside,
 * through whatever proxy is in front of it. That is the only way to see the failures that
 * leave the app healthy from the inside and inert in the browser.
 */
import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import { runDoctor } from "../../doctor/AppDoctor.ts";
import type { DoctorReportEntry } from "../../doctor/AppDoctor.ts";
import { probeTransport } from "../../doctor/TransportProbe.ts";

export class DoctorCommand extends Command {
  static override commandName = "doctor";
  static override description = "Check this app for silent misconfigurations";
  static override needsApp = true;
  static override flags = [
    {
      name: "url",
      type: "string" as const,
      description:
        "Also probe the deployed app's WebSocket transport at this public URL, as a browser would",
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) {
      this.error("doctor needs a booted application.");
      process.exit(1);
      return;
    }

    const report = await runDoctor(app);
    this.section("Doctor");
    for (const entry of report) this._print(entry);

    const probeFailures = await this._probeTransport(app);

    const warns = report.filter((e) => e.result.status === "warn").length;
    const fails = report.filter((e) => e.result.status === "fail").length + probeFailures;
    this.newLine();
    if (fails > 0) {
      this.error(`${fails} failing, ${warns} warning(s), ${report.length} check(s).`);
      process.exit(1);
    } else if (warns > 0) {
      this.warn(`${warns} warning(s), ${report.length} check(s).`);
    } else {
      this.info(`All ${report.length} checks passed.`);
    }
  }

  /**
   * Probe each registered WebSocket path through the public URL. Returns the number of
   * failures, so they weigh on the exit code the same as a failing check.
   */
  private async _probeTransport(app: Application): Promise<number> {
    const url = this.flags["url"] as string | undefined;
    if (!url) return 0;

    const paths = app.webSocketPaths();
    this.newLine();
    this.section("Transport");

    if (paths.length === 0) {
      this.line("✓ No WebSocket paths registered — nothing to probe.");
      return 0;
    }
    if (paths.every((p) => p === "*")) {
      this.warn("! Only catch-all WebSocket handlers are registered; no path to probe.");
      return 0;
    }

    const results = await probeTransport(url, paths);
    let failures = 0;
    for (const result of results) {
      const line = `${result.ok ? "✓" : "✗"} ${result.url} — ${result.message}`;
      if (result.ok) this.line(line);
      else {
        this.error(line);
        failures++;
      }
      if (result.fix) this.line(`    fix: ${result.fix}`);
    }
    return failures;
  }

  private _print({ check, result }: DoctorReportEntry): void {
    const mark = result.status === "ok" ? "✓" : result.status === "warn" ? "!" : "✗";
    const line = `${mark} ${check.label} — ${result.message}`;
    if (result.status === "ok") this.line(line);
    else if (result.status === "warn") this.warn(line);
    else this.error(line);
    if (result.fix) this.line(`    fix: ${result.fix}`);
  }
}
