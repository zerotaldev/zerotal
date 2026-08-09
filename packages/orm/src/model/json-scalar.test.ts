/**
 * A `json` column must return the type it was given.
 *
 * Writing skipped `JSON.stringify` for values that were already strings, so a string went
 * into the column as bare characters — `62812345678`, not `"62812345678"` — and the read
 * side's `JSON.parse` turned it back into a number. For an identifier with a leading zero
 * that is destructive and silent: a bank branch code of `051001` was stored, read back as
 * `51001`, and would have been printed on a customer-facing payment page. Nothing in the
 * app or the database looked wrong.
 *
 * The intent of the old skip was to avoid double-encoding a value that was already JSON
 * text. That cannot be distinguished from a string someone means to store, and guessing
 * wrong silently changes a value's type between write and read. Encoding is now symmetric:
 * what you assign is what you read.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection, _setBaseModelConnection } from "../index.ts";

@table("app_settings")
class AppSetting extends BaseModel {
  @column() key!: string;
  @column({ type: "json", cast: "json", nullable: true }) value?: unknown;
}

beforeAll(async () => {
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  _setBaseModelConnection(conn as never);
  await DB.raw(`CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT,
    created_at TEXT, updated_at TEXT)`);
});

async function roundTrip(key: string, value: unknown): Promise<unknown> {
  const row = new AppSetting();
  row.key = key;
  row.value = value;
  await row.save();

  const back = await AppSetting.query().where("key", key).first();
  return (back as AppSetting).value;
}

describe("a json column round-trips scalars without changing their type", () => {
  it("keeps a numeric-looking string a string", async () => {
    const back = await roundTrip("account", "62812345678");

    expect(typeof back).toBe("string");
    expect(back).toBe("62812345678");
  });

  it("preserves a leading zero", async () => {
    // A South African bank branch code. Read back as 51001, this is a malformed
    // payment instruction that looks perfectly fine everywhere you would check.
    const back = await roundTrip("branch", "051001");

    expect(back).toBe("051001");
  });

  it("keeps a string that does not parse as JSON", async () => {
    expect(await roundTrip("holder", "A Ltd")).toBe("A Ltd");
  });

  it("keeps strings that look like other JSON literals", async () => {
    expect(await roundTrip("t", "true")).toBe("true");
    expect(await roundTrip("n", "null")).toBe("null");
    expect(await roundTrip("neg", "-7")).toBe("-7");
    expect(await roundTrip("float", "1.50")).toBe("1.50");
  });

  it("still round-trips real numbers and booleans as themselves", async () => {
    expect(await roundTrip("num", 42)).toBe(42);
    expect(await roundTrip("bool", true)).toBe(true);
  });

  it("still round-trips objects and arrays", async () => {
    expect(await roundTrip("obj", { a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
    expect(await roundTrip("arr", [1, "two", { three: 3 }])).toEqual([1, "two", { three: 3 }]);
  });

  it("stores a string as valid JSON, not as bare characters", async () => {
    await roundTrip("raw", "051001");
    const [row] = await DB.raw<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'raw'",
    );

    // The column holds `"051001"` — quoted — so any other JSON reader agrees.
    expect(row!.value).toBe('"051001"');
    expect(JSON.parse(row!.value)).toBe("051001");
  });

  it("round-trips null as null", async () => {
    expect(await roundTrip("empty", null)).toBeNull();
  });
});
