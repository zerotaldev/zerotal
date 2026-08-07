/**
 * Two query-compilation defects that returned a *plausible* wrong answer.
 *
 * Neither raised an error. `count()` was compiled from scratch rather than from the query
 * it was counting, and `whereRaw` deleted any `?` it had no binding for — so both produced
 * SQL that ran cleanly and meant something else.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bun.SQL has no exported type
let db: any;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  await db`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, country TEXT, age INTEGER)`;
});

afterAll(async () => {
  _setDbConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM people`;
  await db`INSERT INTO people (id, name, country, age) VALUES
    (1, 'Ada',  'uk', 36),
    (2, 'Bo',   'uk', 41),
    (3, 'Cy',   'za', 29),
    (4, 'Who?', 'za', 52)`;
});

describe("count() counts what the query returns", () => {
  it("counts groups, not rows, for a grouped query", async () => {
    // Two countries. Dropping the grouping answered 1, which also made paginate() report
    // `total: 1` beside two rows of data.
    expect(await DB.table("people").groupBy("country").count()).toBe(2);
  });

  it("honours DISTINCT", async () => {
    expect(await DB.table("people").distinct().select("country").count()).toBe(2);
  });

  it("honours HAVING", async () => {
    const n = await DB.table("people").groupBy("country").having("COUNT(*)", ">", 1).count();
    expect(n).toBe(2);
  });

  it("still counts rows for an ordinary filtered query", async () => {
    expect(await DB.table("people").where("country", "uk").count()).toBe(2);
    expect(await DB.table("people").count()).toBe(4);
  });

  it("drops ORDER BY, which is meaningless in a count and illegal when grouped", async () => {
    const { sql } = DB.table("people").orderBy("name").toSqlWithBindings();
    expect(sql).toContain("ORDER BY");
    // Postgres and MySQL under ONLY_FULL_GROUP_BY reject an ordered aggregate, so
    // orderBy(...).paginate() — the framework's most common call — could not run there.
    expect(await DB.table("people").orderBy("name").count()).toBe(4);
  });

  it("gives paginate() a total that matches the data", async () => {
    const page = await DB.table("people").orderBy("name").paginate(2, 1);
    expect(page.total).toBe(4);
    expect(page.data).toHaveLength(2);
    expect(page.lastPage).toBe(2);
  });
});

describe("whereRaw preserves a ? it has no binding for", () => {
  it("keeps a literal ? inside a string", async () => {
    // Deleting it turned `LIKE 'Who?%'` into `LIKE 'Who%'` — different rows, no error.
    const rows = await DB.table("people").whereRaw("name LIKE 'Who?%'").get();
    expect(rows.map((r) => (r as { name: string }).name)).toEqual(["Who?"]);
  });

  it("still binds when bindings are supplied", async () => {
    const rows = await DB.table("people").whereRaw("country = ? AND age > ?", ["uk", 40]).get();
    expect(rows.map((r) => (r as { name: string }).name)).toEqual(["Bo"]);
  });

  it("binds what it can and leaves the rest literal", async () => {
    const { sql, bindings } = DB.table("people")
      .whereRaw("name LIKE ? AND note = 'huh?'", ["A%"])
      .toSqlWithBindings();
    expect(sql).toContain("'huh?'");
    expect(bindings).toEqual(["A%"]);
  });
});
