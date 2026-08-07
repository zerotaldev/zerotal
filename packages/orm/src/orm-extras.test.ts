/**
 * Extra tests for:
 *  - errors/TransactionError.ts
 *  - model/ReactiveProxy.ts
 *  - db/DB.ts (onPrimary, currentTx, preventNPlusOne, allowNPlusOne)
 *  - provider/DatabaseProvider.ts (_normaliseSqliteUrl helper)
 *  - commands: extended stub coverage, MigrateGenerateCommand static props
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";

// ── TransactionError ──────────────────────────────────────────────────────────

import { TransactionError } from "./errors/TransactionError.ts";

describe("TransactionError", () => {
  it("is an instance of Error", () => {
    const err = new TransactionError("tx failed");
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct message", () => {
    const err = new TransactionError("connection lost");
    expect(err.message).toBe("connection lost");
  });

  it("has code E_TRANSACTION_ERROR", () => {
    const err = new TransactionError("oops");
    expect((err as unknown as { code?: string }).code).toBe("E_TRANSACTION_ERROR");
  });

  it("has status 500", () => {
    const err = new TransactionError("oops");
    expect((err as unknown as { status?: number }).status).toBe(500);
  });
});

// ── ReactiveProxy ─────────────────────────────────────────────────────────────

import { makeReactive } from "./model/ReactiveProxy.ts";
import { BaseModel, _setBaseModelConnection } from "./model/BaseModel.ts";

// Minimal model stub for ReactiveProxy tests — uses a plain object that mimics
// the BaseModel API required by ReactiveProxy (markDirty method).
function makeFakeModel(): { dirtyKeys: string[]; markDirty(k: string): void } & InstanceType<
  typeof BaseModel
> {
  const m = {
    dirtyKeys: [] as string[],
    markDirty(key: string) {
      m.dirtyKeys.push(key);
    },
  };
  return m as unknown as { dirtyKeys: string[]; markDirty(k: string): void } & InstanceType<
    typeof BaseModel
  >;
}

describe("makeReactive", () => {
  it("returns primitives unchanged", () => {
    const model = makeFakeModel();
    expect(makeReactive(model, "n", 42)).toBe(42);
    expect(makeReactive(model, "s", "hello")).toBe("hello");
    expect(makeReactive(model, "b", true)).toBe(true);
    expect(makeReactive(model, "x", null)).toBeNull();
  });

  it("returns Date unchanged", () => {
    const model = makeFakeModel();
    const d = new Date();
    expect(makeReactive(model, "d", d)).toBe(d);
  });

  it("wraps objects in a Proxy", () => {
    const model = makeFakeModel();
    const obj = { x: 1 };
    const proxy = makeReactive(model, "meta", obj);
    expect(typeof proxy).toBe("object");
    expect((proxy as { x: number }).x).toBe(1);
  });

  it("set on proxy marks model dirty", () => {
    const model = makeFakeModel();
    const obj = { x: 1 };
    const proxy = makeReactive(model, "meta", obj) as { x: number };
    proxy.x = 99;
    expect(model.dirtyKeys).toContain("meta");
  });

  it("deleteProperty on proxy marks model dirty", () => {
    const model = makeFakeModel();
    const obj = { x: 1, y: 2 };
    const proxy = makeReactive(model, "settings", obj) as Record<string, unknown>;
    delete proxy["x"];
    expect(model.dirtyKeys).toContain("settings");
  });

  it("nested object get returns another proxy", () => {
    const model = makeFakeModel();
    const obj = { nested: { deep: 1 } };
    const proxy = makeReactive(model, "data", obj) as { nested: { deep: number } };
    const nested = proxy.nested;
    expect(typeof nested).toBe("object");
  });

  it("returns cached proxy for the same target", () => {
    const model = makeFakeModel();
    const obj = { x: 1 };
    const proxy1 = makeReactive(model, "a", obj);
    const proxy2 = makeReactive(model, "a", obj);
    expect(proxy1).toBe(proxy2);
  });

  it("array get on non-object (string) value from array stays as-is", () => {
    const model = makeFakeModel();
    const arr = ["hello", "world"];
    const proxy = makeReactive(model, "tags", arr) as string[];
    expect(proxy[0]).toBe("hello");
  });
});

// ── DB extras ─────────────────────────────────────────────────────────────────

import { DB, _setDbConnection } from "./db/DB.ts";

let db: SQLInstance;

beforeEach(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
});

afterEach(async () => {
  _setDbConnection(null);
  await db.end();
});

describe("DB.currentTx()", () => {
  it("returns undefined when not inside a transaction", () => {
    expect(DB.currentTx()).toBeUndefined();
  });
});

describe("DB.onPrimary()", () => {
  it("returns an object with a table() method", async () => {
    await db`CREATE TABLE things (id INTEGER PRIMARY KEY, val TEXT)`;
    await db`INSERT INTO things VALUES (1, 'hello')`;
    const row = await DB.onPrimary().table("things").where("id", 1).first();
    expect((row as { val?: string })?.val).toBe("hello");
  });
});

describe("DB.preventNPlusOne()", () => {
  it("does not throw when called with default options", () => {
    expect(() => DB.preventNPlusOne()).not.toThrow();
    expect(() => DB.preventNPlusOne({ threshold: 3, mode: "warn" })).not.toThrow();
  });
});

describe("DB.allowNPlusOne()", () => {
  it("does not throw for a given pattern", () => {
    expect(() => DB.allowNPlusOne("activity_logs")).not.toThrow();
    expect(() => DB.allowNPlusOne("taggings", { once: true })).not.toThrow();
  });
});

describe("DB.raw()", () => {
  it("executes string SQL without parameters", async () => {
    await db`CREATE TABLE nums (n INTEGER)`;
    await db`INSERT INTO nums VALUES (1)`;
    const rows = await DB.raw<{ n: number }>("SELECT n FROM nums");
    expect(rows[0]?.n).toBe(1);
  });

  it("executes string SQL with array of bindings", async () => {
    await db`CREATE TABLE nums2 (n INTEGER)`;
    await db`INSERT INTO nums2 VALUES (5)`;
    const rows = await DB.raw<{ n: number }>("SELECT n FROM nums2 WHERE n = ?", [5]);
    expect(rows[0]?.n).toBe(5);
  });

  it("executes string SQL with spread bindings", async () => {
    await db`CREATE TABLE nums3 (n INTEGER)`;
    await db`INSERT INTO nums3 VALUES (7)`;
    const rows = await DB.raw<{ n: number }>("SELECT n FROM nums3 WHERE n = ?", 7);
    expect(rows[0]?.n).toBe(7);
  });
});

// ── _normaliseSqliteUrl ────────────────────────────────────────────────────────

import { _normaliseSqliteUrl } from "./provider/DatabaseProvider.ts";

describe("_normaliseSqliteUrl", () => {
  it("returns :memory: unchanged", () => {
    expect(_normaliseSqliteUrl(":memory:")).toBe(":memory:");
  });

  it("returns empty string unchanged", () => {
    expect(_normaliseSqliteUrl("")).toBe("");
  });

  it("leaves postgres:// unchanged", () => {
    expect(_normaliseSqliteUrl("postgres://localhost/db")).toBe("postgres://localhost/db");
  });

  it("leaves postgresql:// unchanged", () => {
    expect(_normaliseSqliteUrl("postgresql://localhost/db")).toBe("postgresql://localhost/db");
  });

  it("leaves mysql:// unchanged", () => {
    expect(_normaliseSqliteUrl("mysql://localhost/db")).toBe("mysql://localhost/db");
  });

  it("leaves mysql2:// unchanged", () => {
    expect(_normaliseSqliteUrl("mysql2://localhost/db")).toBe("mysql2://localhost/db");
  });

  it("collapses sqlite:// to sqlite:", () => {
    expect(_normaliseSqliteUrl("sqlite://path/to/db.sqlite")).toBe("sqlite:path/to/db.sqlite");
  });

  it("leaves sqlite: unchanged", () => {
    expect(_normaliseSqliteUrl("sqlite:./mydb.sqlite")).toBe("sqlite:./mydb.sqlite");
  });

  it("rewrites file: to sqlite:", () => {
    expect(_normaliseSqliteUrl("file:./mydb.sqlite")).toBe("sqlite:./mydb.sqlite");
  });

  it("adds sqlite: scheme to bare relative path", () => {
    expect(_normaliseSqliteUrl("./storage/app.db")).toBe("sqlite:./storage/app.db");
  });

  it("adds sqlite: scheme to bare filename", () => {
    expect(_normaliseSqliteUrl("mydb.sqlite")).toBe("sqlite:mydb.sqlite");
  });
});

// ── Command static properties — extended ──────────────────────────────────────

import { MigrateGenerateCommand } from "./commands/MigrateGenerateCommand.ts";

describe("MigrateGenerateCommand", () => {
  it("declares static commandName and description", () => {
    expect(MigrateGenerateCommand.commandName).toBe("migrate:generate");
    expect(typeof MigrateGenerateCommand.description).toBe("string");
    expect(MigrateGenerateCommand.description.length).toBeGreaterThan(0);
  });
});

// ── Stub helpers extended coverage ────────────────────────────────────────────

import { migrationStub, toMigrationClassName } from "./commands/MakeMigrationCommand.ts";
import { modelStub } from "./commands/MakeModelCommand.ts";
import { factoryStub } from "./commands/MakeFactoryCommand.ts";
import { seederStub } from "./commands/MakeSeederCommand.ts";

describe("migrationStub", () => {
  it("includes import from @zerotal/orm", () => {
    const out = migrationStub("CreateUsersTable");
    expect(out).toContain("from '@zerotal/orm'");
  });

  it("includes async up() and down()", () => {
    const out = migrationStub("CreateUsersTable");
    expect(out).toContain("async up()");
    expect(out).toContain("async down()");
  });

  it("uses the given className", () => {
    const out = migrationStub("AddPhoneToUsers");
    expect(out).toContain("class AddPhoneToUsers");
  });
});

describe("toMigrationClassName", () => {
  it("converts snake_case to PascalCase", () => {
    expect(toMigrationClassName("create_users_table")).toBe("CreateUsersTable");
    expect(toMigrationClassName("add_phone_to_users")).toBe("AddPhoneToUsers");
    expect(toMigrationClassName("single")).toBe("Single");
  });
});

describe("modelStub", () => {
  it("uses provided name and tableName", () => {
    const out = modelStub("Article", "articles");
    expect(out).toContain("@table('articles')");
    expect(out).toContain("class Article extends BaseModel");
  });

  it("includes @column() decorator", () => {
    const out = modelStub("Product", "products");
    expect(out).toContain("@column()");
  });
});

describe("factoryStub", () => {
  it("uses camelCase model var in comments", () => {
    const out = factoryStub("Article");
    expect(out).toContain("article");
    expect(out).toContain("ArticleFactory");
  });
});

describe("seederStub", () => {
  it("includes the class name", () => {
    const out = seederStub("ProductSeeder");
    expect(out).toContain("class ProductSeeder");
  });
});
