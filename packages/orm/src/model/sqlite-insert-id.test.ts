import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import type { SQLInstance } from "../db/sql-types.ts";
import { DB, _setDbConnection } from "../db/DB.ts";
import { BaseModel, _setBaseModelConnection, _setBaseModelDialect } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";

/**
 * Regression guard: on SQLite a model insert reads back its own row.
 *
 * The insert read its new id with a second statement, `SELECT last_insert_rowid()`. That answers
 * for the connection, and SQLite has one connection, shared by every request. An INSERT from
 * another async context that ran between the two statements made the model take that row's id,
 * so `create()` returned someone else's row, with its values, and a later `save()` on the
 * instance updated it. Each case here lets another context run `k` statements and then an INSERT
 * while the model inserts, so that INSERT lands at every point in the model's own sequence.
 */

let db: SQLInstance;

@table("insert_id_entries", { timestamps: false })
class Entry extends BaseModel {
  @column() who!: string;
}

/** The same rows through a view that takes inserts with an INSTEAD OF trigger. */
@table("insert_id_view", { timestamps: false })
class ViewEntry extends BaseModel {
  @column() who!: string;
}

beforeAll(async () => {
  db = new SQL(":memory:") as unknown as SQLInstance;
  _setDbConnection(db);
  _setBaseModelConnection(db);
  _setBaseModelDialect("sqlite");
  await db`CREATE TABLE insert_id_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT)`;
  await db`CREATE VIEW insert_id_view AS SELECT id, who FROM insert_id_entries`;
  await db`
    CREATE TRIGGER insert_id_view_insert INSTEAD OF INSERT ON insert_id_view
    BEGIN INSERT INTO insert_id_entries (who) VALUES (NEW.who); END`;
});
afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM insert_id_entries`;
});

/** Another context: `k` statements, then an INSERT of its own. */
async function otherContext(k: number): Promise<void> {
  for (let i = 0; i < k; i++) await DB.raw("SELECT 1");
  await DB.raw("INSERT INTO insert_id_entries (who) VALUES (?)", ["other"]);
}

describe("Model.create() on SQLite with another context inserting", () => {
  for (let k = 0; k <= 8; k++) {
    it(`returns its own row when the other INSERT comes after ${k} statement(s)`, async () => {
      const [created] = await Promise.all([Entry.create({ who: "model" }), otherContext(k)]);
      expect(created.who).toBe("model");
      const [own] = await db<{ id: number }>`
        SELECT id FROM insert_id_entries WHERE who = 'model'`;
      expect(created.id).toBe(own!.id);
    });
  }

  it("many concurrent creates each return their own row", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const created = await Promise.all(names.map((who) => Entry.create({ who })));
    for (const [i, entry] of created.entries()) {
      expect(entry.who).toBe(names[i]!);
      const [row] = await db<{ who: string }>`
        SELECT who FROM insert_id_entries WHERE id = ${entry.id}`;
      expect(row!.who).toBe(names[i]!);
    }
  });
});

describe("Model.create() on SQLite through a view", () => {
  it("an insert through a view's INSTEAD OF trigger does not take another row", async () => {
    // The trigger's own INSERT does not move last_insert_rowid() once it ends, so the old
    // read-back named whatever the connection inserted before and loaded that row.
    await db`INSERT INTO insert_id_entries (who) VALUES ('earlier')`;
    const created = await ViewEntry.create({ who: "through view" });
    expect(created.who).toBe("through view");
    expect(created.id).toBeUndefined();
    const rows = await db<{ who: string }>`SELECT who FROM insert_id_entries ORDER BY id`;
    expect(rows.map((r) => r.who)).toEqual(["earlier", "through view"]);
  });
});
