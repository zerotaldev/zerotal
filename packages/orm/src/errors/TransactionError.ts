import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a database transaction cannot proceed — e.g. committing or rolling
 * back outside an active transaction, or nesting/savepoint misuse.
 *
 * @param message - Human-readable description of the transaction failure.
 */
export class TransactionError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_TRANSACTION_ERROR", 500);
  }
}
