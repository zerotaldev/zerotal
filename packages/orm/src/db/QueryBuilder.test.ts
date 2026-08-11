import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { QueryBuilder } from "./QueryBuilder.ts";

// ── Schema ────────────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  name: string;
  email: string | null;
  active: number;
  score: number;
}

let db: SQLInstance;

const qb = (table = "users") => new QueryBuilder(table, db);

beforeAll(async () => {
  db = new SQL(":memory:");
  await db`
    CREATE TABLE users (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT    NOT NULL,
      email  TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      score  INTEGER NOT NULL DEFAULT 0
    )
  `;
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM users`;
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function seed(...rows: Partial<UserRow>[]) {
  for (const row of rows) {
    await qb().insert({
      name: row.name ?? "User",
      email: row.email ?? null,
      active: row.active ?? 1,
      score: row.score ?? 0,
    });
  }
}

// ── insert ────────────────────────────────────────────────────────────────

describe("QueryBuilder — insert()", () => {
  it("adds a row to the table", async () => {
    await qb().insert({ name: "Alice", active: 1, score: 10 });
    const rows = await qb().get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });
});

// ── get ───────────────────────────────────────────────────────────────────

describe("QueryBuilder — get()", () => {
  it("returns all rows when no where clause", async () => {
    await seed({ name: "Alice" }, { name: "Bob" }, { name: "Carol" });
    const rows = await qb().get<UserRow>();
    expect(rows).toHaveLength(3);
  });
});

// ── where ─────────────────────────────────────────────────────────────────

describe("QueryBuilder — where()", () => {
  it("filters with implicit = operator", async () => {
    await seed({ name: "Alice", active: 1 }, { name: "Bob", active: 0 });
    const rows = await qb().where("active", 1).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });

  it("filters with explicit operator", async () => {
    await seed({ name: "Alice", score: 5 }, { name: "Bob", score: 15 });
    const rows = await qb().where("score", ">", 10).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Bob");
  });

  it("chains multiple where clauses (AND)", async () => {
    await seed(
      { name: "Alice", active: 1, score: 10 },
      { name: "Bob", active: 1, score: 5 },
      { name: "Carol", active: 0, score: 10 },
    );
    const rows = await qb().where("active", 1).where("score", 10).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });
});

// ── orWhere ───────────────────────────────────────────────────────────────

describe("QueryBuilder — orWhere()", () => {
  it("produces OR condition", async () => {
    await seed(
      { name: "Alice", score: 10 },
      { name: "Bob", score: 20 },
      { name: "Carol", score: 5 },
    );
    const rows = await qb().where("score", 10).orWhere("score", 20).get<UserRow>();
    expect(rows).toHaveLength(2);
  });
});

// ── whereIn ──────────────────────────────────────────────────────────────

describe("QueryBuilder — whereIn()", () => {
  it("filters rows matching any value in the list", async () => {
    await seed({ name: "Alice" }, { name: "Bob" }, { name: "Carol" });
    const rows = await qb().whereIn("name", ["Alice", "Carol"]).get<UserRow>();
    expect(rows).toHaveLength(2);
  });

  it("returns no rows for an empty list", async () => {
    await seed({ name: "Alice" });
    const rows = await qb().whereIn("name", []).get<UserRow>();
    expect(rows).toHaveLength(0);
  });
});

// ── whereNull / whereNotNull ──────────────────────────────────────────────

describe("QueryBuilder — whereNull / whereNotNull()", () => {
  it("whereNull filters rows with null column", async () => {
    await seed({ name: "Alice", email: null }, { name: "Bob", email: "[email protected]" });
    const rows = await qb().whereNull("email").get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });

  it("whereNotNull filters rows with non-null column", async () => {
    await seed({ name: "Alice", email: null }, { name: "Bob", email: "[email protected]" });
    const rows = await qb().whereNotNull("email").get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Bob");
  });
});

// ── orderBy ───────────────────────────────────────────────────────────────

describe("QueryBuilder — orderBy()", () => {
  it("returns rows in ascending order by default", async () => {
    await seed({ name: "Carol", score: 3 }, { name: "Alice", score: 1 }, { name: "Bob", score: 2 });
    const rows = await qb().orderBy("score").get<UserRow>();
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("returns rows in descending order", async () => {
    await seed({ name: "Alice", score: 1 }, { name: "Bob", score: 2 }, { name: "Carol", score: 3 });
    const rows = await qb().orderBy("score", "desc").get<UserRow>();
    expect(rows.map((r) => r.name)).toEqual(["Carol", "Bob", "Alice"]);
  });
});

// ── limit / offset ────────────────────────────────────────────────────────

describe("QueryBuilder — limit() / offset()", () => {
  it("limit() restricts result count", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    const rows = await qb().orderBy("id").limit(2).get<UserRow>();
    expect(rows).toHaveLength(2);
  });

  it("offset() skips rows", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    const rows = await qb().orderBy("id").limit(1).offset(1).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("B");
  });
});

// ── first ────────────────────────────────────────────────────────────────

describe("QueryBuilder — first()", () => {
  it("returns the first matching row", async () => {
    await seed({ name: "Alice", score: 1 }, { name: "Bob", score: 2 });
    const row = await qb().orderBy("score").first<UserRow>();
    expect(row?.name).toBe("Alice");
  });

  it("returns null when no row matches", async () => {
    const row = await qb().where("name", "Nobody").first<UserRow>();
    expect(row).toBeNull();
  });
});

// ── count ────────────────────────────────────────────────────────────────

describe("QueryBuilder — count()", () => {
  it("returns the correct count", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    expect(await qb().count()).toBe(3);
  });

  it("respects where clause", async () => {
    await seed({ name: "A", active: 1 }, { name: "B", active: 0 }, { name: "C", active: 1 });
    expect(await qb().where("active", 1).count()).toBe(2);
  });
});

// ── exists ───────────────────────────────────────────────────────────────

describe("QueryBuilder — exists()", () => {
  it("returns true when matching rows exist", async () => {
    await seed({ name: "Alice" });
    expect(await qb().where("name", "Alice").exists()).toBe(true);
  });

  it("returns false when no matching rows", async () => {
    expect(await qb().where("name", "Nobody").exists()).toBe(false);
  });
});

// ── update ───────────────────────────────────────────────────────────────

describe("QueryBuilder — update()", () => {
  it("modifies matching rows", async () => {
    await seed({ name: "Alice", active: 1 }, { name: "Bob", active: 1 });
    await qb().where("name", "Alice").update({ active: 0 });
    const alice = await qb().where("name", "Alice").first<UserRow>();
    expect(alice?.active).toBe(0);
    // Bob unchanged
    const bob = await qb().where("name", "Bob").first<UserRow>();
    expect(bob?.active).toBe(1);
  });
});

// ── delete ───────────────────────────────────────────────────────────────

describe("QueryBuilder — delete()", () => {
  it("removes matching rows", async () => {
    await seed({ name: "Alice" }, { name: "Bob" });
    await qb().where("name", "Alice").delete();
    expect(await qb().count()).toBe(1);
    expect((await qb().first<UserRow>())?.name).toBe("Bob");
  });
});

// ── increment / decrement ─────────────────────────────────────────────────

describe("QueryBuilder — increment() / decrement()", () => {
  it("increment() increases the column value", async () => {
    await seed({ name: "Alice", score: 10 });
    await qb().where("name", "Alice").increment("score", 5);
    const row = await qb().where("name", "Alice").first<UserRow>();
    expect(row?.score).toBe(15);
  });

  it("decrement() decreases the column value", async () => {
    await seed({ name: "Alice", score: 10 });
    await qb().where("name", "Alice").decrement("score", 3);
    const row = await qb().where("name", "Alice").first<UserRow>();
    expect(row?.score).toBe(7);
  });

  it("increment() defaults to 1", async () => {
    await seed({ name: "Alice", score: 5 });
    await qb().where("name", "Alice").increment("score");
    const row = await qb().where("name", "Alice").first<UserRow>();
    expect(row?.score).toBe(6);
  });
});

// ── select ───────────────────────────────────────────────────────────────

describe("QueryBuilder — select()", () => {
  it("limits the columns returned", async () => {
    await seed({ name: "Alice", score: 42 });
    const rows = await qb().select("name").get<{ name: string }>();
    expect(rows[0]!.name).toBe("Alice");
    // score column was not selected — should not appear
    expect(Object.keys(rows[0]!)).toEqual(["name"]);
  });
});

// ── when ─────────────────────────────────────────────────────────────────

describe("QueryBuilder — when()", () => {
  it("skips the callback when condition is falsy", async () => {
    await seed({ name: "Alice", active: 1 }, { name: "Bob", active: 0 });
    const rows = await qb()
      .when(null, (q) => q.where("active", 1))
      .get<UserRow>();
    expect(rows).toHaveLength(2); // both rows returned — filter was skipped
  });

  it("applies the callback when condition is truthy", async () => {
    await seed({ name: "Alice", active: 1 }, { name: "Bob", active: 0 });
    const filter = 1;
    const rows = await qb()
      .when(filter, (q, v) => q.where("active", v as number))
      .get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Alice");
  });
});

// ── paginate ──────────────────────────────────────────────────────────────────

describe("QueryBuilder — paginate()", () => {
  it("returns correct data, total, page, perPage, lastPage", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" });
    const result = await qb().orderBy("id").paginate(2, 2);

    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(2);
    expect(result.lastPage).toBe(3);
    expect(result.data).toHaveLength(2);
    expect((result.data[0] as unknown as unknown as UserRow).name).toBe("C");
    expect((result.data[1] as unknown as unknown as UserRow).name).toBe("D");
  });

  it("returns page 1 with defaults when no options passed", async () => {
    for (let i = 0; i < 3; i++) await seed({ name: `Row${i}` });
    const result = await qb().paginate(15, 1);

    expect(result.page).toBe(1);
    expect(result.perPage).toBe(15);
    expect(result.total).toBe(3);
    expect(result.lastPage).toBe(1);
    expect(result.data).toHaveLength(3);
  });

  it("returns empty data and correct total when page exceeds lastPage", async () => {
    await seed({ name: "Only" });
    const result = await qb().paginate(10, 99);

    expect(result.total).toBe(1);
    expect(result.lastPage).toBe(1);
    expect(result.data).toHaveLength(0);
  });

  it("lastPage is at least 1 even with zero rows", async () => {
    const result = await qb().paginate(10, 1);
    expect(result.lastPage).toBe(1);
    expect(result.total).toBe(0);
  });

  it("respects existing where clauses", async () => {
    await seed(
      { name: "Active1", active: 1 },
      { name: "Active2", active: 1 },
      { name: "Inactive", active: 0 },
    );
    const result = await qb().where("active", 1).paginate(10, 1);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });
});

// ── cursorPaginate ────────────────────────────────────────────────────────────

describe("QueryBuilder — cursorPaginate()", () => {
  it("returns first page with nextCursor pointing to last item id", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    const result = await qb().cursorPaginate({ limit: 2 });

    expect(result.data).toHaveLength(2);
    expect((result.data[0] as unknown as unknown as UserRow).name).toBe("A");
    expect((result.data[1] as unknown as unknown as UserRow).name).toBe("B");
    expect(result.nextCursor).toBeGreaterThan(0);
  });

  it("returns null nextCursor on the last page", async () => {
    await seed({ name: "A" }, { name: "B" });
    const result = await qb().cursorPaginate({ limit: 10 });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("advances to the next page using the cursor", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" });
    const page1 = await qb().cursorPaginate({ limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await qb().cursorPaginate({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.data).toHaveLength(2);
    expect((page2.data[0] as unknown as unknown as UserRow).name).toBe("C");
    expect((page2.data[1] as unknown as unknown as UserRow).name).toBe("D");
    expect(page2.nextCursor).toBeNull();
  });

  it("returns empty data with null cursor for empty table", async () => {
    const result = await qb().cursorPaginate({ limit: 5 });
    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });
});

// ── keysetPaginate ────────────────────────────────────────────────────────────

describe("QueryBuilder — keysetPaginate()", () => {
  it("returns first page with an opaque string cursor", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    const result = await qb().keysetPaginate({ limit: 2 });

    expect(result.data).toHaveLength(2);
    expect((result.data[0] as unknown as UserRow).name).toBe("A");
    expect((result.data[1] as unknown as UserRow).name).toBe("B");
    expect(typeof result.nextCursor).toBe("string");
  });

  it("cursor is opaque base64 (not a raw id)", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" });
    const { nextCursor } = await qb().keysetPaginate({ limit: 2 });

    // Must be valid base64 that decodes to JSON — not a plain number
    expect(nextCursor).not.toMatch(/^\d+$/);
    const decoded = JSON.parse(atob(nextCursor!));
    expect(decoded).toHaveProperty("col", "id");
    expect(decoded).toHaveProperty("val");
  });

  it("advances to the next page using the opaque cursor", async () => {
    await seed({ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" });
    const page1 = await qb().keysetPaginate({ limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await qb().keysetPaginate({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.data).toHaveLength(2);
    expect((page2.data[0] as unknown as UserRow).name).toBe("C");
    expect((page2.data[1] as unknown as UserRow).name).toBe("D");
    expect(page2.nextCursor).toBeNull();
  });

  it("returns null nextCursor on the final page", async () => {
    await seed({ name: "A" }, { name: "B" });
    const result = await qb().keysetPaginate({ limit: 10 });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("returns empty data with null cursor for an empty table", async () => {
    const result = await qb().keysetPaginate({ limit: 5 });
    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("paginates in descending order", async () => {
    await seed({ name: "A", score: 10 }, { name: "B", score: 20 }, { name: "C", score: 30 });
    const page1 = await qb().keysetPaginate({ column: "score", direction: "desc", limit: 2 });

    expect((page1.data[0] as unknown as UserRow).name).toBe("C"); // highest score first
    expect((page1.data[1] as unknown as UserRow).name).toBe("B");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await qb().keysetPaginate({
      column: "score",
      direction: "desc",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect((page2.data[0] as unknown as UserRow).name).toBe("A");
    expect(page2.nextCursor).toBeNull();
  });

  it("paginates by a non-id column (name asc)", async () => {
    await seed({ name: "Charlie" }, { name: "Alice" }, { name: "Bob" });
    const page1 = await qb().keysetPaginate({ column: "name", direction: "asc", limit: 2 });

    expect((page1.data[0] as unknown as UserRow).name).toBe("Alice");
    expect((page1.data[1] as unknown as UserRow).name).toBe("Bob");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await qb().keysetPaginate({
      column: "name",
      direction: "asc",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect((page2.data[0] as unknown as UserRow).name).toBe("Charlie");
    expect(page2.nextCursor).toBeNull();
  });

  it("cursor encodes the sort column value for non-id columns", async () => {
    await seed({ name: "A", score: 10 }, { name: "B", score: 20 }, { name: "C", score: 30 });
    const { nextCursor } = await qb().keysetPaginate({ column: "score", limit: 2 });

    const decoded = JSON.parse(atob(nextCursor!));
    expect(decoded).toHaveProperty("col", "score");
    expect(decoded).toHaveProperty("val", 20);
    expect(decoded).toHaveProperty("id"); // tiebreaker stored
  });

  it("throws for an unsafe column name", async () => {
    await expect(qb().keysetPaginate({ column: "name; DROP TABLE users--" })).rejects.toThrow(
      "unsafe column name",
    );
  });

  it("three pages of data with consistent ordering", async () => {
    for (let i = 1; i <= 6; i++) await seed({ name: `User${i}` });

    const p1 = await qb().keysetPaginate({ limit: 2 });
    const p2 = await qb().keysetPaginate({ limit: 2, cursor: p1.nextCursor! });
    const p3 = await qb().keysetPaginate({ limit: 2, cursor: p2.nextCursor! });

    const all = [...p1.data, ...p2.data, ...p3.data] as unknown as UserRow[];
    expect(all).toHaveLength(6);
    expect(p3.nextCursor).toBeNull();

    const names = all.map((r) => r.name);
    expect(names).toEqual([...names].sort()); // ascending by name (then id)
  });
});

// ── Aggregate methods ──────────────────────────────────────────────────────────

describe("QueryBuilder aggregate methods", () => {
  beforeEach(async () => {
    await db`DELETE FROM users`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('A', null, 1, 10)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('B', null, 1, 20)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('C', null, 0, 30)`;
  });

  it("sum() returns sum of a column", async () => {
    expect(await qb().sum("score")).toBe(60);
  });

  it("avg() returns average of a column", async () => {
    expect(await qb().avg("score")).toBe(20);
  });

  it("min() returns minimum value", async () => {
    expect(await qb().min("score")).toBe(10);
  });

  it("max() returns maximum value", async () => {
    expect(await qb().max("score")).toBe(30);
  });

  it("sum() respects WHERE clauses", async () => {
    expect(await qb().where("active", 1).sum("score")).toBe(30);
  });

  it("sum() returns 0 for empty result", async () => {
    expect(await qb().where("active", 99).sum("score")).toBe(0);
  });

  it("whereNotIn() excludes listed values", async () => {
    const rows = await qb().whereNotIn("score", [10, 20]).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(30);
  });
});

