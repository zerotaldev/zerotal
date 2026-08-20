import type { DatePart, DialectQuery, SqlDialect } from "./types.ts";

/**
 * SQLite strategy — sqlite_master / pragma_table_info introspection,
 * strftime() date parts, no advisory-lock primitive.
 */
export class SqliteDialect implements SqlDialect {
  readonly name = "sqlite" as const;
  readonly supportsAdvisoryLocks = false;

  // Transactional DDL, same as PostgreSQL — the schema lives in the same b-tree
  // as the data and is written under the same transaction.
  readonly supportsTransactionalDdl = true;

  hasTableSql(table: string): DialectQuery {
    return {
      sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      params: [table],
    };
  }

  hasColumnSql(table: string, column: string): DialectQuery {
    // pragma_table_info() is the table-valued form of PRAGMA table_info —
    // unlike the PRAGMA it accepts bound parameters, so the table name never
    // needs to be inlined into the SQL.
    return {
      sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
      params: [table, column],
    };
  }

  dateExpr(part: DatePart, column: string): string {
    switch (part) {
      case "date":
        return `date(${column})`;
      case "time":
        return `time(${column})`;
      case "day":
        return `cast(strftime('%d', ${column}) as integer)`;
      case "month":
        return `cast(strftime('%m', ${column}) as integer)`;
      case "year":
        return `cast(strftime('%Y', ${column}) as integer)`;
    }
  }

  autoIncrementColumn(column: string): string {
    return `${column} INTEGER PRIMARY KEY AUTOINCREMENT`;
  }

  // SQLite has no boolean type — 0/1 in an INTEGER is the storage class it uses.
  readonly booleanType = "INTEGER";

  booleanLiteral(value: boolean): string {
    return value ? "1" : "0";
  }

  // SQLite has one string type and no length to honour.
  stringType(): string {
    return "TEXT";
  }

  advisoryLockSql(): DialectQuery | null {
    return null;
  }

  advisoryUnlockSql(): DialectQuery | null {
    return null;
  }
}
