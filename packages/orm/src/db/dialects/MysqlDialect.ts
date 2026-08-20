import type { DatePart, DialectQuery, SqlDialect } from "./types.ts";

/**
 * MySQL strategy — INFORMATION_SCHEMA introspection, DAY()/MONTH()/YEAR()
 * date parts, GET_LOCK()/RELEASE_LOCK() named advisory locks.
 */
export class MysqlDialect implements SqlDialect {
  readonly name = "mysql" as const;
  readonly supportsAdvisoryLocks = true;

  // Every DDL statement implicitly commits, so a migration that fails part-way
  // through cannot be undone. Stated here rather than discovered in production.
  readonly supportsTransactionalDdl = false;

  hasTableSql(table: string): DialectQuery {
    return {
      sql:
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ` +
        `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      params: [table],
    };
  }

  hasColumnSql(table: string, column: string): DialectQuery {
    return {
      sql:
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS ` +
        `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      params: [table, column],
    };
  }

  dateExpr(part: DatePart, column: string): string {
    switch (part) {
      case "date":
        return `DATE(${column})`;
      case "time":
        return `TIME(${column})`;
      case "day":
        return `DAY(${column})`;
      case "month":
        return `MONTH(${column})`;
      case "year":
        return `YEAR(${column})`;
    }
  }

  // MySQL advisory locks are named — the numeric key maps to a namespaced
  // string. Timeout -1 blocks until acquired (matching pg_advisory_lock).
  autoIncrementColumn(column: string): string {
    return `${column} INT AUTO_INCREMENT PRIMARY KEY`;
  }

  // MySQL BOOLEAN is a synonym for TINYINT(1) and INTEGER accepts 0/1 all the same.
  readonly booleanType = "INTEGER";

  booleanLiteral(value: boolean): string {
    return value ? "1" : "0";
  }

  advisoryLockSql(key: number): DialectQuery {
    return { sql: `SELECT GET_LOCK(?, -1)`, params: [`zerotal_lock_${key}`] };
  }

  advisoryUnlockSql(key: number): DialectQuery {
    return { sql: `SELECT RELEASE_LOCK(?)`, params: [`zerotal_lock_${key}`] };
  }
}
