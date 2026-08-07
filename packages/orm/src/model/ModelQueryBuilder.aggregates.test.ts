import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";

// Regression: every column-taking query-builder method takes a model *property* name
// (camelCase) just like where()/orderBy(), and must resolve it to the snake_case column.
// Before the fix, e.g. `.sum('amountCents')` generated `SUM(amountCents)` and SQLite raised
// "no such column: amountCents" because the real column is `amount_cents`.

let db: SQLInstance;
beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE postings (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, amount_cents INTEGER, note_text TEXT, created_at TEXT, updated_at TEXT)`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM postings`;
  await db`DELETE FROM sqlite_sequence`;
  await Posting.create({ accountId: 1, amountCents: 100, noteText: "a" } as never);
  await Posting.create({ accountId: 1, amountCents: 250, noteText: null } as never);
  await Posting.create({ accountId: 2, amountCents: -40, noteText: "c" } as never);
});

@table("postings")
class Posting extends BaseModel {
  static override fillable = ["accountId", "amountCents", "noteText"];
  @column("integer") accountId!: number;
  @column("integer") amountCents!: number;
  @column({ nullable: true }) noteText?: string | null;
}

describe("ModelQueryBuilder aggregates resolve camelCase columns to snake_case", () => {
  it("sum() converts the column name", async () => {
    expect(await Posting.query().sum("amountCents")).toBe(310);
  });

  it("sum() works alongside a where() on the same camelCase column", async () => {
    expect(await Posting.query().where("amountCents", ">", 0).sum("amountCents")).toBe(350);
  });

  it("min()/max() convert the column name", async () => {
    expect(await Posting.query().min("amountCents")).toBe(-40);
    expect(await Posting.query().max("amountCents")).toBe(250);
  });
});

describe("ModelQueryBuilder filters/grouping resolve camelCase columns to snake_case", () => {
  it("whereNull()/whereNotNull() convert the column name", async () => {
    expect(await Posting.query().whereNull("noteText").count()).toBe(1);
    expect(await Posting.query().whereNotNull("noteText").count()).toBe(2);
  });

  it("whereBetween() converts the column name", async () => {
    expect(await Posting.query().whereBetween("amountCents", [0, 200]).count()).toBe(1);
  });

  it("whereColumn() converts both columns", async () => {
    // amount_cents > account_id → rows (100>1, 250>1) match; (-40>2) does not.
    expect(await Posting.query().whereColumn("amountCents", ">", "accountId").count()).toBe(2);
  });

  it("select() converts the column name and still hydrates", async () => {
    const rows = await Posting.query().where("accountId", 2).select("amountCents").get();
    expect(rows[0]!.amountCents).toBe(-40);
  });

  it("groupBy()/having() convert the column name", async () => {
    const grouped = await Posting.query().groupBy("accountId").get();
    expect(grouped).toHaveLength(2); // one row per account_id
    const filtered = await Posting.query().groupBy("accountId").having("accountId", ">", 1).get();
    expect(filtered).toHaveLength(1); // only account_id = 2
  });
});
