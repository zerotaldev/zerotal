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

/**
 * Throw if a column this blueprint drops is named by a foreign key on the table.
 *
 * SQLite has no way to drop an FK constraint through `ALTER TABLE`, so while the
 * constraint names the column the column cannot go — the engine answers
 * `unknown column "x" in foreign key definition`, and it answers *after* every
 * earlier statement in the block has run. The standard way out is SQLite's own
 * 12-step table rebuild; until that exists here, failing before the
 * first statement is the difference between a migration that did nothing and
 * one that has to be unpicked by hand.
 *
 * The message names the constraint and the way out, because "rebuild the table"
 * is not obvious from the engine's own error.
 */
async function _assertDroppableOnSqlite(table: string, bp: Blueprint): Promise<void> {
  const drops = bp._pendingDrops;
  if (drops.length === 0) return;

  // `PRAGMA foreign_key_list` takes no bind parameters, and the table name here
  // comes from the migration's own source rather than from a request.
  const fks = await query<{ id: number; from: string; table: string }>(
    `PRAGMA foreign_key_list(${table})`,
    [],
  );
  if (fks.length === 0) return;

  const blocked = drops.filter((column) =>
    fks.some((fk) => String(fk.from).toLowerCase() === column.toLowerCase()),
  );
  if (blocked.length === 0) return;

  const referenced = blocked
    .map((column) => {
      const fk = fks.find((f) => String(f.from).toLowerCase() === column.toLowerCase());
      return `'${column}' (references ${fk?.table ?? "another table"})`;
    })
    .join(", ");

  throw new Error(
    `[Zerotal ORM] SQLite cannot drop ${referenced} from '${table}' while a foreign key ` +
      `names the column — the constraint has to go first, and SQLite cannot drop one through ` +
      `ALTER TABLE.\n\n` +
      `Rebuild the table instead: create a replacement with the columns you want, copy the ` +
      `rows across, drop the original, and rename. Nothing has been applied — this migration ` +
      `stopped before its first statement, so the schema is exactly as it was.`,
  );
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
    const dialect = _getDialect();

    // Refuse before the first statement, not in the middle of the list.
    //
    // SQLite cannot drop a column a foreign key still names, and the error it
    // raises — `unknown column "x" in foreign key definition` — arrives *after*
    // every earlier statement in the same `Schema.table()` block has run. That
    // is the difference between a migration that does nothing and one that has
    // to be unpicked by hand. The check costs a single PRAGMA on the only path
    // that can hit it.
    if (dialect === "sqlite") await _assertDroppableOnSqlite(name, bp);

    for (const sql of bp.toAlterSQL(name, dialect)) {
      await ddl(sql);
    }
  },

  /**
   * Alias of {@link Schema.table}, for modifying an existing table.
   *
   * `alter` is the name most schema builders use, so it is the first thing reached for — and
   * because the blueprint callback is loosely typed, `Schema.alter(...)` was not a type
   * error, only a `TypeError` at run time. A migration that fails there has already run
   * whatever statements preceded it, leaving the schema half-changed, which is a worse
   * outcome than one that never starts.
   */
  async alter(name: string, callback: (bp: Blueprint) => void): Promise<void> {
    await Schema.table(name, callback);
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
