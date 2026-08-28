import type { DatePart, DialectQuery, SqlDialect } from "./types.ts";

/**
 * PostgreSQL strategy — information_schema introspection, EXTRACT()/casts for
 * date parts, pg_advisory_lock for advisory locks.
 *
 * @internal
 */
export class PostgresDialect implements SqlDialect {
  readonly name = "postgres" as const;
  readonly supportsAdvisoryLocks = true;

  // Full transactional DDL: CREATE/ALTER/DROP roll back like any other statement.
  readonly supportsTransactionalDdl = true;

  hasTableSql(table: string): DialectQuery {
    return {
      sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?`,
      params: [table],
    };
  }

  hasColumnSql(table: string, column: string): DialectQuery {
    return {
      sql:
        `SELECT column_name FROM information_schema.columns ` +
        `WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      params: [table, column],
    };
  }

  dateExpr(part: DatePart, column: string): string {
    switch (part) {
      case "date":
        return `CAST(${column} AS date)`;
      case "time":
        return `CAST(${column} AS time)`;
      case "day":
        return `CAST(EXTRACT(DAY FROM ${column}) AS integer)`;
      case "month":
        return `CAST(EXTRACT(MONTH FROM ${column}) AS integer)`;
      case "year":
        return `CAST(EXTRACT(YEAR FROM ${column}) AS integer)`;
    }
  }

  autoIncrementColumn(column: string): string {
    // GENERATED ALWAYS AS IDENTITY is the SQL-standard form serial has been soft-deprecated
    // in favour of since PostgreSQL 10.
    return `${column} INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY`;
  }

  readonly booleanType = "BOOLEAN";

  booleanLiteral(value: boolean): string {
    return value ? "TRUE" : "FALSE";
  }

  // PostgreSQL indexes TEXT without a key length, so the portable type stands.
  stringType(): string {
    return "TEXT";
  }

  advisoryLockSql(key: number): DialectQuery {
    return { sql: `SELECT pg_advisory_lock(?)`, params: [key] };
  }

  advisoryUnlockSql(key: number): DialectQuery {
    return { sql: `SELECT pg_advisory_unlock(?)`, params: [key] };
  }
}
