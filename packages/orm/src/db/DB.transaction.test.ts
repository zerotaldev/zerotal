import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection } from "../model/BaseModel.ts";
import { BaseModel } from "../model/BaseModel.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);

  await db`CREATE TABLE tx_users (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`;
});

afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM tx_users`;
});

@table("tx_users", { timestamps: false })
class TxUser extends BaseModel {
  @column({ type: "string" }) name!: string;
}

describe("DB.transaction() — TransactionContext propagation", () => {
  it("commits rows created inside the transaction", async () => {
    await DB.transaction(async () => {
      await TxUser.create({ name: "committed" } as never);
    });

    const found = await TxUser.query().where("name", "committed").first();
    expect(found?.name).toBe("committed");
  });

  it("rolls back rows when an error is thrown", async () => {
    let threw = false;
    try {
      await DB.transaction(async () => {
        await TxUser.create({ name: "will-rollback" } as never);
        throw new Error("intentional rollback");
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const found = await TxUser.query().where("name", "will-rollback").first();
    expect(found).toBeNull();
  });

  it("multiple models created inside one transaction are all committed", async () => {
    await DB.transaction(async () => {
      await TxUser.create({ name: "alice" } as never);
      await TxUser.create({ name: "bob" } as never);
    });

    const all = await TxUser.query().orderBy("name").get();
    expect(all).toHaveLength(2);
    expect(all[0]?.name).toBe("alice");
    expect(all[1]?.name).toBe("bob");
  });

  it("multiple models are all rolled back when transaction fails", async () => {
    try {
      await DB.transaction(async () => {
        await TxUser.create({ name: "p1" } as never);
        await TxUser.create({ name: "p2" } as never);
        throw new Error("abort");
      });
    } catch {
      /* expected */
    }

    const count = await TxUser.query().count();
    expect(count).toBe(0);
  });

  it("reuses parent transaction and rolls back on nested failure", async () => {
    let outerTx: SQLInstance | undefined;
    let innerTx: SQLInstance | undefined;

    try {
      await DB.transaction(async (tx) => {
        outerTx = tx;
        await TxUser.create({ name: "outer" } as never);

        await DB.transaction(async (nestedTx) => {
          innerTx = nestedTx;
          await TxUser.create({ name: "inner" } as never);
          throw new Error("nested abort");
        });
      });
    } catch {
      /* expected */
    }

    expect(outerTx).toBeDefined();
    expect(innerTx).toBe(outerTx);

    const count = await TxUser.query().count();
    expect(count).toBe(0);
  });
});

// ── DB.currentTx() ────────────────────────────────────────────────────────────

describe("DB.currentTx()", () => {
  it("returns undefined outside a transaction", () => {
    expect(DB.currentTx()).toBeUndefined();
  });

  it("returns the active transaction inside DB.transaction()", async () => {
    let captured: unknown;
    await DB.transaction(async (tx) => {
      captured = DB.currentTx();
      expect(captured).toBe(tx);
    });
    expect(DB.currentTx()).toBeUndefined();
  });
});

// ── DB.onPrimary() ─────────────────────────────────────────────────────────────

describe("DB.onPrimary()", () => {
  it("returns a table query builder scoped to the primary connection", () => {
    const q = DB.onPrimary().table("tx_users");
    expect(q).toBeDefined();
    expect(typeof q.where).toBe("function");
  });
});
