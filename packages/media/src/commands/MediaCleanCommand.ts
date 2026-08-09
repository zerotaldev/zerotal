import { Command } from "@zerotal/core";
import type { FlagDef } from "@zerotal/core";
import { MediaLibrary } from "../facades/MediaLibrary.ts";

/**
 * Reconcile media rows against what is actually on disk.
 *
 * Reports by default; `--force` is what deletes. "Clean" reads as harmless, and
 * a command that silently removes rows the first time someone runs it to see
 * what it does is a bad trade.
 *
 * @example
 * ```bash
 * bun zt media:clean            # report only
 * bun zt media:clean --force    # delete rows whose files are gone
 * ```
 */
export class MediaCleanCommand extends Command {
  static override commandName = "media:clean";
  static override description =
    "Find media rows whose files are missing, and optionally remove them";
  static override needsApp = true;
  static override flags: FlagDef[] = [
    {
      name: "force",
      short: "f",
      type: "boolean",
      description: "Delete the orphaned rows instead of just listing them",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const force = this.flags["force"] === true;
    const report = await MediaLibrary.clean({ dryRun: !force });

    if (report.orphanedRows.length === 0 && report.danglingConversions.length === 0) {
      this.info("Every media row has its file. Nothing to do.");
      return;
    }

    if (report.orphanedRows.length > 0) {
      this.warn(
        `${report.orphanedRows.length} media row(s) point at a file that is gone: ` +
          report.orphanedRows.join(", "),
      );
    }

    if (report.danglingConversions.length > 0) {
      this.warn(
        `${report.danglingConversions.length} recorded conversion(s) are missing their file. ` +
          "Run `bun zt media:regenerate` to rebuild them.",
      );
    }

    if (force) {
      this.info(`Deleted ${report.deletedRows.length} row(s).`);
    } else {
      this.info("Nothing was deleted. Re-run with --force to remove the orphaned rows.");
    }
  }
}
