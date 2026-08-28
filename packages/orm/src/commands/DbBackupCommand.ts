import { Command, type FlagDef } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _rawStatement } from "../db/DB.ts";
import { takeBackup, BackupError, type BackupResult } from "./_backup.ts";

/**
 * `bun zt db:backup` — take a verified snapshot of the SQLite database.
 *
 * SQLite is the framework's default, and `migrate`, `migrate:fresh` and `db:seed`
 * all assume the file will be there. This is the command that makes that
 * assumption survivable. It uses `VACUUM INTO`, which is safe to run against a
 * database the server is still writing to, then opens what it wrote and checks it
 * before saying the word "backed up".
 *
 * It exits non-zero on every failure, so a systemd timer that wraps it leaves a
 * failed unit somebody can see. That is deliberate and it is the whole design: a
 * backup job that prints a problem and exits 0 buys the confidence without the
 * file, which is worse than having no job at all.
 *
 * @example
 * ```bash
 * bun zt db:backup
 * bun zt db:backup --dir=/var/backups/app --keep=30
 * bun zt db:backup --require-rows=bookings,invoices     # nightly
 * bun zt db:backup --rehearse --require-rows=bookings   # weekly
 * ```
 *
 * @category Database
 */
export class DbBackupCommand extends Command {
  static commandName = "db:backup";
  static description = "Take a verified snapshot of the SQLite database";
  static needsApp = true;

  /** Where snapshots go when nothing says otherwise. */
  static readonly DEFAULT_DIR = "storage/backups";

  /**
   * Snapshots kept by default.
   *
   * Two weeks: long enough that corruption introduced on a Friday is still
   * recoverable after somebody notices it on the following Monday week, short
   * enough that nobody turns retention off to reclaim a disk.
   */
  static readonly DEFAULT_KEEP = 14;

  static flags: FlagDef[] = [
    {
      name: "dir",
      type: "string",
      description: `Directory to write snapshots into (default ${DbBackupCommand.DEFAULT_DIR})`,
      default: DbBackupCommand.DEFAULT_DIR,
    },
    {
      name: "keep",
      type: "number",
      description: `Snapshots to keep, newest first; 0 keeps every one (default ${DbBackupCommand.DEFAULT_KEEP})`,
      default: DbBackupCommand.DEFAULT_KEEP,
    },
    {
      name: "require-rows",
      type: "string",
      description:
        "Comma-separated tables that must not be empty in the snapshot, e.g. bookings,invoices",
      default: "",
    },
    {
      name: "rehearse",
      type: "boolean",
      description: "Also perform the restore: copy the snapshot, open the copy, and check it",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const dir = String(this.flags["dir"] ?? DbBackupCommand.DEFAULT_DIR);
    const keep = Number(this.flags["keep"] ?? DbBackupCommand.DEFAULT_KEEP);
    const requireRows = String(this.flags["require-rows"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const rehearse = this.flags["rehearse"] === true;

    const source = this.#databaseUrl();

    this.section("Database backup");
    this.dim(`source     ${source}`);
    this.dim(`directory  ${dir}`);
    this.dim(`keep       ${keep === 0 ? "all" : keep}`);

    let result: BackupResult;
    try {
      result = await takeBackup((sql) => _rawStatement(sql), {
        source,
        dir,
        keep,
        requireRows,
        rehearse,
      });
    } catch (error) {
      // Rethrown, not printed. The runner turns a throw into a non-zero exit, and
      // a non-zero exit is the only part of this a timer can act on.
      if (error instanceof BackupError) throw error;
      throw new BackupError(`Backup failed: ${(error as Error).message}`);
    }

    this.newLine();
    this.info(`Wrote ${result.path}`);
    const rows: [string, string][] = [
      ["size", `${(result.bytes / 1024 / 1024).toFixed(2)} MB`],
      ["tables", String(result.tables.length)],
      ["integrity", "ok"],
    ];
    for (const [table, count] of Object.entries(result.rows)) {
      rows.push([`rows in ${table}`, String(count)]);
    }
    rows.push(["restore rehearsed", result.rehearsed ? "yes" : "no (pass --rehearse)"]);
    if (result.pruned.length > 0) {
      rows.push(["pruned", `${result.pruned.length} older snapshot(s)`]);
    }
    this.table(rows);

    if (requireRows.length === 0) {
      this.newLine();
      this.warn(
        "Nothing was asserted about the contents. Pass --require-rows with the tables " +
          "whose loss would end the business, so an empty snapshot fails here.",
      );
    }
  }

  /** The configured database URL, or `:memory:` when there is no config to read. */
  #databaseUrl(): string {
    try {
      const config = (
        this.app as { container: { makeSync(k: string): unknown } }
      ).container.makeSync("config") as ConfigManager;
      return config.get<string>("database.url", ":memory:");
    } catch {
      return ":memory:";
    }
  }
}
