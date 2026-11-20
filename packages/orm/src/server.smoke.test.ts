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
import { BaseModel } from "./model/BaseModel.ts";
import { column } from "./model/decorators/column.ts";
import { table } from "./model/decorators/table.ts";
import { _resetMysqlDateDecoding } from "./db/driverDates.ts";
import { currentZone } from "./__fixtures__/processZone.ts";
import { Carbon } from "@zerotal/core/carbon";

type Dialect = "postgres" | "mysql";

/**
 * One instant in every kind of column a date can live in: the Blueprint's TEXT,
 * the server's own date-time type, and its zone-aware one — plus a native JSON
 * column, which the driver parses itself.
 */
@table("zt_smoke_moments", { timestamps: false })
class Moment extends BaseModel {
  @column() label!: string;
  @column({ type: "datetime", nullable: true }) atText?: Carbon | null;
  @column({ type: "datetime", nullable: true }) atNative?: Carbon | null;
  @column({ type: "datetime", nullable: true }) atZoned?: Carbon | null;
  @column({ type: "json", nullable: true }) doc?: unknown;
}

const MOMENTS_DDL: Record<Dialect, string> = {
  mysql:
    "CREATE TABLE zt_smoke_moments (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(40) NOT NULL, " +
    "at_text TEXT NULL, at_native DATETIME NULL, at_zoned TIMESTAMP NULL, doc JSON NULL)",
  postgres:
    "CREATE TABLE zt_smoke_moments (id SERIAL PRIMARY KEY, label VARCHAR(40) NOT NULL, " +
    "at_text TEXT NULL, at_native TIMESTAMP NULL, at_zoned TIMESTAMPTZ NULL, doc JSONB NULL)",
};

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
      // Both dialect globals, not just the query builder's. `_setBaseModelDialect`
      // was set in beforeAll and never put back, so after this file ran against
      // MySQL every later test in the process took the MySQL insert branch — and
      // that branch reads the new row's id with `LAST_INSERT_ID()`, which SQLite
      // does not have. Postgres hid it: its branch uses `RETURNING`, which SQLite
      // does support, so the same leak was harmless there and only the MySQL job
      // went red — and only when the file order put this one first.
      _setBaseModelDialect("sqlite");
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

    // The ORM writes dates as UTC. Under a zone that is not UTC they came back moved by
    // its offset: MySQL's zone-less text was parsed as local time on every Bun, and Bun
    // 1.3 decoded MySQL's own DATETIME and TIMESTAMP as local fields where 1.4 reads UTC.
    // CI's `TZ` is unset, which is UTC, where every one of those readings agrees — so the
    // zone is set here, and this block runs on both Bun versions in CI's matrix.
    describe("dates and JSON under a zone that is not UTC", () => {
      const INSTANT = new Date("2026-08-20T03:00:00.000Z");
      let previousTz = "UTC";

      beforeAll(async () => {
        if (!url) return;
        // Put back by assignment, never `delete`: see __fixtures__/processZone.ts.
        previousTz = process.env.TZ ?? currentZone();
        // Ahead of UTC with no daylight saving, so the expected offset is fixed.
        process.env.TZ = "Asia/Kolkata";
        _resetMysqlDateDecoding();
        await DB.raw("DROP TABLE IF EXISTS zt_smoke_moments");
        await DB.raw(MOMENTS_DDL[dialect]);
      });

      afterAll(async () => {
        if (!url) return;
        process.env.TZ = previousTz;
        _resetMysqlDateDecoding();
        await DB.raw("DROP TABLE IF EXISTS zt_smoke_moments");
      });

      it("reads a saved model's dates back as the instant written", async () => {
        await Moment.create({
          label: "saved",
          atText: Carbon.create(INSTANT),
          atNative: Carbon.create(INSTANT),
          atZoned: Carbon.create(INSTANT),
          doc: { tags: ["a", "b"], n: 2 },
        });

        const m = (await Moment.query().where("label", "saved").first())!;
        expect(m.atText!.valueOf()).toBe(INSTANT.getTime());
        expect(m.atNative!.valueOf()).toBe(INSTANT.getTime());
        expect(m.atZoned!.valueOf()).toBe(INSTANT.getTime());
        expect(m.doc).toEqual({ tags: ["a", "b"], n: 2 });
      });

      it("returns the same Date from the query builder and from DB.raw", async () => {
        const row = (await DB.table("zt_smoke_moments").where("label", "saved").first()) as {
          at_native: Date;
          at_zoned: Date;
        };
        expect(new Date(row.at_native).getTime()).toBe(INSTANT.getTime());
        expect(new Date(row.at_zoned).getTime()).toBe(INSTANT.getTime());

        const [raw] = await DB.raw<{ at_native: Date }>(
          "SELECT at_native FROM zt_smoke_moments WHERE label = ?",
          ["saved"],
        );
        expect(new Date(raw!.at_native).getTime()).toBe(INSTANT.getTime());
      });

      it("reads a Date bound by the driver itself as the instant bound", async () => {
        await DB.raw`INSERT INTO zt_smoke_moments (label, at_native, at_zoned) VALUES (${"bound"}, ${INSTANT}, ${INSTANT})`;
        const m = (await Moment.query().where("label", "bound").first())!;
        expect(m.atNative!.valueOf()).toBe(INSTANT.getTime());
        expect(m.atZoned!.valueOf()).toBe(INSTANT.getTime());
      });

      it("finds the row by comparing against the same instant", async () => {
        const at = Carbon.create(INSTANT);
        const later = Carbon.create(new Date(INSTANT.getTime() + 1000));
        for (const col of ["atText", "atNative", "atZoned"] as const) {
          expect(await Moment.query().where("label", "saved").where(col, ">=", at).count()).toBe(1);
          expect(await Moment.query().where("label", "saved").where(col, "=", at).count()).toBe(1);
          expect(await Moment.query().where("label", "saved").where(col, ">=", later).count()).toBe(
            0,
          );
        }
      });

      // A statement with no bound values runs differently the first time on each
      // connection: Bun sends it before it knows the column types, and PostgreSQL answers
      // in text, which Bun 1.3 parses as local time for `timestamp` — a limitation the
      // casts guide documents. The statement here is new to every connection, so this
      // is its first run.
      it("reads a statement with no bound values as the casts guide says, on its first run", async () => {
        const fresh = `zt_${Date.now()}`;
        const [row] = await DB.raw<Record<string, Date>>(
          `SELECT at_native AS ${fresh} FROM zt_smoke_moments WHERE label = 'saved'`,
        );
        const first = new Date(row![fresh]!).getTime();
        if (dialect === "mysql") {
          expect(first).toBe(INSTANT.getTime());
          return;
        }
        // Asia/Kolkata is 5h30 ahead, so the stored 03:00 read as local time is 21:30 UTC.
        const asLocal = INSTANT.getTime() - 5.5 * 3_600_000;
        const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
        const before14 = major < 1 || (major === 1 && minor < 4);
        expect(first).toBe(before14 ? asLocal : INSTANT.getTime());
      });

      if (dialect === "postgres") {
        it("fails naming the column on an infinite timestamp, on every Bun", async () => {
          await DB.raw(
            "INSERT INTO zt_smoke_moments (label, at_native) VALUES ('forever', 'infinity')",
          );
          await expect(Moment.query().where("label", "forever").first()).rejects.toThrow(
            /Moment\.atNative holds/,
          );
        });
      }
    });

    describe("schema teardown", () => {
      it("drops the table", async () => {
        await Schema.drop(T);
        expect(await SchemaInspector.columns(T)).toBeNull();
      });
    });
  });
}
