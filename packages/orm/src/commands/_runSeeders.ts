import type { Seeder } from "../seeding/Seeder.ts";

/**
 * What running the app's seeders came to.
 *
 * Seeding is reported rather than thrown because two commands consume it and
 * they want different things from a failure: `db:seed` has nothing else to do
 * and simply reports, while `migrate:fresh --seed` has already rebuilt the
 * schema by the time seeding runs and must not present that work as undone.
 */
export type SeedOutcome =
  | { status: "seeded" }
  /** No seeder file exists. `path` is where one was looked for. */
  | { status: "missing"; path: string }
  /** A seeder file exists but does not export what it should. */
  | { status: "invalid"; message: string }
  /** The seeder ran and threw. */
  | { status: "failed"; message: string };

/**
 * Run the application's database seeders.
 *
 * Prefers the class-based `database/seeders/DatabaseSeeder.ts`, falling back to
 * a legacy `database/seeders/index.ts` exporting a default async function.
 *
 * @param cwd Project root to resolve `database/seeders/` against.
 *
 * @internal
 */
export async function runSeeders(cwd: string = process.cwd()): Promise<SeedOutcome> {
  const seederPath = `${cwd}/database/seeders/DatabaseSeeder.ts`;

  if (!(await Bun.file(seederPath).exists())) {
    const legacyPath = `${cwd}/database/seeders/index.ts`;
    if (!(await Bun.file(legacyPath).exists())) {
      return { status: "missing", path: seederPath };
    }

    try {
      const module = (await import(legacyPath)) as { default?: () => Promise<void> };
      const seed = module.default;
      if (!seed) {
        return { status: "invalid", message: "Seeder index must export a default async function." };
      }
      await seed();
      return { status: "seeded" };
    } catch (error) {
      return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const module = (await import(seederPath)) as {
      DatabaseSeeder?: new () => Seeder;
      default?: new () => Seeder;
    };
    const SeederClass = module.DatabaseSeeder ?? module.default;

    if (!SeederClass) {
      return {
        status: "invalid",
        message: "DatabaseSeeder not found as a named or default export.",
      };
    }

    await new SeederClass().run();
    return { status: "seeded" };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
