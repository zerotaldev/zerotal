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
    super(`Migration '${migrationName}' failed: ${cause.message}`, "E_MIGRATION_FAILED", 500, {
      migration: migrationName,
    });
    // Preserve the original error so its stack and message survive re-throwing.
    this.cause = cause;
  }
}
