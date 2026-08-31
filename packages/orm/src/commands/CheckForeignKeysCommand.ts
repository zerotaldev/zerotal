import { Command } from "@zerotal/core";
import { _getConnection } from "../db/DB.ts";

/** One row `PRAGMA foreign_key_check` objects to. */
interface Violation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/**
 * `bun zt db:check-foreign-keys` — list the rows enforcement would reject.
 *
 * SQLite ignores foreign keys unless the connection asks it not to, and Zerotal now
 * asks by default. That is the right default — a `cascadeOnDelete()` the database
 * will not perform is worse than no cascade at all — but it changes what an
 * *existing* database accepts: a child row whose parent is missing is perfectly legal
 * without enforcement and a constraint violation with it. So an app that has been
 * running without it may already hold rows that a write will now fail on.
 *
 * This is how you find out before your users do. It reports every offending row by
 * table and rowid, and exits non-zero when there are any, so a deploy script can gate
 * on it.
 *
 * @example
 * ```bash
 * # before taking the upgrade, or any time after
 * bun zt db:check-foreign-keys
 * ```
 *
 * @category Database
 */
export class CheckForeignKeysCommand extends Command {
  static override commandName = "db:check-foreign-keys";
  static override description = "List rows that violate a foreign key constraint";
  static override needsApp = true;

  async run(): Promise<void> {
    const sql = _getConnection();

    let violations: Violation[];
    try {
      violations = await sql<Violation>`PRAGMA foreign_key_check`;
    } catch (error) {
      // Postgres and MySQL always enforce, so they have no such pragma and nothing
      // to report. Saying that is more useful than an error about syntax.
      this.info(
        `No foreign-key check to run on this driver — only SQLite can have enforcement off. ` +
          `(${(error as Error).message})`,
      );
      return;
    }

    if (violations.length === 0) {
      this.info("No foreign-key violations. Enforcement is safe to leave on.");
      return;
    }

    this.error(`${violations.length} row(s) violate a foreign key:`);
    this.newLine();
    this.table(
      violations.map((v) => [
        `${v.table} rowid ${v.rowid ?? "?"}`,
        `references ${v.parent}, which has no matching row`,
      ]) as [string, string][],
    );
    this.newLine();
    this.line(
      "Each of these is a row whose parent is missing. With enforcement on, a write\n" +
        "touching one fails. Delete them, or repoint them at a parent that exists.\n\n" +
        "To keep deploying while you sort it out, set sqlite.foreignKeys: false in\n" +
        "config/database.ts — and take the override back off afterwards, because with\n" +
        "it in place cascadeOnDelete() does nothing.",
    );

    // Non-zero so a release script can gate on this the way it gates on tests.
    process.exitCode = 1;
  }
}
