import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "../model/BaseModel.ts";
import { _globalScopeRegistry } from "../model/ModelQueryBuilder.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";
import { DB, _setDbConnection } from "./DB.ts";

/**
 * Regression guard for OR-precedence.
 *
 * `_appendWhere` glued predicates together in insertion order with bare `AND`/`OR`, and there
 * was no nested-group `where(cb)` in the builder at all. Framework predicates therefore joined
 * the caller's chain instead of ANDing with it as a unit:
 *
 *   User.query().where("role","admin").orWhere("role","owner")
 *   -> WHERE deleted_at IS NULL AND role = ? OR role = ? AND tenant_id = ?
 *
 * The bare `OR` splits that chain, so the second arm carried neither the soft-delete predicate
 * nor the tenant scope — returning trashed rows and other tenants' rows to any application that
 * used orWhere() on a scoped or soft-deleting model.
 */

let db: SQLInstance;

@table("members")
class Member extends BaseModel {
  static override softDeletes = true;
  @column({}) declare id: number;
  @column({}) declare name: string;
  @column({}) declare role: string;
  @column({}) declare tenant_id: number;
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL,
      tenant_id  INTEGER NOT NULL,
      deleted_at TEXT
    )
  `;
});

afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await (db as { close(): Promise<void> }).close();
});

beforeEach(async () => {
  _globalScopeRegistry().delete(Member);
  await db`DELETE FROM members`;
  // tenant 1, live
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t1-admin','admin',1,NULL)`;
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t1-owner','owner',1,NULL)`;
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t1-viewer','viewer',1,NULL)`;
  // tenant 2, live — must never be visible under the tenant scope
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t2-admin','admin',2,NULL)`;
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t2-owner','owner',2,NULL)`;
  // tenant 1, soft-deleted — must never be visible at all
  await db`INSERT INTO members (name, role, tenant_id, deleted_at) VALUES ('t1-deleted-owner','owner',1,'2026-01-01')`;
});

const names = <T extends { name: string }>(rows: T[]): string[] => rows.map((r) => r.name).sort();

describe("orWhere() cannot escape the soft-delete predicate", () => {
  it("keeps trashed rows out of an OR chain", async () => {
    const rows = await Member.query().where("role", "admin").orWhere("role", "owner").get();
    expect(names(rows)).toEqual(["t1-admin", "t1-owner", "t2-admin", "t2-owner"]);
    expect(names(rows)).not.toContain("t1-deleted-owner");
  });
});

describe("orWhere() cannot escape a global scope", () => {
  beforeEach(() => {
    Member.addGlobalScope("tenant", (qb) => qb.where("tenant_id", 1));
  });

  it("keeps other tenants out of an OR chain", async () => {
    const rows = await Member.query().where("role", "admin").orWhere("role", "owner").get();
    // The exact failure from the audit: both the other tenant's rows and the trashed row leaked.
    expect(names(rows)).toEqual(["t1-admin", "t1-owner"]);
  });

  it("holds for a three-arm OR chain", async () => {
    const rows = await Member.query()
      .where("role", "admin")
      .orWhere("role", "owner")
      .orWhere("role", "viewer")
      .get();
    expect(names(rows)).toEqual(["t1-admin", "t1-owner", "t1-viewer"]);
  });

  it("holds for count(), which must agree with get()", async () => {
    const q = () => Member.query().where("role", "admin").orWhere("role", "owner");
    expect(await q().count()).toBe(2);
    expect((await q().get()).length).toBe(2);
  });

  it("leaves a pure AND chain untouched", async () => {
    const rows = await Member.query().where("role", "admin").where("tenant_id", 1).get();
    expect(names(rows)).toEqual(["t1-admin"]);
  });
});

describe("where(callback) — nested groups", () => {
  it("contains an OR chain inside parentheses", () => {
    const sql = DB.table("members")
      .where("tenant_id", 1)
      .where((q) => q.where("role", "admin").orWhere("role", "owner"))
      .toRawSql();
    expect(sql).toContain("(");
    // The group must sit inside the AND chain, not replace it.
    expect(sql.toLowerCase()).toContain("tenant_id");
    expect(sql.toLowerCase()).toContain("and (");
  });

  it("returns only rows matching the grouped predicate", async () => {
    const rows = (await DB.table("members")
      .where("tenant_id", 1)
      .where((q) => q.where("role", "admin").orWhere("role", "owner"))
      .get()) as { name: string }[];
    expect(names(rows)).toEqual(["t1-admin", "t1-deleted-owner", "t1-owner"]);
  });

  it("supports orWhere(callback) for an alternative group", async () => {
    const rows = (await DB.table("members")
      .where("role", "viewer")
      .orWhere((q) => q.where("tenant_id", 2).where("role", "owner"))
      .get()) as { name: string }[];
    expect(names(rows)).toEqual(["t1-viewer", "t2-owner"]);
  });

  it("nests to more than one level", async () => {
    const rows = (await DB.table("members")
      .where("tenant_id", 1)
      .where((q) =>
        q
          .where("role", "viewer")
          .orWhere((inner) => inner.where("role", "admin").where("name", "t1-admin")),
      )
      .get()) as { name: string }[];
    expect(names(rows)).toEqual(["t1-admin", "t1-viewer"]);
  });

  it("emits no empty parentheses for a callback that adds nothing", async () => {
    const q = DB.table("members")
      .where("tenant_id", 2)
      .where(() => {});
    expect(q.toRawSql()).not.toContain("()");
    const rows = (await q.get()) as { name: string }[];
    expect(names(rows)).toEqual(["t2-admin", "t2-owner"]);
  });

  it("binds group values in the right order", async () => {
    const rows = (await DB.table("members")
      .where("tenant_id", 1)
      .where((q) => q.where("role", "admin").orWhere("role", "owner"))
      .orderBy("name")
      .limit(2)
      .get()) as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["t1-admin", "t1-deleted-owner"]);
  });
});
