import { _getDbConnection } from "../db/DB.ts";
import { _getDialect } from "../model/BaseModel.ts";

// ── DB column descriptor (normalised across dialects) ─────────────────────────

/** @internal */
export interface LiveColumn {
  name: string;
  rawType: string; // original SQL type string from the DB (uppercase)
  nullable: boolean;
  primary: boolean;
}

/** @internal */
export interface LiveTable {
  name: string;
  columns: LiveColumn[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Execute a no-parameter SQL query and return typed rows. */
async function queryRaw<T>(sql: string): Promise<T[]> {
  const conn = _getDbConnection();
  const strings = [sql];
  const tpl = Object.assign(strings, { raw: strings }) as TemplateStringsArray;
  return conn<T>(tpl);
}

/** Execute a query with exactly one bound parameter and return typed rows. */
async function queryParam<T>(sql: string, value: unknown): Promise<T[]> {
  const conn = _getDbConnection();
  const parts = sql.split("?");
  const tpl = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
  return conn<T>(tpl, value);
}

// ── SchemaInspector ───────────────────────────────────────────────────────────

/**
 * Queries the live database to enumerate tables and their column definitions.
 * Used by `migrate:generate` to compute what has changed since the last migration.
 *
 * @internal
 */
export const SchemaInspector = {
  /** Return all user-defined table names in the current DB. */
  async tables(): Promise<string[]> {
    const dialect = _getDialect();

    if (dialect === "postgres") {
      const rows = await queryRaw<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      return rows.map((r) => r.table_name);
    }

    if (dialect === "mysql") {
      const rows = await queryRaw<{ table_name: string }>(
        `SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
      );
      return rows.map((r) => r.table_name);
    }

    // SQLite
    const rows = await queryRaw<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return rows.map((r) => r.name);
  },

  /**
   * Return column details for a single table, or null if the table doesn't exist.
   * Table name is sanitised before use — safe against injection even for SQLite PRAGMAs.
   */
  async columns(table: string): Promise<LiveColumn[] | null> {
    const dialect = _getDialect();
    const safeName = table.replace(/[^a-zA-Z0-9_]/g, "");

    if (dialect === "postgres") {
      const exists = await queryParam<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ?
         ) AS exists`,
        table,
      );
      if (!exists[0]?.exists) return null;

      const rows = await queryParam<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ?
         ORDER BY ordinal_position`,
        table,
      );
      const pks = await queryParam<{ column_name: string }>(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           USING (constraint_name, table_schema, table_name)
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ?`,
        table,
      );
      const pkSet = new Set(pks.map((r) => r.column_name));
      return rows.map((r) => ({
        name: r.column_name,
        rawType: r.data_type.toUpperCase(),
        nullable: r.is_nullable === "YES",
        primary: pkSet.has(r.column_name),
      }));
    }

    if (dialect === "mysql") {
      const rows = await queryParam<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_KEY: string;
      }>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        table,
      );
      if (rows.length === 0) return null;
      return rows.map((r) => ({
        name: r.COLUMN_NAME,
        rawType: r.DATA_TYPE.toUpperCase(),
        nullable: r.IS_NULLABLE === "YES",
        primary: r.COLUMN_KEY === "PRI",
      }));
    }

    // SQLite — PRAGMA table_info (table name must be inlined, not parameterised)
    const tableExists = await queryParam<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      safeName,
    );
    if (tableExists.length === 0) return null;

    const rows = await queryRaw<{ name: string; type: string; notnull: number; pk: number }>(
      `PRAGMA table_info(${safeName})`,
    );
    return rows.map((r) => ({
      name: r.name,
      rawType: (r.type ?? "TEXT").toUpperCase(),
      nullable: r.notnull === 0 && r.pk === 0,
      primary: r.pk > 0,
    }));
  },

  /** Return a fully described LiveTable, or null if the table doesn't exist. */
  async describe(table: string): Promise<LiveTable | null> {
    const columns = await SchemaInspector.columns(table);
    if (columns === null) return null;
    return { name: table, columns };
  },
};
