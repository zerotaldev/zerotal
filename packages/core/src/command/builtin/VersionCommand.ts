import { Command } from "../Command.ts";
import { _formatVersion, _versionInfo } from "../versionInfo.ts";

/**
 * `bun zt version` — which Zerotal, which Bun, which app.
 *
 * The first question anyone asks when filing a bug or reading a field report,
 * and until now the CLI had no answer: `zt version` was an unknown command, so
 * the version had to be dug out of `package.json` or `node_modules`, which
 * reports what is *installed* rather than what is *running* — not the same thing
 * for a process that has been up since before an upgrade.
 *
 * Registered in every environment and needs no application, so it still answers
 * when the app does not boot. `--version` and `-v` are intercepted even earlier,
 * in `startZerotal`, before config is loaded — see there for why.
 *
 * @example
 * ```bash
 * bun zt version
 * bun zt version --json    # for a script
 * ```
 *
 * @category Diagnostics
 */
export class VersionCommand extends Command {
  static commandName = "version";
  static description = "Show the Zerotal, Bun and app versions";
  static needsApp = false;
  static args = [];
  static flags = [
    {
      name: "json",
      type: "boolean" as const,
      description: "Print as JSON",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const info = _versionInfo();

    // `write`, not `line`: every other output helper on Command wraps its argument
    // in an ANSI colour, and `zt version --json | jq` chokes on an escape code.
    // The plain report goes the same way, for the same reason it is formatted
    // plainly — it gets pasted into bug reports.
    if (this.flags["json"] === true) {
      this.write(`${JSON.stringify(info, null, 2)}\n`);
      return;
    }

    this.write(`${_formatVersion(info)}\n`);
  }
}
