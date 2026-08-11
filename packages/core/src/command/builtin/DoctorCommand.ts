/**
 * `bun zt doctor` — run every static sanity check against this app and print
 * the findings with their fixes. Exits 1 when anything is broken outright.
 */
import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import { runDoctor } from "../../doctor/AppDoctor.ts";
import type { DoctorReportEntry } from "../../doctor/AppDoctor.ts";

export class DoctorCommand extends Command {
  static override commandName = "doctor";
  static override description = "Check this app for silent misconfigurations";
  static override needsApp = true;

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

    const warns = report.filter((e) => e.result.status === "warn").length;
    const fails = report.filter((e) => e.result.status === "fail").length;
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

  private _print({ check, result }: DoctorReportEntry): void {
    const mark = result.status === "ok" ? "✓" : result.status === "warn" ? "!" : "✗";
    const line = `${mark} ${check.label} — ${result.message}`;
    if (result.status === "ok") this.line(line);
    else if (result.status === "warn") this.warn(line);
    else this.error(line);
    if (result.fix) this.line(`    fix: ${result.fix}`);
  }
}
