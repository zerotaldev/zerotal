/**
 * A MySQL connection whose session zone is not UTC moves dates the ORM cannot correct.
 *
 * MySQL fills `NOW()` and `CURRENT_TIMESTAMP` with the session zone's wall-clock time,
 * and converts `TIMESTAMP` columns through it. Bun 1.4.1 and later open every MySQL
 * connection in UTC; Bun 1.3 and 1.4.0 leave it in the server's zone and give the ORM
 * no way to change that per connection. So on a `+02:00` server the same `NOW()` row
 * read two hours apart depending on the Bun — and the doctor is where that is said.
 *
 * No MySQL here: the connection is a stub answering the check's one query.
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

/** A connection whose session runs `offset` minutes from UTC in the zone named `zone`. */
function session(offset: unknown, zone = "SYSTEM", system = "SAST") {
  let asked = 0;
  const sql = (strings: TemplateStringsArray) => {
    asked++;
    expect(strings.join("?")).toContain("TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW())");
    return Promise.resolve([{ zt_offset: offset, zt_zone: zone, zt_system: system }]);
  };
  return { sql, asked: () => asked };
}

describe("mysqlTimeZoneCheck", () => {
  it("warns when the session zone is not UTC, naming the zone and the offset", async () => {
    const result = await mysqlTimeZoneCheck.run(appWith(session(120).sql));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("SYSTEM (SAST), +02:00 from UTC");
    expect(result.message).toContain("NOW()");
    expect(result.message).toContain("Bun 1.4.1");
    expect(result.fix).toContain("time_zone = '+00:00'");
  });

  it("reads the offset whatever type the driver returns it as", async () => {
    for (const offset of [-300, "-300", -300n]) {
      const result = await mysqlTimeZoneCheck.run(appWith(session(offset, "-05:00").sql));
      expect(result.message).toContain("-05:00, -05:00 from UTC");
    }
    const nepal = await mysqlTimeZoneCheck.run(appWith(session(345, "+05:45").sql));
    expect(nepal.message).toContain("+05:45 from UTC");
  });

  it("says nothing when the session runs in UTC", async () => {
    expect((await mysqlTimeZoneCheck.run(appWith(session(0, "+00:00").sql))).status).toBe("ok");
  });

  it("does not ask on another dialect", async () => {
    const { sql, asked } = session(120);
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
