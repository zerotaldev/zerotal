import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { table } from "./decorators/table.ts";

// The base builder routes every caller-supplied column through the _column
// ingress hook (and column-paired values through _bind). These tests pin the
// paths the old per-method overrides MISSED — each `it` here failed (silently
// targeting a nonexistent column, or binding an uncoerced value) before the
// hooks existed.

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    login_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    prefs TEXT,
    joined_at TEXT,
    created_at TEXT, updated_at TEXT
  )`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM members`;
  await db`DELETE FROM sqlite_sequence`;
});

@table("members")
class Member extends BaseModel {
  fullName!: string;
  loginCount!: number;
  isActive!: number;
  prefs!: string;
  joinedAt!: string | Date;
  static override casts = { joined_at: "datetime" as const };
}

async function seed() {
  await db`INSERT INTO members (full_name, login_count, is_active, prefs, joined_at) VALUES
    ('Ann', 3, 1, '{"theme":"dark"}',  '2026-01-05T00:00:00.000Z'),
    ('Bob', 7, 0, '{"theme":"light"}', '2026-02-10T00:00:00.000Z'),
    ('Cid', 5, 1, '{"theme":"dark"}',  '2026-03-15T00:00:00.000Z')`;
}

describe("column resolution through the _column ingress hook", () => {
  it("whereNotIn / orWhereIn / orWhereNotIn resolve camelCase (the drifted IN family)", async () => {
    await seed();
    const notIn = await Member.query().whereNotIn("fullName", ["Ann"]).get();
    expect(notIn.map((m) => m.fullName).sort()).toEqual(["Bob", "Cid"]);

    const orIn = await Member.query().where("fullName", "Ann").orWhereIn("loginCount", [7]).get();
    expect(orIn.map((m) => m.fullName).sort()).toEqual(["Ann", "Bob"]);

    const orNotIn = await Member.query()
      .where("fullName", "Ann")
      .orWhereNotIn("loginCount", [3, 7])
      .get();
    expect(orNotIn.map((m) => m.fullName).sort()).toEqual(["Ann", "Cid"]);
  });

  it("orWhereNotLike resolves camelCase (the one LIKE variant left out)", async () => {
    await seed();
    const rows = await Member.query()
      .whereLike("fullName", "Ann%")
      .orWhereNotLike("fullName", "%i%")
      .get();
    expect(rows.map((m) => m.fullName).sort()).toEqual(["Ann", "Bob"]);
  });

  it("whereAny / whereAll resolve every column in the group", async () => {
    await seed();
    const any = await Member.query().whereAny(["fullName", "prefs"], "like", "%dark%").get();
    expect(any.map((m) => m.fullName).sort()).toEqual(["Ann", "Cid"]);

    const all = await Member.query().whereAll(["loginCount", "isActive"], ">=", 1).get();
    expect(all.map((m) => m.fullName).sort()).toEqual(["Ann", "Cid"]);
  });

  it("whereJson resolves the camelCase column ahead of the JSON path", async () => {
    await seed();
    // prefs is snake-free, so use a qualified camel form via a fresh accessor:
    // the column segment before -> passes through _column.
    const rows = await Member.query().whereJson("prefs->theme", "dark").get();
    expect(rows.map((m) => m.fullName).sort()).toEqual(["Ann", "Cid"]);
  });

  it("pluck and value resolve the column and read hydrated camelCase properties back", async () => {
    await seed();
    // camelCase input: resolved to full_name for SQL, read back off instances.
    const camel = (await Member.query().orderBy("fullName").pluck<string>("fullName")) as string[];
    expect(camel).toEqual(["Ann", "Bob", "Cid"]);

    // snake_case input: hydrated instances expose fullName — the _keysetValue
    // readback bridges the difference (this returned [undefined, …] before).
    const snake = (await Member.query().orderBy("fullName").pluck<string>("full_name")) as string[];
    expect(snake).toEqual(["Ann", "Bob", "Cid"]);

    const keyed = (await Member.query().pluck<string>("fullName", "loginCount")) as Record<
      string,
      string
    >;
    expect(keyed["3"]).toBe("Ann");

    expect(await Member.query().orderBy("loginCount", "desc").value<string>("fullName")).toBe(
      "Bob",
    );
  });

  it("increment / decrement resolve camelCase columns", async () => {
    await seed();
    await Member.query().where("fullName", "Ann").increment("loginCount", 2);
    await Member.query().where("fullName", "Bob").decrement("loginCount");
    const byName = Object.fromEntries(
      (await Member.query().get()).map((m) => [m.fullName, m.loginCount]),
    );
    expect(byName["Ann"]).toBe(5);
    expect(byName["Bob"]).toBe(6);
  });

  it("builder update() resolves camelCase keys", async () => {
    await seed();
    await Member.query().where("fullName", "Cid").update({ isActive: 0 });
    const cid = await Member.query().where("fullName", "Cid").firstOrFail();
    expect(cid.isActive).toBe(0);
  });

  it("keysetPaginate resolves a camelCase sort column and its cursor advances", async () => {
    await seed();
    const p1 = await Member.query().keysetPaginate<Member>({ column: "joinedAt", limit: 2 });
    expect(p1.data.map((m) => m.fullName)).toEqual(["Ann", "Bob"]);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await Member.query().keysetPaginate<Member>({
      column: "joinedAt",
      limit: 2,
      cursor: p1.nextCursor!,
    });
    expect(p2.data.map((m) => m.fullName)).toEqual(["Cid"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("chunkById pages on a camelCase column without stalling", async () => {
    await seed();
    const seen: string[] = [];
    await Member.query().chunkById<Member>(
      1,
      (rows) => {
        for (const r of rows) seen.push(r.fullName);
      },
      "loginCount",
    );
    expect(seen.sort()).toEqual(["Ann", "Bob", "Cid"]);
  });

  it("whereBetween coerces values through the column cast (the _bind hook)", async () => {
    await seed();
    // datetime-cast column: Date bounds must serialize the same way hydration
    // stored them. Before the hook they were bound raw and matched nothing.
    const rows = await Member.query()
      .whereBetween("joinedAt", [new Date("2026-01-01"), new Date("2026-02-28")])
      .get();
    expect(rows.map((m) => m.fullName).sort()).toEqual(["Ann", "Bob"]);
  });
});
