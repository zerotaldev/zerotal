/**
 * A declared column that was never assigned used to be written as an explicit NULL.
 *
 * That made `@column({ default: … })` inert on insert: because the INSERT named the
 * column, the database never got the chance to apply its own default, and a NOT NULL
 * column failed outright — `NOT NULL constraint failed: quote_versions.total_cost` on
 * a model and migration that both declared `default: 0`. It bites hardest on exactly
 * the models where defaults are most natural: rows with derived columns filled in by a
 * later pass.
 *
 * The rule now: `undefined` means "I didn't say" — use the declared default, or omit
 * the column so the database decides. `null` still means "store NULL".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection, _setBaseModelConnection } from "../index.ts";

@table("quote_versions")
class QuoteVersion extends BaseModel {
  @column() label!: string;
  @column({ type: "number", cast: "integer", default: 0 }) totalCost!: number;
  @column({ type: "number", cast: "integer" }) optionalCount?: number | null;
  @column({ nullable: true }) note?: string | null;
}

beforeAll(async () => {
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  _setBaseModelConnection(conn as never);
  await DB.raw(`CREATE TABLE quote_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    total_cost INTEGER NOT NULL DEFAULT 0,
    optional_count INTEGER DEFAULT 7,
    note TEXT,
    created_at TEXT, updated_at TEXT)`);
});

describe("insert and unassigned columns", () => {
  it("applies the declared default instead of writing NULL", async () => {
    const row = new QuoteVersion();
    row.label = "declared-default";
    await row.save();

    const [got] = await DB.raw<{ total_cost: number }>(
      "SELECT total_cost FROM quote_versions WHERE label = 'declared-default'",
    );
    expect(got!.total_cost).toBe(0);
  });

  it("leaves the instance readable without a reload", async () => {
    const row = new QuoteVersion();
    row.label = "in-memory";
    await row.save();

    expect(row.totalCost).toBe(0);
  });

  it("omits an undeclared-default column so the database's default applies", async () => {
    const row = new QuoteVersion();
    row.label = "db-default";
    await row.save();

    const [got] = await DB.raw<{ optional_count: number }>(
      "SELECT optional_count FROM quote_versions WHERE label = 'db-default'",
    );
    expect(got!.optional_count).toBe(7);
  });

  it("still writes an explicit null when one was assigned", async () => {
    const row = new QuoteVersion();
    row.label = "explicit-null";
    row.note = null;
    await row.save();

    const [got] = await DB.raw<{ note: string | null }>(
      "SELECT note FROM quote_versions WHERE label = 'explicit-null'",
    );
    expect(got!.note).toBeNull();
  });

  it("does not override a value that was assigned", async () => {
    const row = new QuoteVersion();
    row.label = "assigned";
    row.totalCost = 4200;
    await row.save();

    const [got] = await DB.raw<{ total_cost: number }>(
      "SELECT total_cost FROM quote_versions WHERE label = 'assigned'",
    );
    expect(got!.total_cost).toBe(4200);
  });
});
