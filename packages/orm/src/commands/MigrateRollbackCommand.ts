import { Command } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";

/**
 * Rolls back the most recent migration batch (`bun zt migrate:rollback`).
 *
 * Reverses the migrations applied in the last batch by calling their `down()`
 * methods; reports "Nothing to roll back." when no batch remains.
 *
 * @example
 * ```bash
 * bun zt migrate:rollback
 * ```
 *
 * @category Migrations
 */
export class MigrateRollbackCommand extends Command {
  static commandName = "migrate:rollback";
  static description = "Roll back the most recent migration batch";
  static needsApp = true;

  async run(): Promise<void> {
    const records = await loadMigrations();
    const entries: MigrationEntry[] = records.map((r) => ({
      name: r.name,
      migration: r.instance,
    }));

    const runner = new MigrationRunner({ connection: _getConnection() });
    const rolledBack = await runner.rollback(entries);

    if (rolledBack.length === 0) {
      this.info("Nothing to roll back.");
      return;
    }

    this.info(`Rolled back ${rolledBack.length} migration(s).`);
    this.table(rolledBack.map((name) => [name, "rolled back"]));
  }
}
