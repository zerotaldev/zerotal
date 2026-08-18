import type { Seeder } from "../seeding/Seeder.ts";
import { DB, _getDbConnectionOverride } from "../db/DB.ts";

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
/**
 * Run `body` inside a transaction when there is a database to have one on.
 *
 * A seeder is not obliged to touch the database — it may write fixtures to disk,
 * prime a cache, or call an API — and an app that has not bound a connection
 * should not fail to seed because of a transaction it never needed. So the
 * wrapper is conditional: with a connection, the whole seed is atomic; without,
 * `body` runs exactly as it used to.
 */
async function _inTransaction(body: () => Promise<void>): Promise<void> {
  let connected = _getDbConnectionOverride() !== null;
  if (!connected) {
    // No override — ask the container, which throws when nothing is bound.
    try {
      const { _getConnection } = await import("../db/DB.ts");
      connected = _getConnection() !== undefined;
    } catch {
      connected = false;
    }
  }
  if (!connected) return body();
  await DB.transaction(body);
}

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
      await _inTransaction(async () => {
        await seed();
      });
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

    // One transaction around the whole seed.
    //
    // `Seeder.call()` has always wrapped *composed* seeders, so a DatabaseSeeder
    // that delegates was atomic and one that does its work inline — which is
    // most of them — was not. A failure halfway left its rows committed, so the
    // obvious next move, running it again, died on a unique constraint and the
    // only way out was `migrate:fresh`. Migrations became transactional in
    // 1.7.0; this closes the asymmetry.
    //
    // Nesting is safe: `DB.transaction` opens a SAVEPOINT when one is already
    // open, so an inner `call()` still rolls back independently.
    await _inTransaction(async () => {
      await new SeederClass().run();
    });
    return { status: "seeded" };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
