/**
 * Dropping a column a foreign key still names, on SQLite.
 *
 * SQLite cannot drop an FK constraint through `ALTER TABLE`, so while the
 * constraint names the column the column cannot go. The engine says so — but it
 * says so *after* every earlier statement in the same `Schema.table()` block has
 * already run, which is how a migration ends up half-applied and has to be
 * unpicked by hand.
 *
 * Refusing before the first statement turns that into a no-op with a message
 * that names the constraint and the way out.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Schema } from "./Schema.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection } from "../index.ts";

beforeEach(async () => {
  _setDbConnection(new SQL(":memory:") as never);
  await DB.raw(`CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`);
  await DB.raw(
    `CREATE TABLE transactions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       amount INTEGER,
       note TEXT,
       category_id INTEGER,
       FOREIGN KEY (category_id) REFERENCES categories(id)
     )`,
  );
});

describe("Schema.table — dropping an FK-referenced column on SQLite", () => {
  it("refuses, naming the column and the referenced table", async () => {
    const attempt = Schema.table("transactions", (t) => {
      t.dropColumn("category_id");
    });

    await expect(attempt).rejects.toThrow(/category_id/);
    await expect(attempt).rejects.toThrow(/categories/);
    await expect(attempt).rejects.toThrow(/[Rr]ebuild the table/);
  });

  it("applies nothing — not even the statements that came first in the block", async () => {
    // The whole point. `note` would have been dropped by the engine before it
    // reached `category_id` and failed.
    await expect(
      Schema.table("transactions", (t) => {
        t.dropColumn("note", "category_id");
      }),
    ).rejects.toThrow();

    expect(await Schema.hasColumn("transactions", "note")).toBe(true);
    expect(await Schema.hasColumn("transactions", "category_id")).toBe(true);
  });

  it("does not block a column no foreign key names", async () => {
    await Schema.table("transactions", (t) => {
      t.dropColumn("note");
    });

    expect(await Schema.hasColumn("transactions", "note")).toBe(false);
    expect(await Schema.hasColumn("transactions", "category_id")).toBe(true);
  });

  it("does not block a table with no foreign keys at all", async () => {
    await Schema.table("categories", (t) => {
      t.dropColumn("name");
    });

    expect(await Schema.hasColumn("categories", "name")).toBe(false);
  });

  it("leaves a pure ADD COLUMN block alone", async () => {
    await Schema.table("transactions", (t) => {
      t.dateTime("settled_at").nullable();
    });

    expect(await Schema.hasColumn("transactions", "settled_at")).toBe(true);
  });
});
