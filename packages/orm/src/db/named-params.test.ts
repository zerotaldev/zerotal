/**
 * Named parameters never reach the driver.
 *
 * Bun's own `sql.unsafe(query, { id: 1 })` binds an object of named parameters
 * (`:id`, `$id`, `@id`) on Bun 1.4, and on Bun 1.3.14 binds nothing — the
 * statement runs with NULL in their place and reports no error. The ORM has no
 * `sql.unsafe()` call, and `DB.raw()`, the one place a caller hands it SQL and
 * values together, refuses the object form outright, so the same call does the
 * same thing on every Bun.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";

let db: SQL;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db as never);
  await db`CREATE TABLE named_items (id INTEGER PRIMARY KEY, name TEXT)`;
  await db`INSERT INTO named_items (id, name) VALUES (1, 'kept')`;
});

afterAll(async () => {
  _setDbConnection(null);
  await db.end();
});

describe("DB.raw with an object of named parameters", () => {
  for (const placeholder of [":id", "$id", "@id"]) {
    it(`refuses ${placeholder}, naming the positional form`, async () => {
      await expect(
        DB.raw(`DELETE FROM named_items WHERE id = ${placeholder}`, { id: 1 }),
      ).rejects.toThrow(/positional bindings, not an object of named parameters/);
    });
  }

  it("ran nothing it refused", async () => {
    const rows = await DB.raw<{ name: string }>("SELECT name FROM named_items WHERE id = ?", [1]);
    expect(rows.map((r) => r.name)).toEqual(["kept"]);
  });
});

describe("the ORM's source", () => {
  it("never calls sql.unsafe()", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/\.unsafe\s*\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
