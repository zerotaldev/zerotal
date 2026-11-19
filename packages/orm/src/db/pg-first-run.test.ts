/**
 * What Bun 1.3 cannot read back exactly from PostgreSQL: a `timestamp without time
 * zone` on the first run of a statement with no bound values. Documented in the casts
 * guide, and pinned here so a change in the driver shows up as a failing test.
 *
 * Bun asks PostgreSQL for results in binary, which it decodes as UTC. The exception is
 * the first run, on each connection, of a statement with no bound values: Bun sends it
 * before it knows the column types, so it asks for text. Bun 1.3 parses `timestamp`
 * text as local time, so under a `TZ` that is not UTC that one read comes back moved
 * by the zone's offset. Bun 1.4 parses the text as UTC. The ORM sends the statement as
 * written either way.
 *
 * The server is a fake that speaks the wire protocol (`__fixtures__/fakePostgres.ts`),
 * so this runs the real driver everywhere; `server.smoke.test.ts` repeats it against a
 * real server in CI.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { SQL } from "bun";
import { startFakePostgres, type FakePostgres } from "../__fixtures__/fakePostgres.ts";
import { useProcessZone } from "../__fixtures__/processZone.ts";
import { DB, _setDbConnection } from "./DB.ts";
import { registerConnectionDialect } from "./QueryBuilder.ts";
import type { SQLInstance } from "./sql-types.ts";

const ISO = "2026-08-20T03:00:00.000Z";

/** Bun releases before 1.4, the ones the casts guide says read the first run as local time. */
const BEFORE_1_4 = ((): boolean => {
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  return major < 1 || (major === 1 && minor < 4);
})();

useProcessZone("America/New_York");

afterAll(() => _setDbConnection(null));

/** A fresh server and a one-connection pool, so every statement's first run is the first. */
async function withServer(run: (server: FakePostgres) => Promise<void>): Promise<void> {
  const server = startFakePostgres({ column: "at", oid: 1114, iso: ISO });
  const sql = new SQL({ url: `postgres://u:p@127.0.0.1:${server.port}/db`, tls: false, max: 1 });
  registerConnectionDialect(sql, "postgres");
  _setDbConnection(sql as unknown as SQLInstance);
  try {
    await run(server);
  } finally {
    await sql.close();
    server.stop();
  }
}

const at = (rows: { at: Date }[]): string => rows[0]!.at.toISOString();

describe("a PostgreSQL timestamp read under a TZ that is not UTC", () => {
  it("reads as the instant stored from a statement that binds a value, on every run", async () => {
    await withServer(async (server) => {
      const sql = "SELECT at FROM events WHERE id = ?";
      expect(at(await DB.raw<{ at: Date }>(sql, [1]))).toBe(ISO);
      expect(at(await DB.raw<{ at: Date }>(sql, [1]))).toBe(ISO);
      expect(at(await DB.table("events").where("id", 1).get<{ at: Date }>())).toBe(ISO);
      expect(server.executions.map((e) => e.format)).toEqual(["binary", "binary", "binary"]);
    });
  });

  it("is sent as written when the statement binds nothing, and read in binary after its first run", async () => {
    await withServer(async (server) => {
      await DB.table("events").get();
      expect(at(await DB.table("events").get<{ at: Date }>())).toBe(ISO);
      expect(server.executions).toEqual([
        { sql: "SELECT * FROM events", params: 0, format: "text" },
        { sql: "SELECT * FROM events", params: 0, format: "binary" },
      ]);
    });
  });

  it("reads moved by the zone's offset on the first run with nothing bound, on Bun 1.3 only", async () => {
    // The stored wall-clock time, `2026-08-20 03:00:00`, read as New York time. The
    // zone is behind UTC in August, so the two readings differ.
    const LOCAL_READING = new Date(2026, 7, 20, 3, 0, 0).toISOString();
    expect(LOCAL_READING).not.toBe(ISO);
    await withServer(async () => {
      const first = [
        at(await DB.table("events").get<{ at: Date }>()),
        at(await DB.raw<{ at: Date }>("SELECT at FROM events")),
        at(await DB.raw<{ at: Date }>`SELECT at FROM events AS e`),
      ];
      // The driver reads the text one way for every statement: as the instant stored,
      // or as the stored wall-clock time in the process zone.
      const readsLocal = first[0] === LOCAL_READING;
      expect(first).toEqual(Array(3).fill(readsLocal ? LOCAL_READING : ISO));
      // Bun 1.4 reads it correctly; only the releases before it read it as local time.
      expect(readsLocal).toBe(BEFORE_1_4);
    });
  });
});
