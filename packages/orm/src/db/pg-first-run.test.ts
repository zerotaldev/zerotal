/**
 * A PostgreSQL `timestamp` reads as the same instant on a statement's first run as on
 * every later one.
 *
 * Bun asks PostgreSQL for results in binary, which it decodes as UTC. The exception is
 * the first run, on each connection, of a statement with no bound parameters: Bun sends
 * it before it knows the column types, so it asks for text. Bun 1.3 parses
 * `timestamp without time zone` text as local time, so under a `TZ` that is not UTC,
 * `DB.table("events").get()` read the column moved by the offset the first time and
 * correctly the second. Bun 1.4 parses the text as UTC.
 *
 * The server is a fake that speaks the wire protocol (`__fixtures__/fakePostgres.ts`),
 * so this runs the real driver everywhere; `server.smoke.test.ts` repeats it against a
 * real server in CI.
 */
import { describe, it, expect, afterAll, afterEach } from "bun:test";
import { SQL } from "bun";
import { startFakePostgres, type FakePostgres } from "../__fixtures__/fakePostgres.ts";
import { useProcessZone } from "../__fixtures__/processZone.ts";
import { DB, _setDbConnection } from "./DB.ts";
import { registerConnectionDialect } from "./QueryBuilder.ts";
import { createReadWriteRouter } from "./ReadWriteRouter.ts";
import { _pgBoundStatement, _setPgBoundParameter } from "./driverDates.ts";
import type { SQLInstance } from "./sql-types.ts";

const ISO = "2026-08-20T03:00:00.000Z";
const BUN_1_3 = /^1\.3\./.test(Bun.version);

useProcessZone("America/New_York");

afterAll(() => _setDbConnection(null));

afterEach(() => _setPgBoundParameter(null));

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

describe("a PostgreSQL timestamp from a statement with no parameters", () => {
  it("reads as the instant stored on its first run, from the builder and DB.raw", async () => {
    await withServer(async () => {
      expect(at(await DB.table("events").get<{ at: Date }>())).toBe(ISO);
      expect(at(await DB.table("events").get<{ at: Date }>())).toBe(ISO);
      expect(at(await DB.raw<{ at: Date }>("SELECT at FROM events"))).toBe(ISO);
      expect(at(await DB.raw<{ at: Date }>`SELECT at FROM events AS e`)).toBe(ISO);
    });
  });

  it("reaches the server with a parameter where the runtime needs one, and only there", async () => {
    await withServer(async (server) => {
      await DB.table("events").get();
      const [first] = server.executions;
      // Bun 1.3 under a zone with an offset needs it; 1.4 reads the text as UTC already.
      expect(first!.params).toBe(BUN_1_3 ? 1 : 0);
      expect(first!.sql.startsWith("WITH zt_bind AS")).toBe(BUN_1_3);
    });
  });

  it("is asked for in binary on its first run once it carries the parameter", async () => {
    // Forced on, so the same driver behaviour is checked on every Bun.
    _setPgBoundParameter(true);
    await withServer(async (server) => {
      await DB.table("events").get();
      await DB.raw("SELECT at FROM events");
      await DB.raw`SELECT at FROM events AS e`;
      expect(server.executions.map((e) => e.format)).toEqual(["binary", "binary", "binary"]);
    });
  });

  it("reads correctly when the SQL opens with a comment or a parenthesis", async () => {
    await withServer(async (server) => {
      expect(at(await DB.raw<{ at: Date }>("/* report */ SELECT at FROM events"))).toBe(ISO);
      expect(at(await DB.raw<{ at: Date }>("-- report\nSELECT at FROM events e"))).toBe(ISO);
      expect(at(await DB.raw<{ at: Date }>("(SELECT at FROM events) LIMIT 1"))).toBe(ISO);
      if (BUN_1_3) expect(server.executions.map((e) => e.params)).toEqual([1, 1, 1]);
    });
  });

  it("leaves a write that returns nothing as written", async () => {
    _setPgBoundParameter(true);
    await withServer(async (server) => {
      await DB.raw("DELETE FROM sessions WHERE expires_at < NOW()");
      await DB.table("sessions").delete();
      await DB.raw("UPDATE counters SET n = n + 1");
      expect(server.executions.map((e) => e.params)).toEqual([0, 0, 0]);
    });
  });

  it("is sent as written when the runtime does not need it", async () => {
    _setPgBoundParameter(false);
    await withServer(async (server) => {
      await DB.table("events").get();
      expect(server.executions[0]!.sql).toBe("SELECT * FROM events");
    });
  });
});

