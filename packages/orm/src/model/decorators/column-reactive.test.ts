/**
 * Tests for the reactive property path in @column decorator:
 * - wrapReactive / defineReactiveProperty are called when the column has
 *   cast: 'json' or cast: 'array', AND the class has reactiveCasts = true.
 *
 * We test this by registering a column via the legacy decorator path against
 * a prototype whose constructor has `reactiveCasts = true`, then manually
 * calling the return-value-initializer with an instance to trigger
 * defineReactiveProperty.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "../BaseModel.ts";
import { column } from "./column.ts";
import { table } from "./table.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE reactive_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meta TEXT,
      tags TEXT,
      settings TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM reactive_models`;
});

// ── Model with reactiveCasts and json/array columns ───────────────────────────

@table("reactive_models")
class ReactiveModel extends BaseModel {
  static override reactiveCasts = true;

  @column("json")
  meta!: Record<string, unknown> | null;

  @column("array")
  tags!: string[] | null;
}

describe("@column reactive property (json / array cast + reactiveCasts=true)", () => {
  it("json column returns a reactive proxy on a saved model", async () => {
    const m = await ReactiveModel.create({ meta: { x: 1 }, tags: ["a"] } as never);
    const fetched = await ReactiveModel.find(m.id);
    expect(fetched).not.toBeNull();
    // Access the json column — should be an object
    expect(typeof fetched!.meta).toBe("object");
  });

  it("mutating a json property marks the model dirty", async () => {
    const m = await ReactiveModel.create({ meta: { count: 0 }, tags: [] } as never);
    const fetched = await ReactiveModel.find(m.id);
    expect(fetched).not.toBeNull();
    // Mutate nested property — this exercises the reactive proxy set trap
    (fetched!.meta as Record<string, unknown>)["count"] = 99;
    expect(fetched!.isDirty()).toBe(true);
  });

  it("replacing the json value directly also marks dirty", async () => {
    const m = await ReactiveModel.create({ meta: { v: 1 }, tags: [] } as never);
    const fetched = await ReactiveModel.find(m.id);
    fetched!.meta = { v: 2 };
    expect(fetched!.isDirty()).toBe(true);
  });

  it("array column returns an array-like value", async () => {
    const m = await ReactiveModel.create({ meta: {}, tags: ["x", "y"] } as never);
    const fetched = await ReactiveModel.find(m.id);
    expect(Array.isArray(fetched!.tags)).toBe(true);
    expect(fetched!.tags).toContain("x");
  });

  it("mutating array element marks model dirty", async () => {
    const m = await ReactiveModel.create({ meta: {}, tags: ["a", "b"] } as never);
    const fetched = await ReactiveModel.find(m.id);
    (fetched!.tags as string[])[0] = "z";
    expect(fetched!.isDirty()).toBe(true);
  });

  it("null json value passes through without reactive wrapping", async () => {
    const m = await ReactiveModel.create({ meta: null, tags: null } as never);
    const fetched = await ReactiveModel.find(m.id);
    expect(fetched!.meta).toBeNull();
    expect(fetched!.tags).toBeNull();
  });
});

// ── wrapReactive: reactiveCasts=false path ────────────────────────────────────

@table("reactive_models")
class NonReactiveModel extends BaseModel {
  // Explicitly opted out of the default. Only do this when every write to a JSON column
  // replaces the whole value, which dirty tracking sees without a proxy.
  static override reactiveCasts = false;

  @column("json")
  meta!: Record<string, unknown> | null;
}

describe("@column json with reactiveCasts opted out", () => {
  it("returns the plain parsed value, and in-place mutation is not tracked", async () => {
    const m = await NonReactiveModel.create({ meta: { plain: true } } as never);
    const fetched = await NonReactiveModel.find(m.id);
    expect(fetched!.meta).toEqual({ plain: true });

    (fetched!.meta as Record<string, unknown>)["plain"] = false;
    expect(fetched!.isDirty()).toBe(false);
  });

  it("still tracks a whole-value replacement", async () => {
    const m = await NonReactiveModel.create({ meta: { plain: true } } as never);
    const fetched = await NonReactiveModel.find(m.id);
    fetched!.meta = { plain: false };
    expect(fetched!.isDirty()).toBe(true);
  });
});

describe("@column json by default", () => {
  @table("reactive_models")
  class DefaultModel extends BaseModel {
    @column("json") meta!: Record<string, unknown> | null;
  }

  it("tracks in-place mutation, so save() actually writes", async () => {
    // Untracked, `user.meta.count = 99; await user.save()` issued no UPDATE and reported
    // success — a silent data-loss path that looks exactly like a working one.
    const m = await DefaultModel.create({ meta: { count: 1 } } as never);
    const fetched = await DefaultModel.find(m.id);

    (fetched!.meta as Record<string, unknown>)["count"] = 99;
    expect(fetched!.isDirty()).toBe(true);

    await fetched!.save();
    const reloaded = await DefaultModel.find(m.id);
    expect(reloaded!.meta).toEqual({ count: 99 });
  });
});
