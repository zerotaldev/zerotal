import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a migration's `up`/`down` throws, wrapping the underlying error with
 * the failing migration's name for context.
 *
 * @param migrationName - The migration that failed.
 * @param cause - The underlying error thrown by the migration.
 */
export class MigrationError extends ZerotalError {
  constructor(migrationName: string, cause: Error) {
    super(
      `Migration '${migrationName}' failed: ${cause.message}` + _syncHint(cause),
      "E_MIGRATION_FAILED",
      500,
      { migration: migrationName },
    );
    // Preserve the original error so its stack and message survive re-throwing.
    this.cause = cause;
  }
}

/**
 * "table X already exists" on a migration that is supposed to create it almost always
 * means boot-time schema sync got there first: `database.synchronize` built the table
 * from the model before the migration ran. The two cannot both own a table, and the
 * raw driver error gives no hint that a config flag is responsible — so name it here,
 * at the only moment anyone is looking.
 */
function _syncHint(cause: Error): string {
  if (!/already exists/i.test(cause.message)) return "";
  return (
    `\n\n  This usually means database.synchronize created the table from your model ` +
    `before the migration ran.\n` +
    `  A table can have one owner: set synchronize: false in config/database.ts and let ` +
    `migrations build the schema,\n` +
    `  or delete the migration and let synchronize own it.`
  );
}