// ── groupBy / having ───────────────────────────────────────────────────────────

describe("QueryBuilder groupBy / having", () => {
  beforeEach(async () => {
    await db`DELETE FROM users`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Alice', null, 1, 10)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Bob',   null, 1, 20)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Carol', null, 0, 30)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Dave',  null, 0, 40)`;
  });

  it("groupBy() groups rows by a column", async () => {
    const rows = await qb()
      .select("active", "COUNT(*) as cnt")
      .groupBy("active")
      .get<{ active: number; cnt: number }>();
    expect(rows).toHaveLength(2);
  });

  it("having() filters groups", async () => {
    const rows = await qb()
      .select("active", "SUM(score) as total")
      .groupBy("active")
      .having("SUM(score)", ">", 50)
      .get<{ active: number; total: number }>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total).toBe(70); // Carol(30) + Dave(40)
  });

  it("orderByDesc() orders descending", async () => {
    const rows = await qb().orderByDesc("score").get<UserRow>();
    expect(rows[0]?.score).toBe(40);
    expect(rows[rows.length - 1]?.score).toBe(10);
  });

  it("select() rejects a subquery-injection column (H1 regression)", () => {
    expect(() => qb().select("id", "(SELECT email FROM users) AS stolen")).toThrow(
      /unsafe select expression/,
    );
    // pluck()/value() route through the same guard.
    expect(() => qb().pluck("(SELECT email FROM users)")).toThrow(/unsafe select expression/);
    expect(() => qb().value("id) UNION SELECT email FROM users --")).toThrow(
      /unsafe select expression/,
    );
  });

  it("select() still accepts columns, table.*, and simple aggregates", () => {
    expect(() =>
      qb().select("name", "users.*", "COUNT(*) as cnt", "SUM(score) total"),
    ).not.toThrow();
  });

  it("where(col, null) compiles to IS NULL, not = NULL (M11 regression)", () => {
    const { sql } = qb().where("email", null).toSqlWithBindings();
    expect(sql.toLowerCase()).toContain("is null");
    expect(sql).not.toContain("= ?");
  });

  it("where(col, '!=', null) compiles to IS NOT NULL", () => {
    const { sql } = qb().where("email", "!=", null).toSqlWithBindings();
    expect(sql.toLowerCase()).toContain("is not null");
  });
});

// ── Raw SQL methods ────────────────────────────────────────────────────────────

describe("QueryBuilder raw SQL methods", () => {
  beforeEach(async () => {
    await db`DELETE FROM users`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Alice', 'a@example.com', 1, 50)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Bob',   'b@example.com', 0, 30)`;
    await db`INSERT INTO users (name, email, active, score) VALUES ('Carol', 'c@example.com', 1, 70)`;
  });

  it("selectRaw() includes a raw expression in SELECT", async () => {
    const rows = await qb()
      .selectRaw("name, score * 2 as double_score")
      .get<{ name: string; double_score: number }>();
    expect(rows[0]?.double_score).toBe(100);
  });

  it("whereRaw() filters with a raw SQL condition", async () => {
    const rows = await qb().whereRaw("score > ?", [40]).get<UserRow>();
    expect(rows.map((r) => r.name).sort()).toEqual(["Alice", "Carol"]);
  });

  it("whereRaw() supports multiple bindings", async () => {
    const rows = await qb().whereRaw("score BETWEEN ? AND ?", [40, 60]).get<UserRow>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Alice");
  });

  it("whereRaw() with no bindings", async () => {
    const rows = await qb().whereRaw("active = 1").get<UserRow>();
    expect(rows).toHaveLength(2);
  });

  it("orderByRaw() applies raw ordering", async () => {
    const rows = await qb().orderByRaw("score DESC").get<UserRow>();
    expect(rows[0]?.name).toBe("Carol");
    expect(rows[rows.length - 1]?.name).toBe("Bob");
  });
});
