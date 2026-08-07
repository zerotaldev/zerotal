import { Command } from "@zerotal/core";
import type { Seeder } from "../seeding/Seeder.ts";

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
    const cwd = process.cwd();
    const seederPath = `${cwd}/database/seeders/DatabaseSeeder.ts`;

    const file = Bun.file(seederPath);
    if (!(await file.exists())) {
      // Fall back to legacy index.ts seeder format
      const legacyPath = `${cwd}/database/seeders/index.ts`;
      if (await Bun.file(legacyPath).exists()) {
        try {
          const mod = await import(legacyPath);
          const seed = mod.default as (() => Promise<void>) | undefined;
          if (!seed) {
            this.error("Seeder index must export a default async function.");
            return;
          }
          await seed();
          this.info("Database seeded.");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.error(`Failed to run seeders: ${msg}`);
        }
        return;
      }

      this.error(`Seeder not found: ${seederPath}`);
      this.dim("Create it with: bun zerotal.ts make:seeder DatabaseSeeder");
      return;
    }

    try {
      const mod = await import(seederPath);
      const SeederClass = (mod.DatabaseSeeder ?? mod.default) as (new () => Seeder) | undefined;

      if (!SeederClass) {
        this.error("DatabaseSeeder not found as a named or default export.");
        return;
      }

      this.section("Database Seeding");
      const seeder = new SeederClass();
      await seeder.run();
      this.info("Database seeded successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(`Failed to run seeders: ${msg}`);
    }
  }
}
