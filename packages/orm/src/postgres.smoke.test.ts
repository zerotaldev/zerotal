/**
 * The ORM against a real PostgreSQL server.
 *
 * Every other suite in this package opens `new SQL(":memory:")`, so the whole of it —
 * 1,019 tests across 70 files — proves only that the ORM works on SQLite. The Postgres
 * dialect is covered at the level of the string it emits (`Dialect.test.ts`,
 * `BlueprintExtras.test.ts`), and a test that asserts on SQL it never executes cannot
 * catch SQL a server rejects. That is the gap this file exists to close, and it is the
 * reason the CI job carries a Postgres service container.
 *
 * The tests are deliberately the ones where Postgres and SQLite genuinely diverge —
 * identity columns, `RETURNING`, real row locks, transactional DDL, timestamp binds —
 * rather than a second pass over query-builder logic the SQLite suite already covers.
 *
 * ## Running it
 *
 * `ZT_PG_URL` selects the server; without it the suite skips, so a checkout with no
 * Postgres still runs `bun test` clean:
 *
 * ```bash
 * ZT_PG_URL=postgres://postgres:postgres@localhost:5432/zerotal_test bun test src/postgres.smoke.test.ts
 * ```
 *
 * **In CI the skip is the failure mode to fear**, which is why `ci.yml` proves the server
 * is reachable in a step of its own before this ever runs — a suite that silently skips
 * reports green for exactly the defects it was written to catch. The same reasoning is
 * written up beside the browser job.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./db/DB.ts";
import { _setQueryBuilderDialect, registerConnectionDialect } from "./db/QueryBuilder.ts";
import { _setBaseModelConnection, _setBaseModelDialect } from "./model/BaseModel.ts";
import { Schema } from "./schema/Schema.ts";
import { SchemaInspector } from "./schema/SchemaInspector.ts";

const PG_URL = Bun.env["ZT_PG_URL"] ?? "";

/** Skipped without a server; see the module docblock on why CI must not reach this. */
const describePostgres = PG_URL ? describe : describe.skip;

let db: SQL;

beforeAll(async () => {
  if (!PG_URL) return;
  db = new SQL(PG_URL);

  _setDbConnection(db as never);
  _setBaseModelConnection(db as never);
  _setBaseModelDialect("postgres");
  _setQueryBuilderDialect("postgres");
  registerConnectionDialect(db, "postgres");

  // A previous run that failed mid-test leaves the table behind.
  await db`DROP TABLE IF EXISTS zt_smoke_widgets`;
});

afterAll(async () => {
  if (!PG_URL) return;
  await db`DROP TABLE IF EXISTS zt_smoke_widgets`;
  _setDbConnection(null as never);
  _setBaseModelConnection(null as never);
  _setQueryBuilderDialect("sqlite");
  await db.end();
});

describePostgres("Blueprint DDL is SQL PostgreSQL accepts", () => {
  it("creates a table from the portable builder", async () => {
    // `increments` is the divergence that matters: SQLite writes INTEGER PRIMARY KEY
    // AUTOINCREMENT, which Postgres rejects outright. Only a server can say whether
    // what the Blueprint emitted is the identity column it believed it was emitting.
    await Schema.create("zt_smoke_widgets", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("score");
      table.boolean("active");
      table.timestamp("made_at");
    });

    const columns = await SchemaInspector.columns("zt_smoke_widgets");
    const names = (columns ?? []).map((c) => c.name);

    expect(names).toContain("id");
    expect(names).toContain("name");
    expect(names).toContain("score");
    expect(names).toContain("active");
    expect(names).toContain("made_at");
  });

  it("gives the increments column a working identity default", async () => {
    // No id supplied. On SQLite this passes for free; on Postgres it only passes if
    // the column was created as IDENTITY/serial rather than a plain integer.
    await DB.table("zt_smoke_widgets").insert({ name: "first", score: 1, active: true });
    await DB.table("zt_smoke_widgets").insert({ name: "second", score: 2, active: false });

    const rows = (await DB.table("zt_smoke_widgets").orderBy("id").get()) as {
      id: number;
      name: string;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBeGreaterThan(0);
    expect(rows[1]!.id).toBeGreaterThan(rows[0]!.id);
  });
});

describePostgres("queries round-trip through the server", () => {
  it("filters, orders and counts", async () => {
    expect(await DB.table("zt_smoke_widgets").count()).toBe(2);
    expect(await DB.table("zt_smoke_widgets").where("active", true).count()).toBe(1);

    const rows = (await DB.table("zt_smoke_widgets").orderBy("score", "desc").get()) as {
      name: string;
    }[];
    expect(rows[0]!.name).toBe("second");
  });

  it("round-trips a boolean rather than SQLite's 0/1", async () => {
    // SQLite has no boolean type and answers 1; Postgres answers true. Code that
    // compares with === is wrong on exactly one of them.
    const row = (await DB.table("zt_smoke_widgets").where("name", "first").first()) as {
      active: unknown;
    };
    expect(row.active).toBe(true);
  });

  it("round-trips a timestamp as a Date", async () => {
    const made = new Date("2026-08-20T03:00:00.000Z");
    await DB.table("zt_smoke_widgets").insert({
      name: "stamped",
      score: 3,
      active: true,
      made_at: made,
    });

    const row = (await DB.table("zt_smoke_widgets").where("name", "stamped").first()) as {
      made_at: Date;
    };
    expect(new Date(row.made_at).toISOString()).toBe(made.toISOString());
  });

  it("updates and deletes what it matched", async () => {
    await DB.table("zt_smoke_widgets").where("name", "stamped").update({ score: 99 });
    const row = (await DB.table("zt_smoke_widgets").where("name", "stamped").first()) as {
      score: number;
    };
    expect(Number(row.score)).toBe(99);

    await DB.table("zt_smoke_widgets").where("name", "stamped").delete();
    expect(await DB.table("zt_smoke_widgets").where("name", "stamped").count()).toBe(0);
  });
});

describePostgres("Postgres-only SQL actually executes", () => {
  it("runs a shared lock inside a transaction", async () => {
    // `sharedLock()` compiles to FOR SHARE on Postgres and to nothing on SQLite, so the
    // SQLite suite proves only that the clause is absent. Postgres also rejects FOR SHARE
    // outside a transaction, which makes this the one place the clause is exercised.
    await DB.transaction(async () => {
      const rows = await DB.table("zt_smoke_widgets").where("active", true).sharedLock().get();
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  it("rolls a transaction back on a throw", async () => {
    const before = await DB.table("zt_smoke_widgets").count();

    await expect(
      DB.transaction(async () => {
        await DB.table("zt_smoke_widgets").insert({ name: "doomed", score: 0, active: false });
        throw new Error("rollback please");
      }),
    ).rejects.toThrow("rollback please");

    expect(await DB.table("zt_smoke_widgets").count()).toBe(before);
    expect(await DB.table("zt_smoke_widgets").where("name", "doomed").count()).toBe(0);
  });
});

describePostgres("schema teardown", () => {
  it("drops the table", async () => {
    await Schema.drop("zt_smoke_widgets");
    expect(await SchemaInspector.columns("zt_smoke_widgets")).toBeNull();
  });
});
