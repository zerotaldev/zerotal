/**
 * The ORM against a real database server — PostgreSQL and MySQL.
 *
 * Every other suite in this package opens `new SQL(":memory:")`, so all 1,019 of
 * them prove the ORM works on SQLite and nothing else. The other dialects are
 * covered at the level of the string they emit, and a test that asserts on SQL it
 * never executes cannot catch SQL a server rejects — which is how `table.boolean()`
 * shipped compiling to `INTEGER` on PostgreSQL, where a boolean column then refused
 * its own booleans.
 *
 * The cases here are the ones where engines genuinely part company: identity
 * columns, type round-trips, constraint violations, real row locks, transaction
 * rollback and `ALTER`. Re-running query-builder logic the SQLite suite already
 * proves would cost minutes and find nothing.
 *
 * ## Running it
 *
 * One env var per server; each is independent, and absent means skipped:
 *
 * ```bash
 * ZT_PG_URL=postgres://postgres:postgres@localhost:5432/zerotal_test    bun test src/server.smoke.test.ts
 * ZT_MYSQL_URL=mysql://root:root@localhost:3306/zerotal_test            bun test src/server.smoke.test.ts
 * ```
 *
 * **In CI the skip is the failure mode to fear**, so each job proves its server is
 * reachable in a step of its own before this runs — a suite that silently skips
 * reports green for exactly the defects it exists to catch. Same reasoning as the
 * browser job.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./db/DB.ts";
import { _setQueryBuilderDialect, registerConnectionDialect } from "./db/QueryBuilder.ts";
import { _setBaseModelConnection, _setBaseModelDialect } from "./model/BaseModel.ts";
import { Schema } from "./schema/Schema.ts";
import { SchemaInspector } from "./schema/SchemaInspector.ts";

type Dialect = "postgres" | "mysql";

const SERVERS: { dialect: Dialect; url: string }[] = [
  { dialect: "postgres", url: Bun.env["ZT_PG_URL"] ?? "" },
  { dialect: "mysql", url: Bun.env["ZT_MYSQL_URL"] ?? "" },
].filter((s): s is { dialect: Dialect; url: string } => s.url !== "");

/** Skipped when no server is configured; see the module docblock on CI. */
const describeIf = (url: string) => (url ? describe : describe.skip);

