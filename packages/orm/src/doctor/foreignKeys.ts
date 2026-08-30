/**
 * The check for a migration that promises a cascade the database will not perform.
 *
 * SQLite ignores foreign keys unless the connection asks it not to, and it is the
 * only supported dialect that does. So a migration reading
 *
 * ```ts
 * table.foreignId("transaction_id").constrained("transactions").cascadeOnDelete();
 * ```
 *
 * describes behaviour that does not happen: deleting a parent leaves its children,
 * and every child has to be removed by hand, in the right order, by application code
 * that remembers to. Nothing errors. Nothing logs. The declaration reads like a
 * guarantee and is a comment.
 *
 * An app's data-erasure path swept fifteen tables and missed three, including both
 * that held uploaded files — so an account erasure left the paperwork on disk and its
 * rows in the database. That is a compliance failure produced by an API that reads
 * like a promise, which is why this warns rather than staying quiet: an API
 * describing behaviour the database will not perform is worse than either turning it
 * on or not offering it.
 *
 * @module
 */
import type { Application } from "@zerotal/core";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import type { SQLInstance } from "../db/sql-types.ts";

/** Whether this connection enforces foreign keys right now. */
async function _enforcing(sql: SQLInstance): Promise<boolean | null> {
  try {
    const rows = (await sql`PRAGMA foreign_keys`) as { foreign_keys?: number }[];
    const value = rows[0]?.foreign_keys;
    return value === undefined ? null : Number(value) === 1;
  } catch {
    return null;
  }
}

/** Tables that declare at least one foreign key, so the promise is actually being made. */
async function _tablesWithForeignKeys(sql: SQLInstance): Promise<number> {
  try {
    const rows = (await sql`
      SELECT COUNT(*) AS n
      FROM sqlite_master AS m
      WHERE m.type = 'table'
        AND m.sql LIKE '%REFERENCES%'
    `) as { n?: number }[];
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Report a schema that declares foreign keys on a connection that ignores them.
 *
 * Silent when the app declares none — plenty of schemas legitimately have no
 * constraints, and warning about an unused setting is how a doctor becomes noise.
 */
export const foreignKeysCheck: DoctorCheck = {
  id: "sqlite-foreign-keys",
  label: "Foreign keys",
  async run(app: Application): Promise<DoctorCheckResult> {
    let driver = "sqlite";
    let sql: SQLInstance | undefined;
    try {
      const config = app.container.makeSync("config") as { get<T>(k: string, d: T): T };
      driver = config.get<string>("database.driver", "sqlite");
      sql = app.container.makeSync("db") as SQLInstance;
    } catch {
      return { status: "ok", message: "no database connection to check" };
    }

    // Postgres and MySQL always enforce; there is nothing to get wrong.
    if (driver !== "sqlite") return { status: "ok", message: `${driver} enforces them` };
    if (!sql) return { status: "ok", message: "no database connection to check" };

    const enforcing = await _enforcing(sql);
    if (enforcing === null) return { status: "ok", message: "could not read the pragma" };
    if (enforcing) return { status: "ok", message: "enforced on this connection" };

    const declaring = await _tablesWithForeignKeys(sql);
    if (declaring === 0) {
      return { status: "ok", message: "not enforced, and nothing declares one" };
    }

    return {
      status: "warn",
      message:
        `${declaring} table(s) declare a foreign key, and this SQLite connection does not ` +
        `enforce them — so \`constrained()\` and \`cascadeOnDelete()\` in your migrations ` +
        `describe behaviour the database will not perform. Deleting a parent leaves its ` +
        `children, silently.`,
      fix:
        "Set database.sqlite.foreignKeys: true in config/database.ts. On an existing " +
        "database, run `PRAGMA foreign_key_check` first — enforcement turns an already-" +
        "orphaned row into a write that fails.",
    };
  },
};
