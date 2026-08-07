import { Command } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";

/**
 * Rolls back every migration, then re-runs them from scratch (`bun zt migrate:fresh`).
 *
 * Resets the database by reversing all applied migrations and then re-applying
 * the full set, giving a clean, fully-migrated schema in one step.
 *
 * @example
 * ```bash
 * bun zt migrate:fresh
 * ```
 *
 * @category Migrations
 */
export class MigrateFreshCommand extends Command {
  static commandName = "migrate:fresh";
  static description = "Roll back every migration, then re-run them from scratch";
  static needsApp = true;

  async run(): Promise<void> {
    const records = await loadMigrations();
    const entries: MigrationEntry[] = records.map((r) => ({
      name: r.name,
      migration: r.instance,
    }));

    const runner = new MigrationRunner({ connection: _getConnection() });
    await runner.reset(entries);
    const ran = await runner.run(entries);

    this.info(`Database refreshed — ran ${ran.length} migration(s).`);
    if (ran.length > 0) {
      this.table(ran.map((name) => [name, "migrated"]));
    }
  }
}