for (const { dialect, url } of SERVERS.length
  ? SERVERS
  : [{ dialect: "postgres" as Dialect, url: "" }]) {
  describeIf(url)(`the ORM against ${dialect}`, () => {
    const T = "zt_smoke_widgets";
    let db: SQL;

    beforeAll(async () => {
      if (!url) return;
      db = new SQL(url);

      _setDbConnection(db as never);
      _setBaseModelConnection(db as never);
      _setBaseModelDialect(dialect);
      _setQueryBuilderDialect(dialect);
      registerConnectionDialect(db, dialect);

      await db`DROP TABLE IF EXISTS zt_smoke_widgets`;

      await Schema.create(T, (table) => {
        table.increments("id");
        table.string("name").unique();
        table.integer("score");
        table.boolean("active");
        // Nullable because most inserts below omit it. A non-PK column is NOT NULL
        // by default and these servers enforce it where SQLite never had to.
        table.timestamp("made_at").nullable();
      });
    });

    afterAll(async () => {
      if (!url) return;
      await db`DROP TABLE IF EXISTS zt_smoke_widgets`;
      _setDbConnection(null as never);
      _setBaseModelConnection(null as never);
      _setQueryBuilderDialect("sqlite");
      await db.end();
    });

    describe("Blueprint DDL is SQL this server accepts", () => {
      it("created the table", async () => {
        const columns = await SchemaInspector.columns(T);
        const names = (columns ?? []).map((c) => c.name);
        expect(names).toContain("id");
        expect(names).toContain("name");
        expect(names).toContain("active");
        expect(names).toContain("made_at");
      });

      it("gives increments() a working identity default", async () => {
        // Free on SQLite; here it passes only if the column was created as an
        // identity/auto-increment rather than a plain integer.
        await DB.table(T).insert({ name: "first", score: 1, active: true });
        await DB.table(T).insert({ name: "second", score: 2, active: false });

        const rows = (await DB.table(T).orderBy("id").get()) as { id: number; name: string }[];
        expect(rows).toHaveLength(2);
        expect(Number(rows[0]!.id)).toBeGreaterThan(0);
        expect(Number(rows[1]!.id)).toBeGreaterThan(Number(rows[0]!.id));
      });

      it("applies an ALTER through Schema.table()", async () => {
        await Schema.table(T, (table) => {
          table.string("note").nullable();
        });
        const names = (await SchemaInspector.columns(T))!.map((c) => c.name);
        expect(names).toContain("note");
      });
    });

    describe("values survive the round trip", () => {
      it("filters, orders and counts", async () => {
        expect(await DB.table(T).count()).toBe(2);
        expect(await DB.table(T).where("active", true).count()).toBe(1);

        const rows = (await DB.table(T).orderBy("score", "desc").get()) as { name: string }[];
        expect(rows[0]!.name).toBe("second");
      });

      it("round-trips a boolean", async () => {
        const row = (await DB.table(T).where("name", "first").first()) as { active: unknown };
        // PostgreSQL has a real boolean and answers `true`; MySQL stores 0/1 in an
        // INTEGER, which is why `booleanType` differs per dialect. Both must be
        // *truthy* — asserting `=== true` everywhere would encode PostgreSQL's
        // answer as the contract.
        expect(Boolean(row.active)).toBe(true);
        if (dialect === "postgres") expect(row.active).toBe(true);
      });

      it("round-trips a timestamp as a date", async () => {
        const made = new Date("2026-08-20T03:00:00.000Z");
        await DB.table(T).insert({ name: "stamped", score: 3, active: true, made_at: made });

        const row = (await DB.table(T).where("name", "stamped").first()) as { made_at: Date };
        // Second precision, not millisecond: MySQL's DATETIME truncates unless the
        // column asks for fractional seconds, and this is not a test about that.
        expect(Math.abs(new Date(row.made_at).getTime() - made.getTime())).toBeLessThan(1000);
      });

      it("updates and deletes what it matched", async () => {
        await DB.table(T).where("name", "stamped").update({ score: 99 });
        const row = (await DB.table(T).where("name", "stamped").first()) as { score: number };
        expect(Number(row.score)).toBe(99);

        await DB.table(T).where("name", "stamped").delete();
        expect(await DB.table(T).where("name", "stamped").count()).toBe(0);
      });

      it("pages with limit and offset", async () => {
        const page = (await DB.table(T).orderBy("id").limit(1).offset(1).get()) as {
          name: string;
        }[];
        expect(page).toHaveLength(1);
        expect(page[0]!.name).toBe("second");
      });
    });

    describe("the server enforces what it declared", () => {
      it("rejects a duplicate on a unique column", async () => {
        // `unique()` on the Blueprint has to reach the server as a real constraint.
        // If it compiled to nothing, this insert would quietly succeed — which is
        // how an index that was never created goes unnoticed until production.
        await expect(
          DB.table(T).insert({ name: "first", score: 9, active: true }),
        ).rejects.toThrow();
      });

      it("rejects null in a NOT NULL column", async () => {
        await expect(
          DB.table(T).insert({ name: "nullish", score: null, active: true }),
        ).rejects.toThrow();
      });
    });

    describe("dialect-specific SQL actually executes", () => {
      it("runs a shared lock inside a transaction", async () => {
        // Compiles to `FOR SHARE` on PostgreSQL and `LOCK IN SHARE MODE` on MySQL,
        // and to nothing on SQLite — so the SQLite suite only ever proved the
        // clause was absent. PostgreSQL also rejects it outside a transaction.
        await DB.transaction(async () => {
          const rows = await DB.table(T).where("active", true).sharedLock().get();
          expect(Array.isArray(rows)).toBe(true);
        });
      });

      it("rolls a transaction back on a throw", async () => {
        const before = await DB.table(T).count();

        await expect(
          DB.transaction(async () => {
            await DB.table(T).insert({ name: "doomed", score: 0, active: false });
            throw new Error("rollback please");
          }),
        ).rejects.toThrow("rollback please");

        expect(await DB.table(T).count()).toBe(before);
        expect(await DB.table(T).where("name", "doomed").count()).toBe(0);
      });
    });

    describe("schema teardown", () => {
      it("drops the table", async () => {
        await Schema.drop(T);
        expect(await SchemaInspector.columns(T)).toBeNull();
      });
    });
  });
}
