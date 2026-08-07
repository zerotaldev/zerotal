import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "@zerotal/orm";
import { column, table } from "@zerotal/orm";
import { refreshDatabase } from "./refreshDatabase.ts";
import { assertDatabaseHas } from "./assertions.ts";

const db = new SQL(":memory:");

@table("widgets", { timestamps: false })
class Widget extends BaseModel {
  @column({ type: "string" }) name!: string;
}

describe("refreshDatabase — transactional isolation", () => {
  refreshDatabase({
    connection: db,
    setup: (c) => c`CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`,
  });

  it("starts empty and can insert", async () => {
    expect(await Widget.all()).toHaveLength(0);
    await Widget.create({ name: "first" });
    expect(await Widget.all()).toHaveLength(1);
    await assertDatabaseHas("widgets", { name: "first" });
  });

  it("does NOT see the previous test's insert (rolled back)", async () => {
    expect(await Widget.all()).toHaveLength(0);
    await Widget.create({ name: "second" });
    expect(await Widget.all()).toHaveLength(1);
  });

  it("is clean again on the third test", async () => {
    expect(await Widget.all()).toHaveLength(0);
  });
});

describe("refreshDatabase — schema persists across tests", () => {
  refreshDatabase({
    connection: db,
    setup: (c) => c`CREATE TABLE gadgets (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)`,
    teardown: (c) => c`DROP TABLE gadgets`,
  });

  @table("gadgets", { timestamps: false })
  class Gadget extends BaseModel {
    @column({ type: "string" }) label!: string;
  }

  it("table created in setup is usable", async () => {
    await Gadget.create({ label: "x" });
    expect(await Gadget.all()).toHaveLength(1);
  });

  it("table still exists for the next test (only rows roll back)", async () => {
    expect(await Gadget.all()).toHaveLength(0);
  });
});
