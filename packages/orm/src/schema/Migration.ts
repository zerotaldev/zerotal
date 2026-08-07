/**
 * Base class for all database migrations.
 *
 * A migration bundles a forward change ({@link Migration.up}) with the change that
 * undoes it ({@link Migration.down}). {@link MigrationRunner} loads migration files,
 * runs each pending `up()` inside its own transaction, and calls `down()` on
 * rollback. Each migration file should export a default class extending `Migration`.
 *
 * @example
 * ```ts
 * import { Migration, Schema } from '@zerotal/orm';
 *
 * export default class CreateUsersTable extends Migration {
 *   async up(): Promise<void> {
 *     await Schema.create('users', (table) => {
 *       table.increments('id');
 *       table.string('name');
 *       table.string('email').unique();
 *       table.timestamps();
 *     });
 *   }
 *
 *   async down(): Promise<void> {
 *     await Schema.drop('users');
 *   }
 * }
 * ```
 */
export abstract class Migration {
  /** Apply the migration's forward schema change. */
  abstract up(): Promise<void>;
  /** Reverse everything {@link Migration.up} did, for rollback. */
  abstract down(): Promise<void>;
}