describe("_pgBoundStatement", () => {
  const send = (sql: string, values: unknown[] = []) => {
    _setPgBoundParameter(true);
    const [strings, sent] = _pgBoundStatement([sql], values);
    return { sql: strings.join("$1"), values: sent };
  };

  it("adds a parameter nothing reads, in a WITH clause ahead of the statement", () => {
    expect(send("SELECT * FROM events")).toEqual({
      sql: "WITH zt_bind AS (SELECT $1::int) SELECT * FROM events",
      values: [1],
    });
    expect(send("DELETE FROM events RETURNING id").sql).toBe(
      "WITH zt_bind AS (SELECT $1::int) DELETE FROM events RETURNING id",
    );
  });

  it("keeps leading comments first and looks past opening parentheses", () => {
    expect(send("/* report */ SELECT 1").sql).toBe(
      "/* report */ WITH zt_bind AS (SELECT $1::int) SELECT 1",
    );
    expect(send("-- a\n/* b /* nested */ c */\n  with s AS (SELECT 1) SELECT * FROM s").sql).toBe(
      "-- a\n/* b /* nested */ c */\n  WITH zt_bind AS (SELECT $1::int), s AS (SELECT 1) SELECT * FROM s",
    );
    expect(send("( (SELECT 1) UNION (SELECT 2))").sql).toBe(
      "WITH zt_bind AS (SELECT $1::int) ( (SELECT 1) UNION (SELECT 2))",
    );
  });

  it("changes a write only when it returns rows", () => {
    for (const sql of [
      "DELETE FROM sessions WHERE expires_at < NOW()",
      "UPDATE counters SET n = n + 1",
      "INSERT INTO log (at) VALUES (NOW())",
      "/* c */ DELETE FROM jobs",
    ]) {
      expect(send(sql)).toEqual({ sql, values: [] });
    }
    expect(send("UPDATE counters SET n = n + 1 RETURNING n, at").sql).toBe(
      "WITH zt_bind AS (SELECT $1::int) UPDATE counters SET n = n + 1 RETURNING n, at",
    );
  });

  it("joins a statement's own WITH clause rather than adding a second", () => {
    expect(send("WITH s AS (SELECT 1) SELECT * FROM s").sql).toBe(
      "WITH zt_bind AS (SELECT $1::int), s AS (SELECT 1) SELECT * FROM s",
    );
    expect(send("with recursive n(i) AS (SELECT 1) SELECT * FROM n").sql).toBe(
      "WITH recursive zt_bind AS (SELECT $1::int), n(i) AS (SELECT 1) SELECT * FROM n",
    );
  });

  it("leaves a statement that already binds a value, or cannot take a WITH clause", () => {
    const strings = ["SELECT * FROM events WHERE id = ", ""];
    _setPgBoundParameter(true);
    expect(_pgBoundStatement(strings, [1])[0]).toBe(strings);
    for (const sql of [
      "CREATE TABLE t (at timestamp)",
      "EXPLAIN SELECT 1",
      "SET TIME ZONE 'UTC'",
    ]) {
      expect(send(sql)).toEqual({ sql, values: [] });
    }
  });

  it("leaves every statement alone where the runtime does not need it", () => {
    _setPgBoundParameter(false);
    const strings = ["SELECT * FROM events"];
    expect(_pgBoundStatement(strings, [])[0]).toBe(strings);
  });

  it("needs it on Bun 1.3 under a zone with an offset, and nowhere else", () => {
    const strings = ["SELECT * FROM events"];
    expect(_pgBoundStatement(strings, [])[0] !== strings).toBe(BUN_1_3);
    process.env.TZ = "UTC";
    try {
      expect(_pgBoundStatement(strings, [])[0]).toBe(strings);
    } finally {
      process.env.TZ = "America/New_York";
    }
  });
});

describe("a statement given a parameter, behind read replicas", () => {
  it("still sends writes to the primary and reads to a replica", async () => {
    // Forced on: the rewritten form is what Bun 1.3 under a zone with an offset sends.
    _setPgBoundParameter(true);
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
      await DB.raw("DELETE FROM sessions WHERE expires_at < NOW()");
      await DB.table("sessions").delete();
      await DB.raw("UPDATE counters SET n = n + 1 RETURNING n, at");
      await DB.raw("WITH old AS (SELECT 1) DELETE FROM jobs");
      await DB.raw("SELECT at FROM events");
      expect(primary.executions.map((e) => e.sql.replace(/\s+/g, " "))).toEqual([
        "DELETE FROM sessions WHERE expires_at < NOW()",
        "DELETE FROM sessions",
        "WITH zt_bind AS (SELECT $1 ::int) UPDATE counters SET n = n + 1 RETURNING n, at",
        "WITH zt_bind AS (SELECT $1 ::int), old AS (SELECT 1) DELETE FROM jobs",
      ]);
      expect(replica.executions.map((e) => e.sql.replace(/\s+/g, " "))).toEqual([
        "WITH zt_bind AS (SELECT $1 ::int) SELECT at FROM events",
      ]);
    } finally {
      await p.close();
      await r.close();
      primary.stop();
      replica.stop();
    }
  });
});
