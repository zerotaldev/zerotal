/**
 * `@table(...)` without `.withTimestamps()` still manages timestamps — the default is on,
 * matching the convention, so the decorator's most obvious form writes `created_at` and
 * `updated_at` whether or not the table has them:
 *
 *     table payment_plan_ledger has no column named updated_at
 *
 * The opt-out is `.withoutTimestamps()`, which exists but appears nowhere in the ORM guide
 * — the only documented `withoutTimestamps` is `BaseModel.withoutTimestamps(callback)`, a
 * different feature that scopes a single write. These pin the decorator form so the
 * append-only case stays expressible.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection, _setBaseModelConnection } from "../index.ts";

// Append-only: a row is written once and never updated, so an `updated_at` on it is a lie.
// The parentheses are required — decorator grammar allows a call at the end of the chain,
// not in the middle, so the bare `@table("ledger").withoutTimestamps()` does not parse.
@(table("ledger").withoutTimestamps())
class LedgerEntry extends BaseModel {
  @column() memo!: string;
  @column({ type: "number", cast: "integer" }) cents!: number;
}

@table("notes")
class Note extends BaseModel {
  @column() body!: string;
}

beforeAll(async () => {
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  _setBaseModelConnection(conn as never);
  // Deliberately no created_at / updated_at: the table is exactly what the model declares.
  await DB.raw(`CREATE TABLE ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, memo TEXT, cents INTEGER)`);
  await DB.raw(`CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, created_at TEXT, updated_at TEXT)`);
});

describe("@table().withoutTimestamps()", () => {
  it("saves to a table that has no timestamp columns", async () => {
    const entry = new LedgerEntry();
    entry.memo = "deposit";
    entry.cents = 25_000;

    await entry.save();

    const [row] = await DB.raw<{ memo: string; cents: number }>("SELECT * FROM ledger");
    expect(row!.memo).toBe("deposit");
    expect(row!.cents).toBe(25_000);
  });

  it("turns the class flag off, which is what the write path reads", () => {
    expect(LedgerEntry.timestamps).toBe(false);
  });

  it("leaves timestamps on by default, so existing models are unaffected", async () => {
    expect(Note.timestamps).toBe(true);

    const note = new Note();
    note.body = "hello";
    await note.save();

    const [row] = await DB.raw<{ created_at: string | null }>("SELECT * FROM notes");
    expect(row!.created_at).not.toBeNull();
  });
});
