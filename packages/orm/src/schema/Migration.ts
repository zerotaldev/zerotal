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
  /**
   * The name this migration is recorded under, instead of its filename.
   *
   * **Identity is a filename by default, and a filename is a thing people rename.**
   * The `migrations` table stores the name a migration ran as, and the next run
   * compares files against it — so renaming a file makes an applied migration look
   * pending, the runner tries it again, and it fails on `table already exists`. That
   * is a failed boot rather than a graceful skip.
   *
   * It is not a hypothetical. An app renumbered `001_` to `0001_` to match this
   * framework's own scaffold convention — exactly what a careful person does — and
   * would have made all nine of its production migrations look unrun. They caught it
   * before deploying and renamed the files back.
   *
   * Declaring `id` decouples the two. Set it to whatever the file is *already*
   * recorded as, and the file is then free to be named anything:
   *
   * ```ts
   * export default class AddTenantLimits extends Migration {
   *   static override id = "010_add_tenant_limits"; // what the table already holds
   *   async up() { … }
   * }
   * ```
   *
   * Deliberately not a content hash: a migration's content is edited far more often
   * than its name, and a hash would make every edit look like a new migration — the
   * same failure, more often.
   */
  static id?: string;

  /** Apply the migration's forward schema change. */
  abstract up(): Promise<void>;
  /** Reverse everything {@link Migration.up} did, for rollback. */
  abstract down(): Promise<void>;
}
