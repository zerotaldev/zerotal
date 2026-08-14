import { Command } from "@zerotal/core";
import { runSeeders } from "./_runSeeders.ts";

/**
 * Runs the application's database seeders (`bun zt db:seed`).
 *
 * Imports `database/seeders/DatabaseSeeder.ts` and invokes its `run()` method,
 * falling back to a legacy `database/seeders/index.ts` default-export function
 * when the class-based seeder is absent.
 *
 * @example
 * ```bash
 * bun zt db:seed
 * ```
 *
 * @category Seeding
 */
export class DbSeedCommand extends Command {
  static commandName = "db:seed";
  static description = "Run database seeders from database/seeders/";
  static needsApp = true;

  async run(): Promise<void> {
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
        return;
    }
  }
}
