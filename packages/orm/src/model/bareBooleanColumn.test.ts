/**
 * A boolean written to a column declared to hold text.
 *
 * Reported from production: a feature flag read as enabled for every record that
 * had it turned off, with nothing in the app or the database registering a fault.
 * The cause is that a bare `@column()` resolves to `{ type: "string" }` — the right
 * default for the common case, and the one storage type that makes a stored `false`
 * come back truthy, because SQLite gives a text column text affinity and `"0"` is
 * truthy in JavaScript.
 *
 * There is no correct coercion, which is why the write is refused. `0` becomes
 * `"0"`; `"false"` is truthy too. The value cannot survive the round trip.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { ColumnTypeError } from "../errors/index.ts";
import type { SQLInstance } from "../db/sql-types.ts";

let db: SQLInstance;
beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bare TEXT, explicit_text TEXT, typed INTEGER, cast_flag TEXT,
    created_at TEXT, updated_at TEXT
  )`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM widgets`;
});

@table("widgets")
class Widget extends BaseModel {
  declare id: number;

  /** No argument — resolves to `string`. The reported shape. */
  @column()
  bare!: boolean;

  /** The same mistake, spelled out. */
  @column("string")
  explicitText!: boolean;

  /** The fix. */
  @column("boolean")
  typed!: boolean;

  /** A cast says what was meant, so it is honoured rather than refused. */
  @column({ type: "string", cast: "boolean" })
  castFlag!: boolean;
}

describe("a boolean in a text column", () => {
  it("refuses the write rather than storing a truthy false", async () => {
    const w = new Widget();
    w.bare = false;

    await expect(w.save()).rejects.toThrow(ColumnTypeError);
  });

  it("refuses `true` as readily as `false`", async () => {
    // Not a check for falsiness — the column is the wrong shape either way, and
    // only refusing `false` would let the bug back in the moment a flag is on.
    const w = new Widget();
    w.bare = true;

    await expect(w.save()).rejects.toThrow(ColumnTypeError);
  });

  it("names the property and the fix", async () => {
    const w = new Widget();
    w.bare = false;

    await expect(w.save()).rejects.toThrow(/Widget\.bare/);
    await expect(w.save()).rejects.toThrow(/@column\("boolean"\)/);
    // The sentence that explains why it is refused rather than coerced.
    await expect(w.save()).rejects.toThrow(/truthy/);
  });

  it("refuses an explicit string column too", async () => {
    // `@column("string")` on a boolean is the same bug written out longhand.
    const w = new Widget();
    w.explicitText = false;

    await expect(w.save()).rejects.toThrow(ColumnTypeError);
  });
});

describe("what still works", () => {
  it("round-trips a typed boolean column", async () => {
    const w = new Widget();
    w.typed = false;
    await w.save();

    const found = (await Widget.find(w.id)) as Widget;
    expect(found.typed).toBe(false);
    expect(Boolean(found.typed)).toBe(false);
  });

  it("round-trips `true` on a typed column", async () => {
    const w = new Widget();
    w.typed = true;
    await w.save();

    expect(((await Widget.find(w.id)) as Widget).typed).toBe(true);
  });

  it("honours an explicit cast on a string column", async () => {
    // A declared `cast: "boolean"` is someone saying what they meant. The guard is
    // for the column that says nothing, not for every string column in existence.
    const w = new Widget();
    w.castFlag = false;
    await w.save();

    const found = (await Widget.find(w.id)) as Widget;
    expect(found.castFlag).toBe(false);
  });

  it("leaves strings on a string column alone", async () => {
    const w = new Widget();
    (w as unknown as Record<string, unknown>)["bare"] = "false";
    await w.save();

    const found = (await Widget.find(w.id)) as Widget;
    expect(found.bare as unknown).toBe("false");
  });

  it("leaves null alone", async () => {
    const w = new Widget();
    (w as unknown as Record<string, unknown>)["bare"] = null;
    await expect(w.save()).resolves.toBeDefined();
  });
});
