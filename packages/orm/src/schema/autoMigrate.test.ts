import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { _setDbConnection } from "../db/DB.ts";
import { Schema } from "./Schema.ts";
import { SchemaInspector } from "./SchemaInspector.ts";
import { synchronizeSchema, resolveSyncOptions } from "./autoMigrate.ts";
import type { ModelSchema } from "./ModelInspector.ts";
import { ModelInspector } from "./ModelInspector.ts";

// ── resolveSyncOptions (pure) ─────────────────────────────────────────────────

describe("resolveSyncOptions", () => {
  it("treats false/undefined/null as disabled", () => {
    expect(resolveSyncOptions(false)).toEqual({ enabled: false, disruptive: false });
    expect(resolveSyncOptions(undefined)).toEqual({ enabled: false, disruptive: false });
    expect(resolveSyncOptions(null)).toEqual({ enabled: false, disruptive: false });
  });

  it("treats true as enabled + additive (non-disruptive)", () => {
    expect(resolveSyncOptions(true)).toEqual({ enabled: true, disruptive: false });
  });

  it("reads the object form", () => {
    expect(resolveSyncOptions({ enabled: true, disruptive: false })).toEqual({
      enabled: true,
      disruptive: false,
    });
    expect(resolveSyncOptions({ enabled: true, disruptive: true })).toEqual({
      enabled: true,
      disruptive: true,
    });
  });

  it("defaults enabled to true when the object omits it, disruptive to false", () => {
    expect(resolveSyncOptions({})).toEqual({ enabled: true, disruptive: false });
    expect(resolveSyncOptions({ disruptive: true })).toEqual({ enabled: true, disruptive: true });
  });

  it("honours enabled:false even with disruptive:true", () => {
    expect(resolveSyncOptions({ enabled: false, disruptive: true })).toEqual({
      enabled: false,
      disruptive: false,
    });
  });
});

// ── Integration — additive vs disruptive over a live SQLite DB ─────────────────

function fakeSchema(columns: { name: string; type?: string }[]): ModelSchema {
  return {
    table: "widgets",
    primaryKey: "id",
    timestamps: false,
    softDeletes: false,
    columns: columns.map((c) => ({
      name: c.name,
      type: (c.type ?? "string") as never,
      nullable: true,
      primary: false,
      default: undefined,
    })),
  } as unknown as ModelSchema;
}

describe("synchronizeSchema — disruptive opt-in", () => {
  let origAll: typeof ModelInspector.all;

  beforeEach(() => {
    _setDbConnection(new SQL(":memory:") as never);
    origAll = ModelInspector.all;
  });

  afterEach(() => {
    ModelInspector.all = origAll;
  });

  it("additive run never drops a removed column", async () => {
    await Schema.create("widgets", (table) => {
      table.increments("id");
      table.string("name");
      table.string("legacy"); // column the model no longer declares
    });

    // Model now declares only `name`.
    ModelInspector.all = () => [fakeSchema([{ name: "name" }])];

    const diff = await synchronizeSchema(); // additive (default)
    expect(diff.droppedColumns).toEqual([{ table: "widgets", column: "legacy" }]);

    // Still present — additive sync left it alone.
    expect(await SchemaInspector.columns("widgets").then((c) => c!.map((x) => x.name))).toContain(
      "legacy",
    );
  });

  it("disruptive run drops the removed column", async () => {
    await Schema.create("widgets", (table) => {
      table.increments("id");
      table.string("name");
      table.string("legacy");
    });

    ModelInspector.all = () => [fakeSchema([{ name: "name" }])];

    await synchronizeSchema({ disruptive: true });

    const cols = await SchemaInspector.columns("widgets").then((c) => c!.map((x) => x.name));
    expect(cols).toContain("name");
    expect(cols).not.toContain("legacy"); // dropped
    expect(cols).toContain("id"); // primary key never dropped
  });

  it("disruptive run still adds missing columns (additive + drop together)", async () => {
    await Schema.create("widgets", (table) => {
      table.increments("id");
      table.string("legacy");
    });

    // Model drops `legacy`, adds `colour`.
    ModelInspector.all = () => [fakeSchema([{ name: "colour" }])];

    await synchronizeSchema({ disruptive: true });

    const cols = await SchemaInspector.columns("widgets").then((c) => c!.map((x) => x.name));
    expect(cols).toContain("colour"); // added
    expect(cols).not.toContain("legacy"); // dropped
  });
});
