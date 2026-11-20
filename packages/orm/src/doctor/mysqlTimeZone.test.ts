/**
 * A MySQL connection or server whose zone is not UTC moves dates the ORM cannot correct.
 *
 * MySQL fills `NOW()` and `CURRENT_TIMESTAMP` with the session zone's wall-clock time,
 * and converts `TIMESTAMP` columns through it. Bun 1.4.1 and later open every MySQL
 * connection in UTC; Bun 1.3 and 1.4.0 leave it in the server's zone and give the ORM
 * no way to change that per connection. So on a `+02:00` server the same `NOW()` row
 * read two hours apart depending on the Bun — and the doctor is where that is said.
 *
 * No MySQL here: the connection is a stub answering the check's one query the way
 * MySQL 8.0 does (checked against a real server on Bun 1.3.14 and 1.4.5).
 */
import { describe, it, expect } from "bun:test";
import { mysqlTimeZoneCheck } from "./mysqlTimeZone.ts";
import { DatabaseProvider } from "../provider/DatabaseProvider.ts";

/** An app stub whose container answers only what the check reads. */
function appWith(sql: unknown, driver = "mysql") {
  return {
    container: {
      makeSync: (key: string) =>
        key === "db"
          ? sql
          : { get: <T>(k: string, d: T): T => (k === "database.driver" ? (driver as T) : d) },
    },
  } as never;
}

const JANUARY_UTC = Date.UTC(2026, 0, 15, 12) / 1000;
const JULY_UTC = Date.UTC(2026, 6, 15, 12) / 1000;

interface Zones {
  /** The session's offset from UTC in minutes, in January and in July. */
  session: [number, number];
  zone?: string;
  /** The server default zone's offsets, `null` when MySQL cannot convert into it. */
  server?: [number, number] | null;
  global?: string;
  system?: string;
  /** Wrap each number the way a driver might return it. */
  as?: (n: number) => unknown;
}

/** Every query the stub connections were sent. */
const queries: string[] = [];

/** A connection answering as MySQL would for the zones given. */
function mysql(z: Zones) {
  let asked = 0;
  const as = z.as ?? ((n: number) => n);
  const server = z.server === undefined ? z.session : z.server;
  const sql = (strings: TemplateStringsArray) => {
    asked++;
    queries.push(strings.join("?"));
    return Promise.resolve([
      {
        // Today's offset, as a check that looks only at NOW() would see it: winter.
        zt_offset: as(z.session[0]),
        // UNIX_TIMESTAMP() reads the text in the session zone: ahead of UTC is earlier.
        zt_jan: as(JANUARY_UTC - z.session[0] * 60),
        zt_jul: as(JULY_UTC - z.session[1] * 60),
        zt_global_jan: server === null ? null : as(server[0]),
        zt_global_jul: server === null ? null : as(server[1]),
        zt_zone: z.zone ?? "SYSTEM",
        zt_global: z.global ?? "SYSTEM",
        zt_system: z.system ?? "SAST",
      },
    ]);
  };
  return { sql, asked: () => asked };
}

const run = (z: Zones) => mysqlTimeZoneCheck.run(appWith(mysql(z).sql));

describe("mysqlTimeZoneCheck", () => {
  it("warns when the session zone is not UTC, naming the zone and the offset", async () => {
    const result = await run({ session: [120, 120] });
    expect(result.status).toBe("warn");
    expect(result.message).toContain("SYSTEM (SAST), +02:00 from UTC");
    expect(result.message).toContain("NOW()");
    expect(result.message).toContain("Bun 1.4.1");
    expect(result.fix).toContain("time_zone = '+00:00'");
  });

  it("reads the values whatever type the driver returns them as", async () => {
    for (const as of [(n: number) => n, (n: number) => String(n), (n: number) => BigInt(n)]) {
      const result = await run({ session: [-300, -300], zone: "-05:00", as });
      expect(result.message).toContain("-05:00, -05:00 from UTC");
    }
    const nepal = await run({ session: [345, 345], zone: "+05:45" });
    expect(nepal.message).toContain("+05:45 from UTC");
  });

  it("warns for a zone that is UTC only part of the year, whatever the season", async () => {
    // Europe/London: GMT all winter, an hour ahead all summer.
    const london = await run({ session: [0, 60], system: "GMT" });
    expect(london.status).toBe("warn");
    expect(london.message).toContain("SYSTEM (GMT), +00:00 from UTC in January and +01:00 in July");
    const named = await run({ session: [0, 60], zone: "Europe/London" });
    expect(named.status).toBe("warn");
  });

  it("warns when the connection is UTC but the server's default zone is not", async () => {
    // Bun 1.4.1 and later on a +02:00 server: the session is UTC, the server is not.
    const result = await run({
      session: [0, 0],
      zone: "+00:00",
      server: [120, 120],
      global: "+02:00",
    });
    expect(result.status).toBe("warn");
    expect(result.message).toContain("server's default zone is +02:00, +02:00 from UTC");
    expect(result.message).toContain("Bun 1.3 and 1.4.0");
    expect(result.fix).toContain("time_zone = '+00:00'");
    const london = await run({ session: [0, 0], zone: "+00:00", server: [0, 60] });
    expect(london.status).toBe("warn");
  });

  it("says nothing when the session and the server run in UTC", async () => {
    const result = await run({ session: [0, 0], zone: "+00:00", global: "+00:00" });
    expect(result).toEqual({ status: "ok", message: "connections and the server run in UTC" });
    const unknownServer = await run({ session: [0, 0], zone: "+00:00", server: null });
    expect(unknownServer.status).toBe("ok");
  });

  it("measures both seasons and the server's zone on the server", async () => {
    queries.length = 0;
    await run({ session: [0, 0] });
    expect(queries[0]).toContain("UNIX_TIMESTAMP(");
    expect(queries[0]).toContain("CONVERT_TZ(");
    expect(queries[0]).toContain("@@global.time_zone");
  });

  it("does not ask on another dialect", async () => {
    const { sql, asked } = mysql({ session: [120, 120] });
    expect((await mysqlTimeZoneCheck.run(appWith(sql, "postgres"))).status).toBe("ok");
    expect(asked()).toBe(0);
  });

  it("stays quiet when the server cannot answer", async () => {
    const failing = () => Promise.reject(new Error("gone"));
    expect((await mysqlTimeZoneCheck.run(appWith(failing))).status).toBe("ok");
  });

  it("is one of the checks the database provider gives the doctor", () => {
    const provider = Object.create(DatabaseProvider.prototype) as DatabaseProvider;
    expect(provider.doctorChecks().map((c) => c.id)).toContain("mysql-time-zone");
  });
});
