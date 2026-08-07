import { Command } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";

/**
 * Shows the status of each migration (`bun zt migrate:status`).
 *
 * Prints a table listing every known migration and whether it has run, along
 * with its batch number and the timestamp it was applied.
 *
 * @example
 * ```bash
 * bun zt migrate:status
 * ```
 *
 * @category Migrations
 */
export class MigrateStatusCommand extends Command {
  static commandName = "migrate:status";
  static description = "Show the status of each migration";
  static needsApp = true;

  async run(): Promise<void> {
    const records = await loadMigrations();
    const entries: MigrationEntry[] = records.map((r) => ({
      name: r.name,
      migration: r.instance,
    }));

    const runner = new MigrationRunner({ connection: _getConnection() });
    const statuses = await runner.status(entries);

    const rows: [string, string][] = [
      ["name", "ran | batch | ranAt"],
      ...statuses.map((status): [string, string] => {
        if (!status.ran) {
          return [status.name, "no | - | -"];
        }
        const batch = status.batch ?? "-";
        const ranAt = status.ranAt ? status.ranAt.toISOString() : "-";
        return [status.name, `yes | ${batch} | ${ranAt}`];
      }),
    ];

    this.table(rows);
  }
}
