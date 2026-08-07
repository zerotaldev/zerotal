import { DB } from "../db/DB.ts";

/**
 * Base class for database seeders. Extend it and implement {@link run} to populate
 * your database; use {@link call} to compose other seeders. Run seeders with the
 * `db:seed` command.
 *
 * @example
 * ```ts
 * // database/seeders/DatabaseSeeder.ts
 * export class DatabaseSeeder extends Seeder {
 *   async run(): Promise<void> {
 *     await this.call([UserSeeder, PostSeeder]);
 *   }
 * }
 *
 * export class UserSeeder extends Seeder {
 *   async run(): Promise<void> {
 *     await User.factory().count(10).create();
 *   }
 * }
 * ```
 */
export abstract class Seeder {
  /** Seed logic for this seeder. Implemented by subclasses. */
  abstract run(): Promise<void>;

  /**
   * Run other seeder classes in sequence inside a single DB transaction.
   * If any seeder throws, all changes are rolled back atomically.
   * Order matters — seed dependencies before dependents (users before posts).
   *
   * @param seeders - Seeder classes to instantiate and run, in order.
   * @returns Resolves once every seeder has run and the transaction commits.
   */
  async call(seeders: (new () => Seeder)[]): Promise<void> {
    const execute = async (): Promise<void> => {
      for (const SeederClass of seeders) {
        const instance = new SeederClass();
        await instance.run();
      }
    };

    await DB.transaction(execute);
  }
}
