/**
 * Operator and direction slots are identifier-class inputs.
 *
 * The ORM's SQL-injection story rests on an allowlist for anything interpolated rather than
 * bound. `where`, `having`, `whereAny/All` and `join` all applied it; `whereDate*`,
 * `has()/whereHas()` and `orderBy`'s direction did not. Each case below produced a query
 * that ran cleanly — the binding count stayed correct — while escaping the AND chain that
 * carries tenant scoping, ownership filters and the soft-delete scope.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bun.SQL has no exported type
let db: any;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  await db`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, owner_id INTEGER, created_at TEXT)`;
});

afterAll(async () => {
  _setDbConnection(null);
  await db.end();
});

/** The shape of an operator arriving from `req.query.op`: syntactically valid, chain-escaping. */
const ESCAPE = "IS NOT NULL OR 1=1 OR date(created_at) =";

describe("whereDate/whereTime/whereDay/whereMonth/whereYear", () => {
  const cases = ["whereDate", "whereTime", "whereDay", "whereMonth", "whereYear"] as const;

  for (const method of cases) {
    it(`${method}() rejects an operator that is not a comparison`, () => {
      expect(() => DB.table("posts")[method]("created_at", ESCAPE, "2026-01-01")).toThrow(
        /unsupported operator/,
      );
    });
  }

  it("still accepts the real operators", () => {
    const { sql } = DB.table("posts")
      .where("owner_id", 1)
      .whereDate("created_at", ">=", "2026-01-01")
      .toSqlWithBindings();
    expect(sql).toContain(">=");
  });

  it("treats a two-argument call as an equality against a value, not an operator", () => {
    // `whereDate('created_at', someUserValue)` must keep meaning `= someUserValue`, so a
    // value that happens to look like SQL is bound, never interpolated.
    const { sql, bindings } = DB.table("posts").whereDate("created_at", ESCAPE).toSqlWithBindings();
    expect(sql).not.toContain("1=1");
    expect(bindings).toContain(ESCAPE);
  });
});

describe("orderBy direction", () => {
  it("rejects a direction that is not asc or desc", () => {
    expect(() => DB.table("posts").orderBy("title", "desc; DROP TABLE posts --" as never)).toThrow(
      /must be "asc" or "desc"/,
    );
  });

  it("accepts either direction in any casing", () => {
    const upper = DB.table("posts")
      .orderBy("title", "DESC" as never)
      .toSqlWithBindings().sql;
    expect(upper).toContain("ORDER BY title DESC");
    const lower = DB.table("posts").orderBy("title", "asc").toSqlWithBindings().sql;
    expect(lower).toContain("ORDER BY title ASC");
  });

  it("guards reorder() too, since it delegates", () => {
    expect(() => DB.table("posts").reorder("title", "; DROP TABLE posts --" as never)).toThrow(
      /must be "asc" or "desc"/,
    );
  });
});
