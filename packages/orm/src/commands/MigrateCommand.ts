import { Command } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";

/**
 * Runs all pending database migrations (`bun zt migrate`).
 *
 * Loads every migration under `database/migrations/`, then applies those not
 * yet run. Passing `--fresh` first drops all tables and re-runs every
 * migration from scratch.
 *
 * @example
 * ```bash
 * bun zt migrate
 * bun zt migrate --fresh
 * ```
 *
 * @category Migrations
 */
export class MigrateCommand extends Command {
  static commandName = "migrate";
  static aliases = ["db:migrate"];
  static description = "Run all pending database migrations";
  static needsApp = true;
  static flags = [
    {
      name: "fresh",
      type: "boolean" as const,
      description: "Drop all tables and re-run all migrations",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const fresh = this.flags["fresh"] as boolean;
    const records = await loadMigrations();
    const entries: MigrationEntry[] = records.map((r) => ({
      name: r.name,
      migration: r.instance,
    }));

    const runner = new MigrationRunner({ connection: _getConnection() });

    if (fresh) {
      await runner.reset(entries);
    }

    const ran = await runner.run(entries);

    if (ran.length === 0) {
      this.info("Nothing to migrate.");
      return;
    }

    this.info(`Migrated ${ran.length} migration(s).`);
    this.table(ran.map((name) => [name, "ran"]));
  }
}
