// ── Dialect strategy contract ─────────────────────────────────────────────────
//
// The ORM is dialect-light, but a handful of SQL constructs genuinely differ
// across engines: schema introspection (hasTable / hasColumn), date-part
// extraction (strftime vs EXTRACT vs DAY()/MONTH()/YEAR()) and advisory locks.
// Each engine implements this interface once; QueryBuilder, Schema and DB
// consult the active dialect instead of hard-coding SQLite syntax behind the
// multi-dialect facade.

/** Supported database engines. Mirrors `Dialect` in QueryBuilder.ts. */
export type DialectName = "sqlite" | "postgres" | "mysql";

/** A parameterised statement: `sql` uses `?` placeholders bound from `params`. */
export interface DialectQuery {
  sql: string;
  params: unknown[];
}

/** The date component extracted by whereDate/whereTime/whereDay/whereMonth/whereYear. */
export type DatePart = "date" | "time" | "day" | "month" | "year";

/**
 * Per-engine SQL strategy.
 *
 * @example
 * const d = getDialect("postgres");
 * const { sql, params } = d.hasTableSql("users");
 */
export interface SqlDialect {
  readonly name: DialectName;

  /** Introspection query returning at least one row when `table` exists. */
  hasTableSql(table: string): DialectQuery;

  /** Introspection query returning at least one row when `column` exists on `table`. */
  hasColumnSql(table: string, column: string): DialectQuery;

  /**
   * SQL expression extracting a date part from `column`.
   * The caller must validate `column` as a safe identifier first — the
   * expression is interpolated verbatim.
   */
  dateExpr(part: DatePart, column: string): string;

  /**
   * The column definition for an auto-incrementing integer primary key.
   *
   * Every engine spells this differently and none of them accept SQLite's
   * `INTEGER PRIMARY KEY AUTOINCREMENT`: PostgreSQL wants a serial/identity type, MySQL
   * wants `AUTO_INCREMENT`. Hard-coding the SQLite form meant the *first* `migrate` against
   * PostgreSQL died on a syntax error and MySQL on error 1064 — before any of the
   * dialect-aware `hasTable`/`ALTER` handling downstream got a chance to matter.
   *
   * @param column - Already-validated column name.
   * @returns The full column fragment, type and constraints included.
   */
  autoIncrementColumn(column: string): string;

  /** Whether the engine supports application-level advisory locks. */
  readonly supportsAdvisoryLocks: boolean;

  /** Statement acquiring an advisory lock (blocking), or null when unsupported. */
  advisoryLockSql(key: number): DialectQuery | null;

  /** Statement releasing an advisory lock, or null when unsupported. */
  advisoryUnlockSql(key: number): DialectQuery | null;
}
