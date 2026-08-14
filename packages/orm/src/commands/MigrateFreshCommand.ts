import { Command, type FlagDef } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";
import { runSeeders } from "./_runSeeders.ts";

/**
 * Rolls back every migration, then re-runs them from scratch (`bun zt migrate:fresh`).
 *
 * Resets the database by reversing all applied migrations and then re-applying
 * the full set, giving a clean, fully-migrated schema in one step. Pass
 * `--seed` to repopulate it afterwards, which is the usual reason for wiping it.
 *
 * @example
 * ```bash
 * bun zt migrate:fresh
 * bun zt migrate:fresh --seed
 * ```
 *
 * @category Migrations
 */
export class MigrateFreshCommand extends Command {
  static commandName = "migrate:fresh";
  static description = "Roll back every migration, then re-run them from scratch";
  static needsApp = true;

  static flags: FlagDef[] = [
    {
      name: "seed",
      type: "boolean",
      description: "Run database seeders once the schema has been rebuilt",
      default: false,
    },
  ];

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

    if (this.flags["seed"] as boolean) await this.#seed();
  }

  /**
   * Seed the freshly-migrated schema.
   *
   * A seeding failure is reported but does not fail the command: the migrations
   * above already ran and committed, and exiting non-zero here would suggest the
   * whole operation needs repeating when only the seeders do.
   */
  async #seed(): Promise<void> {
    this.section("Database Seeding");
    const outcome = await runSeeders();

    switch (outcome.status) {
      case "seeded":
        this.info("Database seeded successfully.");
        return;
      case "missing":
        this.error(`Seeder not found: ${outcome.path}`);
        this.dim("Create it with: bun zerotal.ts make:seeder DatabaseSeeder");
        return;
      case "invalid":
        this.error(outcome.message);
        return;
      case "failed":
        this.error(`Failed to run seeders: ${outcome.message}`);
        this.dim("The schema was rebuilt — re-run `bun zt db:seed` once the seeder is fixed.");
        return;
    }
  }
}
