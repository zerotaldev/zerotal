import { _getDbConnection } from "../db/DB.ts";
import { _getDialect } from "../model/BaseModel.ts";
import { getDialect } from "../db/dialects/index.ts";
import { Blueprint } from "./Blueprint.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Execute a DDL statement that contains no bound parameters.
 * Constructs a TemplateStringsArray from a plain string so we can call the
 * Bun SQL tagged-template function without interpolating anything.
 */
async function ddl(sql: string): Promise<void> {
  const conn = _getDbConnection();
  const strings = [sql];
  const tpl = Object.assign(strings, { raw: strings }) as TemplateStringsArray;
  await conn(tpl);
}

/**
 * Execute a query with bound `?` parameters, returning rows.
 * We need this for parameterised introspection queries (hasTable, hasColumn).
 */
async function query<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const conn = _getDbConnection();
  const parts = sql.split("?");
  const tpl = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
  return conn<T>(tpl, ...params);
}

// ── Schema facade ─────────────────────────────────────────────────────────────

/**
 * The schema-builder facade — the entry point used inside migration `up()`/`down()`
 * methods to issue DDL against the active `Bun.sql` connection.
 *
 * Each mutating helper constructs a {@link Blueprint}, runs the caller's callback to
 * record the desired columns/indexes/constraints, compiles the blueprint to SQL,
 * and executes the statements. Introspection helpers ({@link Schema.hasTable},
 * {@link Schema.hasColumn}) are dialect-aware and use bound parameters.
 *
 * @example
 * ```ts
 * // Create
 * await Schema.create('users', (table) => {
 *   table.id();
 *   table.string('email').unique();
 *   table.timestamps();
 * });
 *
 * // Alter
 * await Schema.table('users', (table) => {
 *   table.string('name').nullable();
 * });
 *
 * // Drop
 * await Schema.drop('users');
 * ```
 */
export const Schema = {
  /**
   * Create a table: `CREATE TABLE table_name ( … )`.
   *
   * @param table - Table name.
   * @param callback - Receives a {@link Blueprint} to define columns/indexes/constraints.
   * @throws Rejects if the table already exists — use {@link Schema.createIfNotExists}
   * for idempotent runs.
   */
  async create(table: string, callback: (bp: Blueprint) => void): Promise<void> {
    const bp = new Blueprint();
    callback(bp);
    for (const sql of bp.toCreateSQL(table, _getDialect())) {
      await ddl(sql);
    }
  },

  /**
   * Idempotent create: `CREATE TABLE IF NOT EXISTS table_name ( … )` followed by
   * each index statement. Safe to run repeatedly.
   */
  async createIfNotExists(table: string, callback: (bp: Blueprint) => void): Promise<void> {
    const bp = new Blueprint();
    callback(bp);
    const [create, ...indexes] = bp.toCreateSQL(table, _getDialect());
    if (create) {
      await ddl(create.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "));
    }
    for (const idx of indexes) await ddl(idx);
  },

  /**
   * Modify an existing table: `ALTER TABLE ADD COLUMN / DROP COLUMN /
   * RENAME COLUMN` plus `CREATE INDEX IF NOT EXISTS`. The blueprint is compiled
   * for the connection's active dialect (see {@link Blueprint.toAlterSQL}).
   */
  async table(name: string, callback: (bp: Blueprint) => void): Promise<void> {
    const bp = new Blueprint();
    callback(bp);
    for (const sql of bp.toAlterSQL(name, _getDialect())) {
      await ddl(sql);
    }
  },

  /** `DROP TABLE table_name` */
  async drop(table: string): Promise<void> {
    await ddl(`DROP TABLE ${table}`);
  },

  /** `DROP TABLE IF EXISTS table_name` */
  async dropIfExists(table: string): Promise<void> {
    await ddl(`DROP TABLE IF EXISTS ${table}`);
  },

  /** `ALTER TABLE from RENAME TO to` */
  async rename(from: string, to: string): Promise<void> {
    await ddl(`ALTER TABLE ${from} RENAME TO ${to}`);
  },

  /**
   * Returns true if the table exists in the current schema.
   * Dialect-aware: sqlite_master on SQLite, information_schema on
   * PostgreSQL/MySQL.
   */
  async hasTable(table: string): Promise<boolean> {
    const { sql, params } = getDialect(_getDialect()).hasTableSql(table);
    const rows = await query(sql, params);
    return rows.length > 0;
  },

  /**
   * Returns true if `column` exists in `table`.
   * Dialect-aware: pragma_table_info() on SQLite, information_schema on
   * PostgreSQL/MySQL. All inputs are bound parameters — never inlined.
   */
  async hasColumn(table: string, column: string): Promise<boolean> {
    const { sql, params } = getDialect(_getDialect()).hasColumnSql(table, column);
    const rows = await query(sql, params);
    return rows.length > 0;
  },
};
