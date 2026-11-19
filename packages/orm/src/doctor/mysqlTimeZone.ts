/**
 * The check for a MySQL server or connection whose time zone is not UTC.
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
 * The check asks for the offset in January and in July, not only today's: a zone
 * such as `Europe/London` is UTC all winter and an hour ahead all summer. And it
 * looks at the server's default zone as well as this connection's, since on Bun
 * 1.4.1 and later the connection is UTC whatever the server runs in, and rows other
 * connections wrote still carry the server's zone.
 *
 * @module
 */
import type { Application } from "@zerotal/core";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import type { SQLInstance } from "../db/sql-types.ts";

interface ZoneRow {
  zt_jan?: unknown;
  zt_jul?: unknown;
  zt_global_jan?: unknown;
  zt_global_jul?: unknown;
  zt_zone?: unknown;
  zt_global?: unknown;
  zt_system?: unknown;
}

/** The two instants the offsets are measured at, as MySQL text and as UTC seconds. */
const JANUARY = "2026-01-15 12:00:00";
const JULY = "2026-07-15 12:00:00";
const JANUARY_UTC = Date.UTC(2026, 0, 15, 12) / 1000;
const JULY_UTC = Date.UTC(2026, 6, 15, 12) / 1000;

/** A zone by name, and its offset from UTC in minutes in January and in July. */
interface Zone {
  name: string;
  offsets: [number, number];
}

/** `+02:00`, `-05:00`, `+05:45`. */
function _formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** `+02:00 from UTC`, or `+00:00 from UTC in January and +01:00 in July`. */
function _describeOffsets([jan, jul]: [number, number]): string {
  return jan === jul
    ? `${_formatOffset(jan)} from UTC`
    : `${_formatOffset(jan)} from UTC in January and ${_formatOffset(jul)} in July`;
}

/** A zone name as MySQL reports it, with the system zone filled in for `SYSTEM`. */
function _zoneName(zone: unknown, system: unknown): string {
  const name = String(zone ?? "");
  return name === "SYSTEM" ? `SYSTEM (${String(system ?? "unknown")})` : name;
}

/** Whole minutes from a driver value that may be a number, a string or a bigint. */
function _minutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * This connection's zone and the server's default zone, or `null` when the server
 * did not answer. The server's offsets are `null` when MySQL could not convert
 * through its zone.
 */
async function _zones(sql: SQLInstance): Promise<{ session: Zone; server: Zone | null } | null> {
  try {
    // UNIX_TIMESTAMP() reads a date-time in the session zone; CONVERT_TZ() into the
    // server's default zone, `SYSTEM` included. Both are worked out on the server,
    // so how the driver decodes a date does not come into it.
    const rows = (await sql`
      SELECT UNIX_TIMESTAMP(${JANUARY}) AS zt_jan,
             UNIX_TIMESTAMP(${JULY}) AS zt_jul,
             TIMESTAMPDIFF(MINUTE, ${JANUARY},
               CONVERT_TZ(${JANUARY}, '+00:00', @@global.time_zone)) AS zt_global_jan,
             TIMESTAMPDIFF(MINUTE, ${JULY},
               CONVERT_TZ(${JULY}, '+00:00', @@global.time_zone)) AS zt_global_jul,
             @@session.time_zone AS zt_zone,
             @@global.time_zone AS zt_global,
             @@system_time_zone AS zt_system
    `) as ZoneRow[];
    const row = rows[0];
    const jan = _minutes(row?.zt_jan);
    const jul = _minutes(row?.zt_jul);
    if (!row || jan === null || jul === null) return null;
    const session: Zone = {
      name: _zoneName(row.zt_zone, row.zt_system),
      offsets: [(JANUARY_UTC - jan) / 60, (JULY_UTC - jul) / 60],
    };
    const globalJan = _minutes(row.zt_global_jan);
    const globalJul = _minutes(row.zt_global_jul);
    const server: Zone | null =
      globalJan === null || globalJul === null
        ? null
        : { name: _zoneName(row.zt_global, row.zt_system), offsets: [globalJan, globalJul] };
    return { session, server };
  } catch {
    return null;
  }
}

const isUtc = (zone: Zone): boolean => zone.offsets[0] === 0 && zone.offsets[1] === 0;

const FIX =
  "Set the server's time zone to UTC: default-time-zone = '+00:00' under [mysqld], " +
  "or SET GLOBAL time_zone = '+00:00', then restart the app so its connections " +
  "reopen. Rows already written by NOW() or into TIMESTAMP columns keep the old " +
  "offset; see the ORM's casts guide for moving them.";

/**
 * Report a MySQL connection, or a MySQL server, whose zone is not UTC at some time
 * of year.
 *
 * Silent on every other dialect.
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

    const zones = await _zones(sql);
    if (!zones) return { status: "ok", message: "could not read the session time zone" };
    const { session, server } = zones;

    if (!isUtc(session)) {
      const off = _describeOffsets(session.offsets);
      return {
        status: "warn",
        message:
          `This MySQL connection runs in ${session.name}, ${off}. The ORM reads dates as ` +
          `UTC, so values MySQL fills with NOW() or CURRENT_TIMESTAMP read back off by ` +
          `that offset, and TIMESTAMP columns move by it once a connection reads them in ` +
          `UTC — which every connection does on Bun 1.4.1 and later. This is Bun ${Bun.version}.`,
        fix: FIX,
      };
    }
    if (server && !isUtc(server)) {
      return {
        status: "warn",
        message:
          `This connection runs in UTC, but the MySQL server's default zone is ` +
          `${server.name}, ${_describeOffsets(server.offsets)}. Bun 1.4.1 and later open ` +
          `each connection in UTC; Bun 1.3 and 1.4.0, and other clients, use the server's ` +
          `zone. DATETIME values they filled with NOW(), and dates they wrote into ` +
          `TIMESTAMP columns, read back off by that offset here, and the two kinds of ` +
          `connection disagree about every such row. This is Bun ${Bun.version}.`,
        fix: FIX,
      };
    }
    return {
      status: "ok",
      message: server
        ? "connections and the server run in UTC"
        : "connections run in UTC; the server's default zone could not be read",
    };
  },
};
