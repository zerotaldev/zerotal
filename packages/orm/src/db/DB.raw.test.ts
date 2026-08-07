import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection } from "../model/BaseModel.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await db`CREATE TABLE raw_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM raw_items`;
});

// ── Tagged-template (existing behaviour) ──────────────────────────────────────

describe("DB.raw — tagged template (existing)", () => {
  it("executes a simple query and returns rows", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Alice', 10)`;
    const rows = await DB.raw<{ name: string }>`SELECT name FROM raw_items`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Alice");
  });

  it("parameterises values safely", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Bob', 20)`;
    const score = 20;
    const rows = await DB.raw<{ name: string }>`SELECT name FROM raw_items WHERE score = ${score}`;
    expect(rows[0]?.name).toBe("Bob");
  });
});

// ── String form (new) ─────────────────────────────────────────────────────────

describe("DB.raw — string form", () => {
  it("executes a no-placeholder query", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Charlie', 5)`;
    const rows = await DB.raw<{ name: string }>("SELECT name FROM raw_items");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Charlie");
  });

  it("substitutes ? placeholders from a bindings array", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Diana', 30)`;
    await db`INSERT INTO raw_items (name, score) VALUES ('Eve', 50)`;
    const rows = await DB.raw<{ name: string; score: number }>(
      "SELECT name, score FROM raw_items WHERE score > ? ORDER BY score ASC",
      [25],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Diana");
    expect(rows[1]?.name).toBe("Eve");
  });

  it("handles multiple ? placeholders", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Frank', 15)`;
    await db`INSERT INTO raw_items (name, score) VALUES ('Grace', 40)`;
    const rows = await DB.raw<{ name: string }>(
      "SELECT name FROM raw_items WHERE score >= ? AND score <= ?",
      [10, 20],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Frank");
  });

  it("returns an empty array when no rows match", async () => {
    const rows = await DB.raw("SELECT * FROM raw_items WHERE score > ?", [9999]);
    expect(rows).toHaveLength(0);
  });

  it("accepts rest-style bindings (without wrapping array)", async () => {
    await db`INSERT INTO raw_items (name, score) VALUES ('Hank', 7)`;
    const rows = await DB.raw<{ name: string }>("SELECT name FROM raw_items WHERE score = ?", 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Hank");
  });
});
