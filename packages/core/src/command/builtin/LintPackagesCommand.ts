/**
 * The `lint:packages` command, which checks every workspace package against the
 * documented conventions and prints a conformance report.
 */
import { Command } from "../Command.ts";
import { lintPackages, countViolations, type Severity } from "../../build/PackageLinter.ts";

const SEVERITY_COLOR: Record<Severity, string> = {
  high: "\x1b[31m",
  medium: "\x1b[33m",
  low: "\x1b[2m",
};
const RESET = "\x1b[0m";

/**
 * `bun zt lint:packages` — checks every workspace package under a directory
 * against the documented framework conventions and prints a conformance report.
 *
 * @category Diagnostics
 */
export class LintPackagesCommand extends Command {
  static commandName = "lint:packages";
  static description = "Check every package against the documented conventions";
  static needsApp = false;
  static args = [{ name: "dir", required: false, default: "./packages" }];
  static flags = [
    {
      name: "quiet",
      short: "q",
      type: "boolean" as const,
      description: "Only print the summary",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const dir = (this.args["dir"] as string | undefined) || "./packages";
    const quiet = this.flags["quiet"] === true;
    const reports = await lintPackages(dir);
    if (reports.length === 0) {
      this.error(`No packages found under ${dir}`);
      throw new Error(`lint:packages: no packages found under ${dir}`);
    }
    const total = countViolations(reports);
    const clean = reports.filter((report) => report.violations.length === 0).length;
    if (!quiet) {
      this.section(`Package conformance — ${reports.length} packages`);
      for (const report of reports) {
        if (report.violations.length === 0) {
          this.info(`  ✓ ${report.package}`);
          continue;
        }
        this.write(`  \x1b[31m✗\x1b[0m ${report.package}\n`);
        for (const violation of report.violations) {
          const color = SEVERITY_COLOR[violation.severity];
          this.write(
            `      ${color}${violation.severity.padEnd(6)}${RESET} ${violation.rule.padEnd(22)} ${violation.message}\n`,
          );
        }
      }
      this.newLine();
    }
    if (total === 0) {
      this.info(`✓ All ${reports.length} packages conform.`);
      return;
    }
    this.error(
      `✖ ${total} violation${total === 1 ? "" : "s"} across ${reports.length - clean} package${reports.length - clean === 1 ? "" : "s"} (${clean} clean).`,
    );
    throw new Error(`lint:packages: ${total} violation(s)`);
  }
}
