import { Command, type FlagDef } from "@zerotal/core";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";
import { loadMigrations } from "./_loadMigrations.ts";
import { runSeeders } from "./_runSeeders.ts";

/**
 * Runs all pending database migrations (`bun zt migrate`).
 *
 * Loads every migration under `database/migrations/`, then applies those not
 * yet run. Passing `--fresh` first drops all tables and re-runs every
 * migration from scratch; `--seed` runs the seeders afterwards.
 *
 * @example
 * ```bash
 * bun zt migrate
 * bun zt migrate --fresh
 * bun zt migrate --fresh --seed
 * ```
 *
 * @category Migrations
 */
export class MigrateCommand extends Command {
  static commandName = "migrate";
  static aliases = ["db:migrate"];
  static description = "Run all pending database migrations";
  static needsApp = true;
  static flags: FlagDef[] = [
    {
      name: "fresh",
      type: "boolean",
      description: "Drop all tables and re-run all migrations",
      default: false,
    },
    {
      name: "seed",
      type: "boolean",
      description: "Run database seeders once migrations have run",
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
    } else {
      this.info(`Migrated ${ran.length} migration(s).`);
      this.table(ran.map((name) => [name, "ran"]));
    }

    // Seeding runs even when nothing migrated: `migrate --seed` against an
    // already-current schema is a normal way to top up a dev database.
    if (this.flags["seed"] as boolean) await this.#seed();
  }

  /**
   * Seed after migrating.
   *
   * Reported, not thrown: the migrations above already committed, and failing
   * the command here would suggest they need repeating when only the seeders do.
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
        this.dim("Migrations already ran — re-run `bun zt db:seed` once the seeder is fixed.");
        return;
    }
  }
}
