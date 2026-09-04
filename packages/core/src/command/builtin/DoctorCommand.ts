/**
 * `bun zt doctor` — run every static sanity check against this app and print
 * the findings with their fixes. Exits 1 when anything is broken outright.
 *
 * With `--url`, it also reads the deployed app from the outside, through whatever proxy is
 * in front of it — the only way to see two classes of failure. The WebSocket transport,
 * which a proxy can gate or drop while leaving the app healthy from the inside and inert in
 * the browser. And security headers sent twice, because a header the app sets and the proxy
 * also sets is invisible from in here: the app's own view is the value it wrote.
 */
import { Command } from "../Command.ts";
import type { Application } from "../../application/Application.ts";
import { runDoctor } from "../../doctor/AppDoctor.ts";
import type { DoctorReportEntry } from "../../doctor/AppDoctor.ts";
import { probeTransport } from "../../doctor/TransportProbe.ts";
import { probeHeaders } from "../../doctor/HeaderProbe.ts";

export class DoctorCommand extends Command {
  static override commandName = "doctor";
  static override description = "Check this app for silent misconfigurations";
  static override needsApp = true;
  static override flags = [
    {
      name: "url",
      type: "string" as const,
      description:
        "Also read the deployed app at this public URL: handshake its WebSocket transport " +
        "as a browser would, and report security headers the response carries twice",
    },
  ];

  async run(): Promise<void> {
    const app = this.app as Application | undefined;
    if (!app) throw new Error("doctor needs a booted application.");

    const report = await runDoctor(app);
    this.section("Doctor");
    for (const entry of report) this._print(entry);

    const probeFailures = await this._probeTransport(app);
    const headerFindings = await this._probeHeaders();
    this._noteSkippedProbes();

    const warns = report.filter((e) => e.result.status === "warn").length + headerFindings.warnings;
    const fails =
      report.filter((e) => e.result.status === "fail").length +
      probeFailures +
      headerFindings.failures;
    this.newLine();
    // Throw rather than `process.exit(1)` — same exit code from the CLI (the runner
    // converts it), but composable. Exiting here killed any caller running the
    // doctor through `callInProcess` before its buffered report could be flushed,
    // so the failure arrived with no output explaining it.
    if (fails > 0) {
      throw new Error(`${fails} failing, ${warns} warning(s), ${report.length} check(s).`);
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

  /**
   * Report security headers the deployed response carries more than once.
   *
   * Only reachable from outside: the app's own view of a header is the value it
   * wrote, which is correct as far as it goes — the proxy's copy is invisible
   * from in here. Conflicting values count as failures because a control that
   * different browsers apply differently is not a control; identical duplicates
   * are a warning, because they are a conflict waiting for someone to edit one
   * side.
   */
  /**
   * Say that the outside-in probes did not run, when they did not.
   *
   * They are the two checks that can see what no in-process check can — a header the
   * proxy also sets, a WebSocket the proxy drops — and they are behind a flag, so the
   * people who most need them are the ones who do not know the flag exists. A team
   * running `doctor` after every deploy for months never saw the duplicate-header
   * check and had no way to find out it was there.
   *
   * A line, not a default. Auto-probing `app.url` would print "✓ No duplicated
   * security headers" for a site that was simply unreachable, which is a worse
   * failure than the silence: it is the same false confidence the secure-headers
   * check was fixed for.
   */
  private _noteSkippedProbes(): void {
    if (this.flags["url"]) return;
    this.newLine();
    this.dim(
      "Not checked: response headers and WebSocket transport, which are only visible " +
        "from outside.\n    Add --url https://your-site to read the deployed app through " +
        "its proxy.",
    );
  }

  private async _probeHeaders(): Promise<{ failures: number; warnings: number }> {
    const url = this.flags["url"] as string | undefined;
    if (!url) return { failures: 0, warnings: 0 };

    const findings = await probeHeaders(url);
    this.newLine();
    this.section("Response headers");

    if (findings.length === 0) {
      this.line("✓ No duplicated security headers.");
      return { failures: 0, warnings: 0 };
    }

    let failures = 0;
    let warnings = 0;
    for (const finding of findings) {
      const line = `${finding.conflicting ? "✗" : "!"} ${finding.header} — ${finding.message}`;
      if (finding.conflicting) {
        this.error(line);
        failures++;
      } else {
        this.warn(line);
        warnings++;
      }
      if (finding.fix) this.line(`    fix: ${finding.fix}`);
    }
    return { failures, warnings };
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
