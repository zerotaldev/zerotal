/**
 * Ledger F1: on SQLite, one request's transaction must not take in another request's statements.
 *
 * Bun keeps one SQLite connection, and before this change a transaction left open by one request
 * swallowed every other request's writes: they reported success and vanished on rollback. A
 * second transaction either joined the first (Bun 1.4) or failed with `cannot start a
 * transaction within a transaction` (Bun 1.3).
 *
 * Every test runs against a real SQLite file through the wrapper the provider installs, with two
 * requests modelled as two `RequestContext`s.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpContext, RequestContext } from "@zerotal/core";
import { DB, _setDbConnection } from "./DB.ts";
import { _setBaseModelConnection } from "../model/BaseModel.ts";
import { SqliteBusyError, _holdForManualTransaction, _sqliteExclusive } from "./sqliteExclusive.ts";
import type { SQLInstance } from "./sql-types.ts";

let dir: string;
let raw: SQLInstance;
let db: SQLInstance;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asRequest = <T>(fn: () => Promise<T>): Promise<T> =>
  RequestContext.run(HttpContext.fake("http://localhost/"), fn);
const names = async (): Promise<string[]> =>
  ((await raw`SELECT who FROM f1 ORDER BY id`) as Array<{ who: string }>).map((row) => row.who);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "zt-sqlite-exclusive-"));
  raw = new SQL(`sqlite://${join(dir, "f1.sqlite")}`) as unknown as SQLInstance;
  db = _sqliteExclusive(raw, { busyTimeoutMs: 1000 });
  await db`CREATE TABLE f1 (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT)`;
});

afterAll(async () => {
  await raw.end();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await raw`DELETE FROM f1`;
});

afterEach(() => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
});

describe("a DB.transaction() on SQLite", () => {
  it("does not take another request's write down with it when it rolls back", async () => {
    const a = asRequest(() =>
      DB.transaction(async () => {
        await DB.table("f1").insert({ who: "A" });
        await sleep(100);
        throw new Error("A rolls back");
      }),
    ).catch(() => "rolled back");
    await sleep(20);
    const b = asRequest(() => DB.table("f1").insert({ who: "B" }));

    expect(await a).toBe("rolled back");
    await b;
    expect(await names()).toEqual(["B"]);
  });

  it("makes a second request's transaction wait its turn instead of failing or joining", async () => {
    const order: string[] = [];
    const a = asRequest(() =>
      DB.transaction(async () => {
        await DB.table("f1").insert({ who: "A" });
        await sleep(50);
        order.push("A done");
      }),
    );
    await sleep(10);
    const c = asRequest(() =>
      DB.transaction(async () => {
        order.push("C starts");
        await DB.table("f1").insert({ who: "C" });
      }),
    );

    await Promise.all([a, c]);
    expect(order).toEqual(["A done", "C starts"]);
    expect(await names()).toEqual(["A", "C"]);
  });

  it("runs transactions in the order they arrived", async () => {
    const started: string[] = [];
    const run = (who: string) =>
      asRequest(() =>
        DB.transaction(async () => {
          started.push(who);
          await sleep(10);
          await DB.table("f1").insert({ who });
        }),
      );
    await Promise.all([run("1"), run("2"), run("3")]);
    expect(started).toEqual(["1", "2", "3"]);
    expect(await names()).toEqual(["1", "2", "3"]);
  });

  it("lets its own statements through, including ones sent to the connection directly", async () => {
    await asRequest(() =>
      DB.transaction(async () => {
        await DB.table("f1").insert({ who: "builder" });
        // Code that holds the app's connection rather than the transaction's, such as a
        // driver resolved from the container.
        await db`INSERT INTO f1 (who) VALUES ('direct')`;
      }),
    );
    expect(await names()).toEqual(["builder", "direct"]);
  });

  it("fails a statement with `database is locked` rather than waiting forever", async () => {
    const a = asRequest(() =>
      DB.transaction(async () => {
        await DB.table("f1").insert({ who: "A" });
        await sleep(1500);
      }),
    );
    await sleep(20);
    const b = asRequest(() => DB.table("f1").insert({ who: "B" }));
    const error = await b.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SqliteBusyError);
    expect((error as Error).message).toContain("database is locked");
    await a;
    expect(await names()).toEqual(["A"]);
  });

  it("turns a transaction that awaits another request's statement into an error, not a hang", async () => {
    const outside = asRequest(async () => {
      await sleep(30);
      return DB.table("f1").insert({ who: "outside" });
    });
    const a = asRequest(() =>
      DB.transaction(async () => {
        await DB.table("f1").insert({ who: "A" });
        await outside; // waits for the transaction that is waiting for it
      }),
    );
    expect(await a.catch((e: unknown) => e)).toBeInstanceOf(SqliteBusyError);
  });
});

describe("a DB.beginTransaction() on SQLite", () => {
  it("belongs to the request that began it, models and all", async () => {
    await asRequest(async () => {
      const t = await DB.beginTransaction();
      // Not through the handle: the connection the models use.
      await DB.table("f1").insert({ who: "same request" });
      await t.rollback();
    });
    expect(await names()).toEqual([]);
  });

  it("keeps other requests out until it commits", async () => {
    let commit!: () => Promise<void>;
    const began = asRequest(async () => {
      const t = await DB.beginTransaction();
      await t.table("f1").insert({ who: "manual" });
      commit = t.commit;
    });
    await began;
    const other = asRequest(() => DB.table("f1").insert({ who: "other" }));
    await sleep(30);
    expect(await names()).toEqual(["manual"]);
    await asRequest(() => commit());
    await other;
    expect(await names()).toEqual(["manual", "other"]);
  });

  it("outside a request, shares the connection as before rather than deadlocking", async () => {
    const t = await DB.beginTransaction();
    await DB.table("f1").insert({ who: "console" });
    await t.commit();
    expect(await names()).toEqual(["console"]);
  });

  it("is a no-op hold on a connection that is not wrapped", async () => {
    const release = await _holdForManualTransaction(raw);
    release();
  });
});
