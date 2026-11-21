import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { BaseModel, DB, _setDbConnection, _sqliteExclusive, column, table } from "@zerotal/orm";
import type { SQLInstance } from "@zerotal/orm";
import { refreshDatabase } from "./refreshDatabase.ts";

// The app's connection, wrapped as DatabaseProvider wraps SQLite's.
const raw = new SQL(":memory:") as unknown as SQLInstance;
const db = _sqliteExclusive(raw, { busyTimeoutMs: 1000 });

@table("ledger_rows", { timestamps: false })
class LedgerRow extends BaseModel {
  @column({ type: "string" }) label!: string;
}

beforeAll(() => _setDbConnection(db));
afterAll(() => _setDbConnection(null));

describe("DB.transaction() inside a refreshDatabase() test", () => {
  refreshDatabase({
    connection: db,
    setup: (c) => c`CREATE TABLE ledger_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)`,
  });

  it("commits into the test's transaction", async () => {
    await DB.transaction(async () => {
      await LedgerRow.create({ label: "inside" });
    });
    expect((await LedgerRow.all()).map((r) => r.label)).toEqual(["inside"]);
  });

  it("rolls back on a throw, leaving the test's own rows", async () => {
    await LedgerRow.create({ label: "before" });
    await expect(
      DB.transaction(async () => {
        await LedgerRow.create({ label: "doomed" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await LedgerRow.all()).map((r) => r.label)).toEqual(["before"]);
  });

  it("runs DB.table() inside the test's transaction, so it rolls back too", async () => {
    await DB.table("ledger_rows").insert({ label: "through DB" });
    expect((await LedgerRow.all()).map((r) => r.label)).toEqual(["through DB"]);
  });

  it("starts clean: the previous tests rolled back", async () => {
    expect(await LedgerRow.all()).toHaveLength(0);
  });
});
