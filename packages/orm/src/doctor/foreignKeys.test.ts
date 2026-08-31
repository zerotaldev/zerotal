/**
 * A migration that promises a cascade the database will not perform.
 *
 * SQLite ignores foreign keys unless the connection asks it not to, so
 * `cascadeOnDelete()` is a comment by default: deleting a parent leaves its
 * children and nothing anywhere says so. An app's erasure path missed three tables
 * because of it, including both holding uploaded files.
 */
import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import { foreignKeysCheck } from "./foreignKeys.ts";
import { _applySqlitePragmas } from "../provider/DatabaseProvider.ts";
import type { SQLInstance } from "../db/sql-types.ts";

/** An app stub whose container answers only what the check reads. */
function appWith(sql: unknown, driver = "sqlite") {
  return {
    container: {
      makeSync: (key: string) =>
        key === "db"
          ? sql
          : { get: <T>(k: string, d: T): T => (k === "database.driver" ? (driver as T) : d) },
    },
  } as never;
}

async function db(withConstraint: boolean, enforce: boolean): Promise<SQLInstance> {
  const sql = new SQL(":memory:") as unknown as SQLInstance;
  await _applySqlitePragmas(sql, "sqlite", enforce);
  await sql`CREATE TABLE parents (id INTEGER PRIMARY KEY)`;
  if (withConstraint) {
    await sql`CREATE TABLE kids (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE)`;
  } else {
    await sql`CREATE TABLE kids (id INTEGER PRIMARY KEY, parent_id INTEGER)`;
  }
  return sql;
}

describe("foreignKeysCheck", () => {
  it("warns when the schema declares a foreign key and the connection ignores it", async () => {
    const sql = await db(true, false);
    const result = await foreignKeysCheck.run(appWith(sql));

    expect(result.status).toBe("warn");
    expect(result.message).toContain("does not enforce");
    expect(result.fix).toContain("foreignKeys: true");
  });

  it("says nothing once the connection enforces them", async () => {
    const sql = await db(true, true);
    expect((await foreignKeysCheck.run(appWith(sql))).status).toBe("ok");
  });

  it("says nothing when the schema declares none", async () => {
    // Warning about an unused setting is how a doctor becomes noise.
    const sql = await db(false, false);
    expect((await foreignKeysCheck.run(appWith(sql))).status).toBe("ok");
  });

  it("says nothing on a dialect that always enforces", async () => {
    const sql = await db(true, false);
    expect((await foreignKeysCheck.run(appWith(sql, "postgres"))).status).toBe("ok");
  });
});

describe("_applySqlitePragmas", () => {
  it("makes the cascade actually cascade", async () => {
    const sql = await db(true, true);
    await sql`INSERT INTO parents (id) VALUES (1)`;
    await sql`INSERT INTO kids (id, parent_id) VALUES (10, 1)`;
    await sql`DELETE FROM parents WHERE id = 1`;

    const kids = (await sql`SELECT COUNT(*) AS n FROM kids`) as { n: number }[];
    expect(Number(kids[0]!.n)).toBe(0);
  });

  it("leaves the children behind without it, which is the bug being reported", async () => {
    const sql = await db(true, false);
    await sql`INSERT INTO parents (id) VALUES (1)`;
    await sql`INSERT INTO kids (id, parent_id) VALUES (10, 1)`;
    await sql`DELETE FROM parents WHERE id = 1`;

    const kids = (await sql`SELECT COUNT(*) AS n FROM kids`) as { n: number }[];
    expect(Number(kids[0]!.n)).toBe(1);
  });
});

/**
 * Enforcement is on by default now, so the question changes.
 *
 * A child row whose parent is missing was legal without enforcement and is a
 * violation with it — so an existing database can carry rows the upgrade turns into
 * writes that fail. That is the whole risk of flipping the default, and it is worth
 * reporting rather than discovering.
 */
describe("foreignKeysCheck once enforcement is on", () => {
  async function orphaned(): Promise<SQLInstance> {
    const sql = new SQL(":memory:") as unknown as SQLInstance;
    // Written the way an app on the old default wrote it: constraints declared,
    // enforcement off, so the orphan goes in without complaint.
    await sql`CREATE TABLE parents (id INTEGER PRIMARY KEY)`;
    await sql`CREATE TABLE kids (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))`;
    await sql`INSERT INTO kids (id, parent_id) VALUES (1, 999)`;
    await sql`PRAGMA foreign_keys = ON`;
    return sql;
  }

  it("fails on a database that already holds an orphan", async () => {
    const result = await foreignKeysCheck.run(appWith(await orphaned()));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("1 row(s)");
    expect(result.fix).toContain("db:check-foreign-keys");
  });

  it("passes once the data agrees with the constraints", async () => {
    const sql = await db(true, true);
    await sql`INSERT INTO parents (id) VALUES (1)`;
    await sql`INSERT INTO kids (id, parent_id) VALUES (10, 1)`;

    expect((await foreignKeysCheck.run(appWith(sql))).status).toBe("ok");
  });
});
