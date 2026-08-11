import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";

/**
 * Regression guard: `toJSON()` silently dropped every `json` / `array` cast column.
 *
 * `installReactiveAccessors` defines a getter for each such column, and `toJSON()` skipped any
 * own property whose descriptor had a getter — with no exception for the `_zerotal_<key>`
 * backing data property that `ownDataEntries` already special-cases. Persistence kept working,
 * so nothing failed loudly; the fields just disappeared from API responses, cache writes and
 * queue payloads.
 *
 * A column declared with a `JsonCast` *object* survives (a different code path), which is why
 * the existing cast tests did not catch this.
 */

let db: SQLInstance;

@table("docs")
class Doc extends BaseModel {
  @column({}) title!: string;
  @column({ cast: "json" }) meta!: Record<string, unknown>;
  @column({ cast: "array" }) tags!: string[];
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE docs (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      meta  TEXT,
      tags  TEXT
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await (db as { close(): Promise<void> }).close();
});

beforeEach(async () => {
  await db`DELETE FROM docs`;
  await db`INSERT INTO docs (id, title, meta, tags)
           VALUES (1, 'Ada', '{"a":1,"nested":{"b":2}}', '["x","y"]')`;
});

describe("toJSON() includes json and array cast columns", () => {
  it("keeps the cast columns on a hydrated model", async () => {
    const doc = (await Doc.find(1))!;

    // Sanity: the accessors themselves work — this was never the broken part.
    expect(doc.meta).toEqual({ a: 1, nested: { b: 2 } });
    expect(doc.tags).toEqual(["x", "y"]);

    const json = doc.toJSON();
    expect(json["meta"]).toEqual({ a: 1, nested: { b: 2 } });
    expect(json["tags"]).toEqual(["x", "y"]);
    expect(json["title"]).toBe("Ada");
  });

  it("survives JSON.stringify — the path an API response actually takes", async () => {
    const doc = (await Doc.find(1))!;
    const round = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

    expect(Object.keys(round)).toContain("meta");
    expect(Object.keys(round)).toContain("tags");
    expect(round["meta"]).toEqual({ a: 1, nested: { b: 2 } });
    expect(round["tags"]).toEqual(["x", "y"]);
  });

  it("does not leak the _zerotal_ backing properties", async () => {
    const doc = (await Doc.find(1))!;
    const json = doc.toJSON();
    expect(Object.keys(json).some((key) => key.startsWith("_"))).toBe(false);
  });

  it("still honours `hidden` for a cast column", async () => {
    class HiddenDoc extends Doc {
      static override hidden = ["meta"];
    }
    const doc = (await HiddenDoc.find(1))!;
    const json = doc.toJSON();
    expect(json["meta"]).toBeUndefined();
    expect(json["tags"]).toEqual(["x", "y"]);
  });

  it("keeps working when the cast columns are null", async () => {
    await db`UPDATE docs SET meta = NULL, tags = NULL WHERE id = 1`;
    const doc = (await Doc.find(1))!;
    const json = doc.toJSON();
    // Present as keys (they are real columns), just empty.
    expect("meta" in json).toBe(true);
    expect("tags" in json).toBe(true);
  });

  it("still omits un-loaded relation guards, which throw when read", async () => {
    // The blanket getter-skip existed for a reason: relation guards throw
    // RelationNotLoadedError. Narrowing it must not reintroduce that.
    const doc = (await Doc.find(1))!;
    Object.defineProperty(doc, "author", {
      get() {
        throw new Error("RelationNotLoaded");
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => doc.toJSON()).not.toThrow();
    expect(doc.toJSON()["author"]).toBeUndefined();
  });
});
