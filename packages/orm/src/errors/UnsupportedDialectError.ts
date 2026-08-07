import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a feature is invoked on a database dialect that cannot support
 * it — e.g. `DB.advisoryLock()` on SQLite, which has no advisory-lock
 * primitive. Failing loudly beats silently emitting another engine's SQL.
 */
export class UnsupportedDialectError extends ZerotalError {
  constructor(feature: string, dialect: string) {
    super(
      `${feature} is not supported on the "${dialect}" dialect.`,
      "E_UNSUPPORTED_DIALECT",
      500,
      { feature, dialect },
    );
    this.name = "UnsupportedDialectError";
  }
}
