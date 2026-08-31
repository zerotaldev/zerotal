/**
 * The check for a `notifications` table that is not the framework's.
 *
 * `database.table` defaults to `notifications`, which is a very ordinary name for a
 * table an app already owns. One app's was a completely different shape —
 * `household_id`, `user_id`, `title`, `body`, `action_url`, with an in-app inbox
 * reading it — and the only thing standing between the framework's channel and a
 * wrong-shaped insert into that inbox was that no notification's `channels()`
 * happened to return `"database"`.
 *
 * A convention holding back data corruption is a convention that will lose. This
 * says so at `zt doctor` time, before the first notification does.
 *
 * @module
 */
import type { Application } from "@zerotal/core";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { NotificationConfig } from "./config.ts";
import type { NotificationConfigShape } from "./types.ts";

/** Columns `DatabaseChannel` writes on every insert. */
const REQUIRED = [
  "id",
  "notifiable_type",
  "notifiable_id",
  "type",
  "data",
  "read_at",
  "created_at",
] as const;

/** The table's column names, or `null` when it does not exist / cannot be read. */
async function _columnsOf(sql: unknown, table: string): Promise<Set<string> | null> {
  const query = sql as (strings: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
  try {
    // `pragma_table_info` is the table-valued form, so the name binds as a parameter
    // rather than being concatenated into the statement.
    const rows = (await query`SELECT name FROM pragma_table_info(${table})`) as {
      name?: string;
    }[];
    if (rows.length === 0) return null;
    return new Set(rows.map((r) => String(r.name)));
  } catch {
    return null;
  }
}

/**
 * Report a configured notifications table whose shape is not the one the channel
 * writes.
 *
 * Silent when the table does not exist yet — that is the normal state before the
 * migration runs, and warning about it would fire on every fresh checkout.
 */
export const notificationsTableCheck: DoctorCheck = {
  id: "notifications-table",
  label: "Notifications table",
  async run(app: Application): Promise<DoctorCheckResult> {
    let table = "notifications";
    let sql: unknown;
    try {
      const config = app.container.makeSync("config") as { get<T>(k: string, d: T): T };
      table = config.get<NotificationConfigShape>("notifications", NotificationConfig()).database
        .table;
      sql = app.container.makeSync("db");
    } catch {
      return { status: "ok", message: "no database connection to check" };
    }
    if (!sql) return { status: "ok", message: "no database connection to check" };

    const columns = await _columnsOf(sql, table);
    if (columns === null) {
      // Not created yet, or not SQLite. Either way there is nothing to compare.
      return { status: "ok", message: `${table} not present yet` };
    }

    const missing = REQUIRED.filter((name) => !columns.has(name));
    if (missing.length === 0) return { status: "ok", message: `${table} matches` };

    return {
      status: "fail",
      message:
        `The table "${table}" exists but is missing ${missing.join(", ")} — so it is not the ` +
        `table @zerotal/notifications writes, and a notification routed to the "database" ` +
        `channel would insert the wrong shape into it.`,
      fix:
        `Point the framework elsewhere with database.table in config/notifications.ts ` +
        `(e.g. "framework_notifications"), or run the package's migration to create the ` +
        `table it expects.`,
    };
  },
};
