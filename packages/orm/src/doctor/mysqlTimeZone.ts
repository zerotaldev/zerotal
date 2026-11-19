/**
 * The check for a MySQL connection whose session time zone is not UTC.
 *
 * The ORM writes every date as UTC, and reads a date back as UTC. MySQL does two
 * things with the session's zone that the ORM cannot see:
 *
 * - `NOW()` and `CURRENT_TIMESTAMP` give that zone's wall-clock time, so a column
 *   filled by them — `useCurrent()`, a `DEFAULT CURRENT_TIMESTAMP`, an `UPDATE …
 *   SET seen_at = NOW()` — reads back moved by the zone's offset.
 * - A `TIMESTAMP` column is stored as UTC by converting through the session zone, so
 *   its stored instants move by the offset the moment a connection reads them in
 *   another zone.
 *
 * Bun 1.4.1 and later put every MySQL connection in UTC when it opens. Bun 1.3 and
 * 1.4.0 leave it in the server's zone, and nothing the ORM can pass when it connects
 * changes that: the driver takes no session variables, and gives no hook that runs
 * on each pooled connection. So on those Buns the server's own zone has to be UTC.
 *
 * @module
 */
import type { Application } from "@zerotal/core";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import type { SQLInstance } from "../db/sql-types.ts";

interface ZoneRow {
  zt_offset?: unknown;
  zt_zone?: unknown;
  zt_system?: unknown;
}

/** `+02:00`, `-05:00`, `+05:45`. */
function _formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** This connection's offset from UTC in minutes, and the zone it names, or `null`. */
async function _sessionZone(sql: SQLInstance): Promise<{ offset: number; zone: string } | null> {
  try {
    const rows = (await sql`
      SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS zt_offset,
             @@session.time_zone AS zt_zone,
             @@system_time_zone AS zt_system
    `) as ZoneRow[];
    const row = rows[0];
    const offset = Number(row?.zt_offset);
    if (!row || !Number.isFinite(offset)) return null;
    const zone = String(row.zt_zone ?? "");
    return {
      offset,
      zone: zone === "SYSTEM" ? `SYSTEM (${String(row.zt_system ?? "unknown")})` : zone,
    };
  } catch {
    return null;
  }
}

/**
 * Report a MySQL connection whose session zone is not UTC.
 *
 * Silent on every other dialect, and on Bun 1.4.1 and later unless the app changed
 * the zone itself, since those connections open in UTC.
 */
export const mysqlTimeZoneCheck: DoctorCheck = {
  id: "mysql-time-zone",
  label: "MySQL time zone",
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
    if (driver !== "mysql")
      return { status: "ok", message: `${driver} has no session zone to set` };
    if (!sql) return { status: "ok", message: "no database connection to check" };

    const session = await _sessionZone(sql);
    if (!session) return { status: "ok", message: "could not read the session time zone" };
    if (session.offset === 0) return { status: "ok", message: "connections run in UTC" };

    const off = _formatOffset(session.offset);
    return {
      status: "warn",
      message:
        `This MySQL connection runs in ${session.zone}, ${off} from UTC. The ORM reads ` +
        `dates as UTC, so values MySQL fills with NOW() or CURRENT_TIMESTAMP read back ` +
        `${off} off, and TIMESTAMP columns move by ${off} once a connection reads them in ` +
        `UTC — which every connection does on Bun 1.4.1 and later. This is Bun ${Bun.version}.`,
      fix:
        "Set the server's time zone to UTC: default-time-zone = '+00:00' under [mysqld], " +
        "or SET GLOBAL time_zone = '+00:00', then restart the app so its connections " +
        "reopen. Rows already written by NOW() or into TIMESTAMP columns keep the old " +
        "offset; see the ORM's casts guide for moving them.",
    };
  },
};
