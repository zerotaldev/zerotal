import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { ModelNotFoundError } from "../errors/index.ts";

let db: SQLInstance;

@table("docs", { timestamps: false })
class Doc extends BaseModel {
  @column({ type: "string" }) title!: string;
}

@table("people")
class Person extends BaseModel {
  @column({ type: "string" }) name!: string;
  @column({ type: "boolean" }) active!: boolean;
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL)`;
  await db`CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER, created_at TEXT, updated_at TEXT)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM docs`;
  await db`DELETE FROM people`;
});

describe("string primary keys", () => {
  beforeEach(async () => {
    await db`INSERT INTO docs (id, title) VALUES ('a1b2', 'Hello'), ('c3d4', 'World')`;
  });
  it("find() resolves a string id", async () => {
    const doc = await Doc.find("a1b2");
    expect(doc?.title).toBe("Hello");
  });
  it("findOrFail() throws ModelNotFoundError for a missing string id", async () => {
    await expect(Doc.findOrFail("nope")).rejects.toBeInstanceOf(ModelNotFoundError);
  });
  it("findMany() resolves multiple string ids", async () => {
    const docs = await Doc.findMany(["a1b2", "c3d4"]);
    expect(docs.map((d) => d.title).sort()).toEqual(["Hello", "World"]);
  });
  it("findOrNew() returns a new instance for an unknown string id", async () => {
    const doc = await Doc.findOrNew("missing");
    expect(doc).toBeInstanceOf(Doc);
    expect((doc as unknown as { id?: string }).id).toBeUndefined();
  });
});

describe("bulkInsert()", () => {
  it("inserts many rows in a single statement and returns the count", async () => {
    const n = await Person.bulkInsert([
      { name: "Ann", active: true },
      { name: "Bob", active: false },
      { name: "Cy", active: true },
    ]);
    expect(n).toBe(3);
    const rows = await Person.all();
    expect(rows).toHaveLength(3);
  });
  it("applies casts (boolean → 0/1)", async () => {
    await Person.bulkInsert([
      { name: "Ann", active: true },
      { name: "Bob", active: false },
    ]);
    const raw = await db`SELECT name, active FROM people ORDER BY name`;
    expect(raw[0]).toMatchObject({ name: "Ann", active: 1 });
    expect(raw[1]).toMatchObject({ name: "Bob", active: 0 });
  });
  it("fills timestamps when enabled", async () => {
    await Person.bulkInsert([{ name: "Ann", active: true }]);
    const [row] = await db`SELECT created_at, updated_at FROM people`;
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });
  it("returns 0 for an empty array (no query)", async () => {
    expect(await Person.bulkInsert([])).toBe(0);
  });
  it("handles rows with differing columns (union, missing → NULL)", async () => {
    const n = await Person.bulkInsert([{ name: "A", active: true }, { name: "B" } as never]);
    expect(n).toBe(2);
    const [b] = await db`SELECT active FROM people WHERE name = 'B'`;
    expect(b.active).toBeNull();
  });
});
