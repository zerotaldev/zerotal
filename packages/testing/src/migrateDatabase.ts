import {
  MigrationRunner,
  currentOrmContext,
  _getModelConnection,
  _setBaseModelConnection,
  _setDbConnection,
  _getDbConnectionOverride,
  type SQLInstance,
} from "@zerotal/orm";

export interface MigrateDatabaseOptions {
  /**
   * Connection to migrate. Defaults to the active model connection, which is
   * what `createTestApp()` and `refreshDatabase({ connection })` install.
   */
  connection?: SQLInstance;
  /** Directory holding the migration files. Defaults to `database/migrations`. */
  path?: string;
  /** Tracking-table name. Defaults to `migrations`. */
  table?: string;
}

/**
 * Build a test database's schema by running the project's real migrations.
 *
 * A test schema written by hand is a second definition of the same tables, and
 * the two drift: a column added in a migration is missing in the tests until
 * something fails for a reason that has nothing to do with the change. Running
 * the migrations themselves means the schema under test is the schema that
 * ships.
 *
 * @returns The names of the migrations that ran.
 *
 * @example
 * describe('Post', () => {
 *   refreshDatabase({ connection: db, migrate: true });
 *   // …every test now sees the real schema, and rolls back after itself
 * });
 *
 * @example
 * // Standalone, outside refreshDatabase
 * beforeAll(() => migrateDatabase({ connection: db }));
 */
export async function migrateDatabase(options: MigrateDatabaseOptions = {}): Promise<string[]> {
  const { path = "database/migrations", table } = options;
  const connection = options.connection ?? _getModelConnection();

  // A migration's `up()` reaches for the ambient connection through `Schema`,
  // not through the runner, so the connection has to be installed in both slots
  // for the DDL to land on the database the test is actually using.
  // Both slots are restored to exactly what they held, override and all — a
  // helper that leaves a connection pinned behind it would silently detach the
  // next test from whatever the container resolves.
  const previousDb = _getDbConnectionOverride();
  const previousModel = currentOrmContext().overrideConnection;

  _setDbConnection(connection);
  _setBaseModelConnection(connection);
  try {
    const runner = new MigrationRunner({ connection, ...(table ? { table } : {}) });
    return await runner.runFromDirectory(path);
  } finally {
    _setDbConnection(previousDb);
    _setBaseModelConnection(previousModel);
  }
}
