import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { _globalScopeRegistry } from "./ModelQueryBuilder.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";

/**
 * Regression guard: global scopes must reach **every** terminal, not just `get()`/`first()`.
 *
 * `_applyGlobalScopes()` used to be called from exactly two methods, and `ModelQueryBuilder`
 * overrides none of the mutating or aggregate terminals — so `update()`, `delete()`, `count()`,
 * `exists()`, `pluck()`, `value()` and the aggregates all inherited `QueryBuilder`'s raw
 * implementations and compiled SQL with no scope applied. For a tenant scope that meant a mass
 * update crossed the tenant boundary; for `SoftDeletes` it meant trashed rows were counted and
 * re-deleted. Scopes are now applied through `QueryBuilder._beforeTerminal()`, which every
 * terminal calls.
 */

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE projects (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      tenant_id INTEGER NOT NULL,
      budget    INTEGER NOT NULL DEFAULT 0
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await (db as unknown as { close(): Promise<void> }).close();
});

@table("projects")
class Project extends BaseModel {
  @column({}) name!: string;
  @column({}) tenant_id!: number;
  @column({}) budget!: number;
}

/** Reseed a fixed two-tenant fixture and pin the scope to tenant 1. */
beforeEach(async () => {
  _globalScopeRegistry().delete(Project);
  await db`DELETE FROM projects`;
  await db`INSERT INTO projects (id, name, tenant_id, budget) VALUES (1, 'mine-a',   1, 10)`;
  await db`INSERT INTO projects (id, name, tenant_id, budget) VALUES (2, 'mine-b',   1, 20)`;
  await db`INSERT INTO projects (id, name, tenant_id, budget) VALUES (3, 'theirs-a', 2, 30)`;
  await db`INSERT INTO projects (id, name, tenant_id, budget) VALUES (4, 'theirs-b', 2, 40)`;
  Project.addGlobalScope("tenant", (qb) => qb.where("tenant_id", 1));
});

const rowsOf = async (): Promise<{ name: string; tenant_id: number; budget: number }[]> =>
  (await db`SELECT name, tenant_id, budget FROM projects ORDER BY id`) as never;

describe("global scopes apply to mutating terminals", () => {
  it("update() does not cross the scope boundary", async () => {
    await Project.query().update({ name: "renamed" });

    const rows = await rowsOf();
    expect(rows.filter((r) => r.name === "renamed")).toHaveLength(2);
    // Tenant 2's rows must be untouched — this is the cross-tenant write.
    expect(rows.filter((r) => r.tenant_id === 2).map((r) => r.name)).toEqual([
      "theirs-a",
      "theirs-b",
    ]);
  });

  it("delete() does not cross the scope boundary", async () => {
    await Project.query().delete();

    const rows = await rowsOf();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenant_id === 2)).toBe(true);
  });

  it("increment() and decrement() do not cross the scope boundary", async () => {
    await Project.query().increment("budget", 5);
    await Project.query().decrement("budget", 2);

    const rows = await rowsOf();
    expect(rows.filter((r) => r.tenant_id === 1).map((r) => r.budget)).toEqual([13, 23]);
    expect(rows.filter((r) => r.tenant_id === 2).map((r) => r.budget)).toEqual([30, 40]);
  });
});

describe("global scopes apply to aggregate and existence terminals", () => {
  it("count() counts only in-scope rows", async () => {
    expect(await Project.query().count()).toBe(2);
  });

  it("sum(), avg(), min() and max() aggregate only in-scope rows", async () => {
    expect(await Project.query().sum("budget")).toBe(30);
    expect(await Project.query().avg("budget")).toBe(15);
    expect(await Project.query().min("budget")).toBe(10);
    expect(await Project.query().max("budget")).toBe(20);
  });

  it("exists() reflects the scope", async () => {
    expect(await Project.query().where("tenant_id", 2).exists()).toBe(false);
    expect(await Project.query().where("name", "mine-a").exists()).toBe(true);
  });

  it("pluck() and value() return only in-scope rows", async () => {
    expect(await Project.query().pluck("name")).toEqual(["mine-a", "mine-b"]);
    expect(await Project.query().value("name")).toBe("mine-a");
  });
});

describe("global scopes apply to paginators", () => {
  it("paginate() reports an in-scope total", async () => {
    const page = await Project.query().paginate(10, 1);
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(2);
    // total and page length agreeing is the invariant that broke: count() was unscoped
    // while get() was scoped, so total said 4 and data had 2.
    expect(page.total).toBe(page.data.length);
  });

  it("simplePaginate() returns only in-scope rows", async () => {
    const page = await Project.query().simplePaginate(10, 1);
    expect(page.data).toHaveLength(2);
  });
});

describe("withoutGlobalScopes() still escapes on every terminal", () => {
  it("lets an explicit opt-out reach all rows for writes and counts", async () => {
    expect(await Project.query().withoutGlobalScopes().count()).toBe(4);

    await Project.query().withoutGlobalScopes().where("tenant_id", 2).update({ budget: 99 });
    const rows = await rowsOf();
    expect(rows.filter((r) => r.tenant_id === 2).map((r) => r.budget)).toEqual([99, 99]);
    // …and the scoped rows were left alone by that opt-out write.
    expect(rows.filter((r) => r.tenant_id === 1).map((r) => r.budget)).toEqual([10, 20]);
  });
});
