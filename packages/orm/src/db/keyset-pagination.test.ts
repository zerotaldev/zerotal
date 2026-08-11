/**
 * Keyset pagination has to walk every row exactly once.
 *
 * The two defects here compounded: a descending sort with ties re-emitted rows it had
 * already returned and made the rest unreachable, and the whole method bypassed `get()` —
 * so results came back as raw rows, unhydrated, uncast and unscoped, while typed as
 * `KeysetPaginateResult<M>`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB, _setDbConnection } from "./DB.ts";
import { BaseModel, _setBaseModelConnection } from "../model/BaseModel.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";

let db: any;

@table("articles")
class Article extends BaseModel {
  @column() title!: string;
  /** Deliberately non-unique: this is what produces the ties. */
  @column() score!: number;
  @column("json") meta!: Record<string, unknown> | null;
  static override hidden = ["secret"];
  secret!: string;
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  await db`CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, score INTEGER, meta TEXT, secret TEXT, created_at TEXT, updated_at TEXT)`;
});

afterAll(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM articles`;
  // Six rows, all tied on `score` — every ordering decision falls to the tiebreaker.
  for (let id = 1; id <= 6; id++) {
    await db`INSERT INTO articles (id, title, score, meta, secret) VALUES (${id}, ${"a" + id}, 5, '{"n":1}', 'hidden-value')`;
  }
});

/** Walk every page and collect the ids, with a hard stop so a loop cannot hang the suite. */
async function walk(direction: "asc" | "desc", limit = 2): Promise<number[]> {
  const seen: number[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result = await DB.table("articles").keysetPaginate<{ id: number }>({
      column: "score",
      direction,
      limit,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...result.data.map((r) => r.id));
    if (!result.nextCursor) return seen;
    cursor = result.nextCursor;
  }
  throw new Error("keysetPaginate did not terminate");
}

describe("ties are walked exactly once", () => {
  it("descending: every row appears, none twice", async () => {
    // The tiebreaker was hard-coded `id ASC` while the cursor compared it with the
    // primary sort's `<`. Page 1 returned [1,2]; page 2 asked for ids below 2 and
    // returned [1] again, then stopped — rows 3-6 were unreachable.
    const seen = await walk("desc");
    expect(seen).toEqual([6, 5, 4, 3, 2, 1]);
    expect(new Set(seen).size).toBe(6);
  });

  it("ascending: every row appears, none twice", async () => {
    const seen = await walk("asc");
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("still paginates cleanly when the sort column is itself unique", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await DB.table("articles").keysetPaginate<{ id: number }>({
        column: "id",
        direction: "desc",
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...result.data.map((r) => r.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

describe("results go through get(), like every other terminal", () => {
  it("returns hydrated model instances, not raw rows", async () => {
    const page = await Article.query().keysetPaginate({ column: "score", limit: 3 });
    expect(page.data).toHaveLength(3);
    expect(page.data[0]).toBeInstanceOf(Article);
  });

  it("applies casts", async () => {
    const page = await Article.query().keysetPaginate({ column: "score", limit: 1 });
    // Raw rows carry the JSON *string*; a hydrated model carries the parsed value.
    expect(page.data[0]!.meta).toEqual({ n: 1 });
  });

  it("strips hidden attributes from toJSON()", async () => {
    const page = await Article.query().keysetPaginate({ column: "score", limit: 1 });
    expect(JSON.stringify(page.data[0])).not.toContain("hidden-value");
  });

  it("honours a scope applied to the query", async () => {
    // _runSelect() also skipped _beforeTerminal(), so global scopes — tenant, soft-delete —
    // never reached the SQL.
    const page = await Article.query()
      .where("id", ">", 3)
      .keysetPaginate({ column: "score", limit: 10 });
    expect(page.data.map((a) => a.id).sort()).toEqual([4, 5, 6]);
  });
});
