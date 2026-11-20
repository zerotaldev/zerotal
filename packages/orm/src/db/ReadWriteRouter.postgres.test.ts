/**
 * The read/write router in front of two PostgreSQL connections, through the real
 * driver: which server each statement reaches.
 *
 * `ReadWriteRouter.test.ts` checks the classification on strings and mock
 * connections; this runs the SQL the ORM sends, as Bun sends it, against two fake
 * servers that speak the wire protocol (`__fixtures__/fakePostgres.ts`).
 */
import { describe, it, expect, afterAll } from "bun:test";
import { SQL } from "bun";
import { startFakePostgres } from "../__fixtures__/fakePostgres.ts";
import { DB, _setDbConnection } from "./DB.ts";
import { registerConnectionDialect } from "./QueryBuilder.ts";
import { createReadWriteRouter } from "./ReadWriteRouter.ts";
import type { SQLInstance } from "./sql-types.ts";

const ISO = "2026-08-20T03:00:00.000Z";

afterAll(() => _setDbConnection(null));

describe("createReadWriteRouter — against PostgreSQL", () => {
  it("sends a WITH statement that changes rows to the primary, and reads to a replica", async () => {
    const primary = startFakePostgres({ column: "at", oid: 1114, iso: ISO });
    const replica = startFakePostgres({ column: "at", oid: 1114, iso: ISO });
    const url = (port: number) => `postgres://u:p@127.0.0.1:${port}/db`;
    const p = new SQL({ url: url(primary.port), tls: false, max: 1 });
    const r = new SQL({ url: url(replica.port), tls: false, max: 1 });
    const router = createReadWriteRouter(p as unknown as SQLInstance, [
      r as unknown as SQLInstance,
    ]);
    registerConnectionDialect(router, "postgres");
    _setDbConnection(router);
    try {
      await DB.raw("WITH old AS (SELECT id FROM jobs WHERE done) DELETE FROM jobs USING old");
      await DB.raw("WITH d AS (DELETE FROM jobs WHERE done RETURNING *) SELECT count(*) FROM d");
      await DB.raw("DELETE FROM sessions WHERE expires_at < NOW()");
      await DB.table("sessions").delete();
      await DB.raw("SELECT at FROM events");
      await DB.raw("WITH recent AS (SELECT at FROM events) SELECT at FROM recent");
      await DB.table("events").get();

      const sent = (server: typeof primary) =>
        server.executions.map((e) => e.sql.replace(/\s+/g, " ").trim());
      expect(sent(primary)).toEqual([
        "WITH old AS (SELECT id FROM jobs WHERE done) DELETE FROM jobs USING old",
        "WITH d AS (DELETE FROM jobs WHERE done RETURNING *) SELECT count(*) FROM d",
        "DELETE FROM sessions WHERE expires_at < NOW()",
        "DELETE FROM sessions",
      ]);
      expect(sent(replica)).toEqual([
        "SELECT at FROM events",
        "WITH recent AS (SELECT at FROM events) SELECT at FROM recent",
        "SELECT * FROM events",
      ]);
    } finally {
      await p.close();
      await r.close();
      primary.stop();
      replica.stop();
    }
  });
});
