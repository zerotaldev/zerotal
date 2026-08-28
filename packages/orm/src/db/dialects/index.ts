import { SqliteDialect } from "./SqliteDialect.ts";
import { PostgresDialect } from "./PostgresDialect.ts";
import { MysqlDialect } from "./MysqlDialect.ts";
import type { DialectName, SqlDialect } from "./types.ts";

const _dialects: Record<DialectName, SqlDialect> = {
  sqlite: new SqliteDialect(),
  postgres: new PostgresDialect(),
  mysql: new MysqlDialect(),
};

/**
 * Resolve the SQL strategy object for a dialect name.
 *
 * @example
 * getDialect(dialectFor(conn)).dateExpr('day', 'created_at')
 *
 * @internal
 */
export function getDialect(name: DialectName): SqlDialect {
  return _dialects[name];
}

export { SqliteDialect } from "./SqliteDialect.ts";
export { PostgresDialect } from "./PostgresDialect.ts";
export { MysqlDialect } from "./MysqlDialect.ts";
export type { SqlDialect, DialectName, DialectQuery, DatePart } from "./types.ts";
