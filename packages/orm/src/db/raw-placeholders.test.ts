import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import type { SQLInstance } from "./sql-types.ts";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection } from "../model/BaseModel.ts";
import { _splitPlaceholders } from "./templateStrings.ts";

/**
 * Regression guard: string-form SQL finds its placeholders the way the database does.
 *
 * `DB.raw(string)`, `whereRaw()` and the schema helpers split their SQL on every `?`. A `?`
 * inside a string literal or a comment became a placeholder, so the query bound the wrong
 * values, or none, and could return nothing instead of failing. Nothing compared the number of
 * placeholders with the number of bindings either.
 */

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:") as unknown as SQLInstance;
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await db`CREATE TABLE ph_notes (id INTEGER PRIMARY KEY, title TEXT, n INTEGER, "it's" TEXT)`;
  await db`INSERT INTO ph_notes (title, n, "it's") VALUES ('Why?', 1, 'a'), ('plain', 2, 'b')`;
});
afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});

describe("DB.raw string form", () => {
  it("returns the row for a literal '?' with no bindings", async () => {
    const rows = await DB.raw<{ title: string }>("SELECT title FROM ph_notes WHERE title = 'Why?'");
    expect(rows.map((r) => r.title)).toEqual(["Why?"]);
  });

  it("binds to the placeholder after a literal '?', not to the literal", async () => {
    const rows = await DB.raw<{ title: string }>(
      "SELECT title FROM ph_notes WHERE title = 'Why?' AND n = ?",
      [1],
    );
    expect(rows.map((r) => r.title)).toEqual(["Why?"]);
  });

  it("ignores a '?' and an apostrophe inside comments", async () => {
    const rows = await DB.raw<{ title: string }>(
      "SELECT title FROM ph_notes -- what's this? a comment\n" +
        "/* and isn't this one? */ WHERE n = ?",
      [2],
    );
    expect(rows.map((r) => r.title)).toEqual(["plain"]);
  });

  // Only that the count check sees both placeholders: Bun's SQLite adapter (1.3.14 and 1.4.0)
  // returns no rows for any statement naming a column with an apostrophe in it, whatever the ORM
  // sends, so the rows themselves cannot be checked here.
  it("does not let an apostrophe in a `backtick` identifier open a string", async () => {
    await expect(
      DB.raw("SELECT title FROM ph_notes WHERE `it's` = ? AND n = ?", ["b", 2]),
    ).resolves.toBeArray();
  });

  it("does not let an apostrophe in a [bracket] identifier open a string", async () => {
    await expect(
      DB.raw("SELECT title FROM ph_notes WHERE [it's] = ? AND n = ?", ["a", 1]),
    ).resolves.toBeArray();
  });

  it("throws, naming both counts, when there are fewer bindings than placeholders", async () => {
    await expect(DB.raw("SELECT title FROM ph_notes WHERE n = ? OR n = ?", [1])).rejects.toThrow(
      "found 2 placeholder(s) in the SQL but was given 1 binding(s)",
    );
  });

  it("throws, naming both counts, when there are more bindings than placeholders", async () => {
    await expect(DB.raw("SELECT title FROM ph_notes WHERE n = ?", [1, 2, 3])).rejects.toThrow(
      "found 1 placeholder(s) in the SQL but was given 3 binding(s)",
    );
  });

  it("leaves the tagged form as it was", async () => {
    const title = "Why?";
    const rows = await DB.raw<{ title: string }>`SELECT title FROM ph_notes WHERE title = ${title}`;
    expect(rows.map((r) => r.title)).toEqual(["Why?"]);
  });
});

describe("whereRaw", () => {
  it("binds to the placeholder after a literal '?'", async () => {
    const rows = await DB.table("ph_notes").whereRaw("title = 'Why?' AND n = ?", [1]).get();
    expect(rows.map((r) => r["title"])).toEqual(["Why?"]);
  });

  it("binds to the placeholder after an apostrophe in a quoted identifier", () => {
    for (const ident of ["`it's`", "[it's]"]) {
      const { bindings } = DB.table("ph_notes")
        .whereRaw(`${ident} = 'a' AND n = ?`, [1])
        .toSqlWithBindings();
      expect(bindings).toEqual([1]);
    }
  });

  it("still passes a '?' with no binding left through as written", async () => {
    // How PostgreSQL's jsonb `?` operator reaches the database. On SQLite, `?` with nothing
    // bound to it is NULL, so this matches nothing rather than failing to parse.
    const sql = DB.table("ph_notes").whereRaw("title = ?").toSql();
    expect(sql).toContain("title = ?");
  });
});

