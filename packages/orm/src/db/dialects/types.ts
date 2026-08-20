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

  /**
   * The column type a portable `table.boolean()` compiles to.
   *
   * SQLite has no boolean type and stores 0/1 in an `INTEGER`, which is why the
   * Blueprint emitted `INTEGER` for every engine. PostgreSQL has a real `boolean`
   * and refuses to compare or assign one against an integer column, so a table
   * built that way rejected its own booleans — `column "active" is of type integer
   * but expression is of type boolean` (SQLSTATE 42804) on the first insert, and
   * again on any `where("active", true)`. Nothing caught it because no test
   * executed the DDL against a server; `postgres.smoke.test.ts` now does.
   *
   * MySQL keeps `INTEGER`: its `BOOLEAN` is a synonym for `TINYINT(1)` and it
   * accepts 0/1 either way, so there is no defect there to fix and no reason to
   * churn the DDL of an engine no CI job covers.
   */
  readonly booleanType: string;

  /** A boolean as this engine spells it in a `DEFAULT` clause. */
  booleanLiteral(value: boolean): string;

  /** Whether the engine supports application-level advisory locks. */
  readonly supportsAdvisoryLocks: boolean;

  /**
   * Whether DDL participates in transactions — so a failed migration can be
   * rolled back and leave nothing behind.
   *
   * PostgreSQL and SQLite: yes. `CREATE TABLE` inside a transaction is undone by
   * `ROLLBACK` like any other statement, which is what lets the migration runner
   * promise all-or-nothing.
   *
   * MySQL and MariaDB: **no**. Every DDL statement causes an implicit commit, so
   * `BEGIN; CREATE TABLE …; ROLLBACK;` leaves the table behind — the `ROLLBACK`
   * has nothing left to undo. (MySQL 8.0's "atomic DDL" makes each *individual*
   * statement crash-safe; it does not put them in your transaction.) A runner
   * that wrapped MySQL DDL in a transaction anyway would report a rollback that
   * did not happen, which is worse than not offering one.
   */
  readonly supportsTransactionalDdl: boolean;

  /** Statement acquiring an advisory lock (blocking), or null when unsupported. */
  advisoryLockSql(key: number): DialectQuery | null;

  /** Statement releasing an advisory lock, or null when unsupported. */
  advisoryUnlockSql(key: number): DialectQuery | null;
}
