import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection, BaseModel } from "../model/BaseModel.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";

let db: SQLInstance;
beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await db`CREATE TABLE tx_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
});
afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM tx_users`;
  await db`DELETE FROM sqlite_sequence`;
});

@table("tx_users", { timestamps: false })
class TxUser extends BaseModel {
  @column() name!: string;
}

describe("manual transactions", () => {
  it("commit persists", async () => {
    const t = await DB.beginTransaction();
    await t.table("tx_users").insert({ name: "manual" });
    await t.commit();
    expect(await DB.table("tx_users").where("name", "manual").first()).not.toBeNull();
  });
  it("rollback discards", async () => {
    const t = await DB.beginTransaction();
    await t.table("tx_users").insert({ name: "gone" });
    await t.rollback();
    expect(await DB.table("tx_users").where("name", "gone").first()).toBeNull();
  });
});

describe("savepoints (nested transactions)", () => {
  it("inner rollback keeps outer rows", async () => {
    await DB.transaction(async () => {
      await TxUser.create({ name: "outer" } as never);
      try {
        await DB.transaction(async () => {
          await TxUser.create({ name: "inner" } as never);
          throw new Error("rollback inner");
        });
      } catch {
        /* swallow */
      }
    });
    const names = (await TxUser.query().get()).map((u: any) => u.name);
    expect(names).toContain("outer");
    expect(names).not.toContain("inner");
  });
});

describe("deadlock retry", () => {
  it("retries on a deadlock-like error then succeeds", async () => {
    let tries = 0;
    const result = await DB.transaction(async () => {
      tries++;
      if (tries < 2) throw new Error("deadlock detected, retry");
      return "ok";
    }, 3);
    expect(result).toBe("ok");
    expect(tries).toBe(2);
  });
  it("does not retry on a non-deadlock error", async () => {
    let tries = 0;
    await expect(
      DB.transaction(async () => {
        tries++;
        throw new Error("validation failed");
      }, 3),
    ).rejects.toThrow("validation failed");
    expect(tries).toBe(1);
  });
});

describe("prunable", () => {
  it("prune() deletes matching records in chunks", async () => {
    @table("tx_users", { timestamps: false })
    class PrunableUser extends BaseModel {
      static override massPrune = true;
      @column() name!: string;
      static override prunable() {
        return this.query().where("name", "like", "old%");
      }
    }
    await PrunableUser.create({ name: "old-1" } as never);
    await PrunableUser.create({ name: "old-2" } as never);
    await PrunableUser.create({ name: "keep" } as never);
    const pruned = await PrunableUser.prune(1);
    expect(pruned).toBe(2);
    expect((await PrunableUser.query().get()).map((u: any) => u.name)).toEqual(["keep"]);
  });
});