describe("_splitPlaceholders", () => {
  const holes = (sql: string, d?: "sqlite" | "postgres" | "mysql") =>
    _splitPlaceholders(sql, d).length - 1;

  it("counts bare placeholders", () => {
    expect(_splitPlaceholders("a = ? AND b = ?")).toEqual(["a = ", " AND b = ", ""]);
  });

  it("skips quoted text, with a doubled quote as an escape", () => {
    expect(holes(`a = 'it''s ?' AND "col?" = ?`)).toBe(1);
  });

  it("skips line and block comments", () => {
    expect(holes("a = ? -- b = ?\nAND c = ? /* d = ? */")).toBe(2);
  });

  it("does not let an apostrophe in a comment open a string", () => {
    expect(holes("SELECT 1 -- don't\nWHERE a = ?")).toBe(1);
  });

  it("does not let an apostrophe in a backtick identifier open a string on MySQL or SQLite", () => {
    expect(holes("SELECT `it's` FROM t WHERE a = ?", "mysql")).toBe(1);
    expect(holes("SELECT `it's` FROM t WHERE a = ?", "sqlite")).toBe(1);
    expect(holes("SELECT `a``b?` FROM t WHERE a = ?", "mysql")).toBe(1);
  });

  it("does not let an apostrophe in a [bracket] identifier open a string on SQLite", () => {
    expect(holes("SELECT [it's] FROM t WHERE a = ?", "sqlite")).toBe(1);
    expect(holes("SELECT [why?] FROM t WHERE a = ?", "sqlite")).toBe(1);
  });

  it("reads '--' as a comment on MySQL only when whitespace or the end follows", () => {
    expect(holes("SELECT 5--1, ?", "mysql")).toBe(1);
    expect(holes("SELECT 5 -- why?\n, ?", "mysql")).toBe(1);
    expect(holes("SELECT 5 --\twhy?\n, ?", "mysql")).toBe(1);
    expect(holes("SELECT ? --", "mysql")).toBe(1);
    // SQLite and PostgreSQL take `--` as a comment wherever it appears.
    expect(holes("SELECT 5--1, ?", "sqlite")).toBe(0);
  });

  it("reads '#' as a line comment on MySQL only", () => {
    expect(holes("SELECT 'it\\'s ?', ? # really?", "mysql")).toBe(1);
    expect(holes("SELECT ? # what's this?\n, ?", "mysql")).toBe(2);
  });

  it("keeps jsonb ?| and ?& as operators on PostgreSQL only", () => {
    expect(holes("data ?| array['a'] AND data ?& array['b'] AND id = ?", "postgres")).toBe(1);
    expect(holes("a = ?|1", "sqlite")).toBe(1);
    expect(holes("x = ?||'y'", "postgres")).toBe(1);
  });

  it("skips PostgreSQL dollar-quoted strings, but not $1", () => {
    expect(holes("SELECT $$why?$$, ?", "postgres")).toBe(1);
    expect(holes("SELECT $$it's$$, ?", "postgres")).toBe(1);
    expect(holes("SELECT $fn$ a ? b $fn$, ?", "postgres")).toBe(1);
    expect(holes("SELECT $fn$ it's $fn$, ?", "postgres")).toBe(1);
    expect(holes("SELECT $1::int, ?", "postgres")).toBe(1);
    expect(holes("SELECT price$ FROM t WHERE a = ?", "postgres")).toBe(1);
  });

  it("honours backslash escapes in a PostgreSQL E-string only", () => {
    expect(holes("SELECT E'it\\'s ?' , ?", "postgres")).toBe(1);
    // Read without the escape, `'it\'` would close early and `', ?` would open a string.
    expect(holes("SELECT E'it\\'s', ?", "postgres")).toBe(1);
    expect(holes("SELECT e'\\\\', ?", "postgres")).toBe(1);
    expect(holes("SELECT 'a\\' , ?", "postgres")).toBe(1);
  });

  it("honours backslash escapes in MySQL strings, and nowhere else", () => {
    expect(holes("SELECT 'it\\'s', ?", "mysql")).toBe(1);
    expect(holes('SELECT "a\\"?", ?', "mysql")).toBe(1);
    expect(holes("SELECT 'a\\' , ?", "sqlite")).toBe(1);
  });
});
