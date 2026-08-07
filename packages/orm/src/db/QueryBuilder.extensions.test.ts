import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { QueryBuilder } from "./QueryBuilder.ts";

let db: SQLInstance;
const qb = (t = "users") => new QueryBuilder(t, db);

beforeAll(async () => {
  db = new SQL(":memory:");
  await db`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT, age INTEGER, score INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT
  )`;
  await db`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, views INTEGER DEFAULT 0
  )`;
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM users`;
  await db`DELETE FROM posts`;
  await db`DELETE FROM sqlite_sequence`;
  await db`INSERT INTO users (name,email,age,score,created_at) VALUES
    ('Al','al@x.com',20,10,'2024-01-01 10:00:00'),
    ('Bo','bo@x.com',30,20,'2024-02-15 12:00:00'),
    ('Cy',NULL,40,30,'2024-03-20 09:00:00'),
    ('Di','di@y.com',50,40,'2024-03-25 18:00:00')`;
  await db`INSERT INTO posts (user_id,title,views) VALUES
    (1,'P1',5),(1,'P2',15),(2,'P3',25)`;
});

describe("where variants", () => {
  it("whereBetween / whereNotBetween", async () => {
    expect((await qb().whereBetween("age", [25, 45]).get()).map((r) => r.name)).toEqual([
      "Bo",
      "Cy",
    ]);
    expect((await qb().whereNotBetween("age", [25, 45]).get()).map((r) => r.name)).toEqual([
      "Al",
      "Di",
    ]);
  });
  it("orWhereBetween", async () => {
    const rows = await qb().where("name", "Al").orWhereBetween("age", [45, 60]).get();
    expect(rows.map((r) => r.name).sort()).toEqual(["Al", "Di"]);
  });
  it("whereColumn", async () => {
    const rows = await qb("posts").whereColumn("views", ">", "user_id").get();
    expect(rows.length).toBe(3);
    expect(await qb("posts").whereColumn("id", "user_id").count()).toBe(1); // id==user_id only post 1
  });
  it("whereYear / whereMonth / whereDate", async () => {
    expect(await qb().whereYear("created_at", 2024).count()).toBe(4);
    expect(await qb().whereMonth("created_at", 3).count()).toBe(2);
    expect((await qb().whereDate("created_at", "2024-01-01").get()).map((r) => r.name)).toEqual([
      "Al",
    ]);
  });
  it("whereLike / whereNotLike", async () => {
    expect((await qb().whereLike("email", "%@x.com").get()).map((r) => r.name)).toEqual([
      "Al",
      "Bo",
    ]);
    expect(
      (await qb().whereNotNull("email").whereNotLike("email", "%@x.com").get()).map((r) => r.name),
    ).toEqual(["Di"]);
  });
  it("whereAny / whereAll", async () => {
    const any = await qb().whereAny(["age", "score"], ">=", 40).get();
    expect(any.map((r) => r.name).sort()).toEqual(["Cy", "Di"]);
    const all = await qb().whereAll(["age", "score"], ">=", 30).get();
    expect(all.map((r) => r.name).sort()).toEqual(["Cy", "Di"]);
  });
  it("orWhereNull / orWhereIn / orWhereNotIn", async () => {
    expect(
      (await qb().where("name", "Al").orWhereNull("email").get()).map((r) => r.name).sort(),
    ).toEqual(["Al", "Cy"]);
    expect(
      (await qb().whereIn("name", ["Al"]).orWhereIn("name", ["Bo"]).get())
        .map((r) => r.name)
        .sort(),
    ).toEqual(["Al", "Bo"]);
  });
  it("whereExists / whereNotExists", async () => {
    const withPosts = await qb()
      .whereExists((q) => {
        q.from("posts").selectRaw("1").whereColumn("posts.user_id", "users.id");
      })
      .get();
    expect(withPosts.map((r) => r.name).sort()).toEqual(["Al", "Bo"]);
    const without = await qb()
      .whereNotExists((q) => {
        q.from("posts").selectRaw("1").whereColumn("posts.user_id", "users.id");
      })
      .get();
    expect(without.map((r) => r.name).sort()).toEqual(["Cy", "Di"]);
  });
});

describe("ordering + selection", () => {
  it("distinct", async () => {
    const rows = await qb("posts").select("user_id").distinct().get();
    expect(rows.map((r) => r.user_id).sort()).toEqual([1, 2]);
  });
  it("latest / oldest", async () => {
    expect((await qb().latest("created_at").first())!.name).toBe("Di");
    expect((await qb().oldest("created_at").first())!.name).toBe("Al");
  });
  it("reorder clears then re-applies", async () => {
    const rows = await qb().orderBy("age", "desc").reorder("age", "asc").get();
    expect(rows.map((r) => r.name)).toEqual(["Al", "Bo", "Cy", "Di"]);
  });
  it("pluck array + keyed", async () => {
    expect(await qb().orderBy("id").pluck("name")).toEqual(["Al", "Bo", "Cy", "Di"]);
    const keyed = (await qb().pluck("name", "id")) as Record<string, unknown>;
    expect(keyed["1"]).toBe("Al");
  });
  it("value", async () => {
    expect(await qb().where("name", "Bo").value("email")).toBe("bo@x.com");
    expect(await qb().where("name", "zzz").value("email")).toBeNull();
  });
  it("inRandomOrder returns all rows", async () => {
    expect((await qb().inRandomOrder().get()).length).toBe(4);
  });
});

describe("joins + unions", () => {
  it("inner join", async () => {
    const rows = await qb("users")
      .select("users.name", "posts.title")
      .join("posts", "posts.user_id", "=", "users.id")
      .orderBy("posts.id")
      .get();
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ name: "Al", title: "P1" });
  });
  it("left join keeps unmatched rows", async () => {
    const rows = await qb("users")
      .select("users.name", "posts.title")
      .leftJoin("posts", "posts.user_id", "=", "users.id")
      .get();
    expect(rows.length).toBe(5); // Al x2, Bo x1, Cy null, Di null
  });
  it("joinSub", async () => {
    const sub = new QueryBuilder("posts", db)
      .selectRaw("user_id, COUNT(*) as cnt")
      .groupBy("user_id");
    const rows = await qb("users")
      .select("users.name", "agg.cnt")
      .joinSub(sub, "agg", "agg.user_id", "=", "users.id")
      .orderBy("users.id")
      .get();
    expect(rows.map((r) => ({ n: r.name, c: Number(r.cnt) }))).toEqual([
      { n: "Al", c: 2 },
      { n: "Bo", c: 1 },
    ]);
  });
  it("union", async () => {
    const young = new QueryBuilder("users", db).select("name").where("age", "<", 25);
    const old = new QueryBuilder("users", db).select("name").where("age", ">", 45);
    const rows = await young.union(old).get();
    expect(rows.map((r) => r.name).sort()).toEqual(["Al", "Di"]);
  });
});

describe("chunking + streaming", () => {
  it("chunk pages through all rows", async () => {
    const seen: string[] = [];
    let pages = 0;
    await qb()
      .orderBy("id")
      .chunk(2, (rows, page) => {
        pages = page;
        for (const r of rows) seen.push(r.name as string);
      });
    expect(seen).toEqual(["Al", "Bo", "Cy", "Di"]);
    expect(pages).toBe(2);
  });
  it("chunk early-stop on false", async () => {
    const seen: string[] = [];
    await qb()
      .orderBy("id")
      .chunk(2, (rows) => {
        seen.push(...rows.map((r) => r.name as string));
        return false;
      });
    expect(seen).toEqual(["Al", "Bo"]);
  });
  it("chunkById", async () => {
    const seen: string[] = [];
    await qb().chunkById(2, (rows) => {
      seen.push(...rows.map((r) => r.name as string));
    });
    expect(seen).toEqual(["Al", "Bo", "Cy", "Di"]);
  });
  it("lazy / cursor generator", async () => {
    const seen: string[] = [];
    for await (const r of qb().orderBy("id").lazy(2)) seen.push(r.name as string);
    expect(seen).toEqual(["Al", "Bo", "Cy", "Di"]);
  });
  it("each", async () => {
    let count = 0;
    await qb().each(() => {
      count++;
    });
    expect(count).toBe(4);
  });
});

describe("updateOrInsert + debug", () => {
  it("updateOrInsert updates existing", async () => {
    const inserted = await qb().updateOrInsert({ name: "Al" }, { age: 99 });
    expect(inserted).toBe(false);
    expect(await qb().where("name", "Al").value("age")).toBe(99);
  });
  it("updateOrInsert inserts new", async () => {
    const inserted = await qb().updateOrInsert({ name: "Zo", email: "zo@x.com" }, { age: 5 });
    expect(inserted).toBe(true);
    expect(await qb().where("name", "Zo").value("age")).toBe(5);
  });
  it("toSql / toRawSql", async () => {
    const q = qb().where("age", ">", 30).orderBy("id");
    expect(q.toSql()).toContain("SELECT * FROM users WHERE age > ?");
    expect(q.toRawSql()).toContain("age > 30");
  });
  it("explain runs", async () => {
    const rows = await qb().where("age", ">", 1).explain();
    expect(Array.isArray(rows)).toBe(true);
  });
  it("doesntExist", async () => {
    expect(await qb().where("name", "nobody").doesntExist()).toBe(true);
    expect(await qb().where("name", "Al").doesntExist()).toBe(false);
  });
});
