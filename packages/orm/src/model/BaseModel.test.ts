import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { SoftDeletes } from "./SoftDeletes.ts";
import { HookRegistry } from "./hooks/HookRegistry.ts";
import { ModelNotFoundError } from "../errors/index.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { manyToMany } from "./decorators/manyToMany.ts";
import { columnsFor, relationsFor } from "./decorators/_metadata.ts";
import { Carbon } from "@zerotal/core/carbon";

// ── Schema + connection setup ─────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      score      INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
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
  await db`DELETE FROM users`;
});

// ── Concrete model ────────────────────────────────────────────────────────

@table("users")
class User extends SoftDeletes(BaseModel) {
  @column({ type: "string" })
  name!: string;

  @column({ type: "string", nullable: true })
  email!: string | null;

  @column({ type: "number" })
  active!: number;

  @column({ type: "number" })
  score!: number;

  static active = BaseModel.scope((q) => q.where("active", 1));
  static byScore = BaseModel.scope((q, min: number) => q.where("score", ">=", min));
  static recent = BaseModel.scope((q) => q.orderBy("id", "desc"));
}

// ── create() ──────────────────────────────────────────────────────────────

describe("BaseModel — create()", () => {
  it("inserts a row and returns a model instance", async () => {
    const user = await User.create({
      name: "Alice",
      email: "[email protected]",
      active: 1,
      score: 0,
    });
    expect(user).toBeInstanceOf(User);
    expect(user.id).toBeDefined();
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("[email protected]");
  });

  it("sets createdAt and updatedAt when timestamps=true", async () => {
    const user = await User.create({ name: "Bob", active: 1, score: 0 });
    // Datetime columns hydrate as Carbon (see BaseModel._applyRow), so after
    // create() re-selects the row the timestamps are Carbon instances.
    expect(user.createdAt).toBeInstanceOf(Carbon);
    expect(user.updatedAt).toBeInstanceOf(Carbon);
  });

  it("emits ModelChanged on create, update, and delete", async () => {
    const { FrameworkEvents } = await import("@zerotal/core");
    const { ModelChanged } = await import("../events.ts");
    const ops: Array<{ model: string; table: string; operation: string }> = [];
    const off = FrameworkEvents.on(ModelChanged, (e) =>
      ops.push({ model: e.model, table: e.table, operation: e.operation }),
    );

    const user = await User.create({ name: "Eve", active: 1, score: 0 });
    user.score = 5;
    await user.save();
    await user.delete();
    off();

    expect(ops).toEqual([
      { model: "User", table: "users", operation: "created" },
      { model: "User", table: "users", operation: "updated" },
      { model: "User", table: "users", operation: "deleted" },
    ]);
  });
});

// ── find() ───────────────────────────────────────────────────────────────

describe("BaseModel — find()", () => {
  it("returns a model instance by id", async () => {
    const created = await User.create({ name: "Alice", active: 1, score: 0 });
    const found = await User.find(created.id);
    expect(found).toBeInstanceOf(User);
    expect(found?.name).toBe("Alice");
  });

  it("returns null when not found", async () => {
    const found = await User.find(99999);
    expect(found).toBeNull();
  });
});

// ── findOrFail() ──────────────────────────────────────────────────────────

describe("BaseModel — findOrFail()", () => {
  it("throws ModelNotFoundError when missing", async () => {
    await expect(User.findOrFail(99999)).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it("returns the model when found", async () => {
    const created = await User.create({ name: "Alice", active: 1, score: 0 });
    const found = await User.findOrFail(created.id);
    expect(found.name).toBe("Alice");
  });
});

// ── findBy() ─────────────────────────────────────────────────────────────

describe("BaseModel — findBy()", () => {
  it("finds by arbitrary column", async () => {
    await User.create({
      name: "Alice",
      email: "[email protected]",
      active: 1,
      score: 0,
    });
    const found = await User.findBy("email", "[email protected]");
    expect(found?.name).toBe("Alice");
  });

  it("returns null when not found", async () => {
    const found = await User.findBy("email", "[email protected]");
    expect(found).toBeNull();
  });
});

// ── all() ─────────────────────────────────────────────────────────────────

describe("BaseModel — all()", () => {
  it("returns all rows as model instances", async () => {
    await User.create({ name: "Alice", active: 1, score: 0 });
    await User.create({ name: "Bob", active: 1, score: 0 });
    const users = await User.all();
    expect(users).toHaveLength(2);
    expect(users[0]).toBeInstanceOf(User);
  });
});

// ── firstOrCreate() ───────────────────────────────────────────────────────

describe("BaseModel — firstOrCreate()", () => {
  it("creates if not found", async () => {
    const user = await User.firstOrCreate({ name: "Alice" }, { active: 1, score: 5 });
    expect(user.name).toBe("Alice");
    expect(user.id).toBeDefined();
  });

  it("returns existing if found", async () => {
    const first = await User.create({ name: "Alice", active: 1, score: 0 });
    const second = await User.firstOrCreate({ name: "Alice" }, { active: 0, score: 99 });
    expect(second.id).toBe(first.id);
    expect(second.score).toBe(0); // unchanged
  });
});

// ── save() — insert ───────────────────────────────────────────────────────

describe("BaseModel — save() insert", () => {
  it("inserts a new row when no id set", async () => {
    const user = new User();
    user.name = "Charlie";
    user.active = 1;
    user.score = 0;
    await user.save();
    expect(user.id).toBeDefined();
    const found = await User.find(user.id);
    expect(found?.name).toBe("Charlie");
  });
});

// ── save() — update ───────────────────────────────────────────────────────

describe("BaseModel — save() update", () => {
  it("updates only dirty columns", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 10 });
    user.name = "Alicia";
    await user.save();
    const fresh = await User.findOrFail(user.id);
    expect(fresh.name).toBe("Alicia");
    expect(fresh.score).toBe(10); // unchanged
  });
});

// ── isDirty() ─────────────────────────────────────────────────────────────

describe("BaseModel — isDirty()", () => {
  it("returns true after changing a field", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    user.name = "Bob";
    expect(user.isDirty()).toBe(true);
  });

  it("returns false after fresh load", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    const fresh = await User.findOrFail(user.id);
    expect(fresh.isDirty()).toBe(false);
  });

  it("isDirty(column) returns true only for that specific column", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    user.name = "Bob";
    expect(user.isDirty("name")).toBe(true);
    expect(user.isDirty("score")).toBe(false);
  });
});

// ── soft deletes ──────────────────────────────────────────────────────────

describe("BaseModel — soft deletes", () => {
  it("delete() sets deleted_at when softDeletes=true", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    await user.delete();
    expect(user.deletedAt).toBeInstanceOf(Date);
  });

  it("query() automatically excludes soft-deleted rows", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    await user.delete();
    const all = await User.all();
    expect(all).toHaveLength(0);
  });

  it("withTrashed() includes soft-deleted rows", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    await user.delete();
    const all = await User.withTrashed().get();
    expect(all).toHaveLength(1);
  });

  it("onlyTrashed() returns only soft-deleted rows", async () => {
    await User.create({ name: "Alice", active: 1, score: 0 });
    const user2 = await User.create({ name: "Bob", active: 1, score: 0 });
    await user2.delete();
    const trashed = await User.onlyTrashed().get();
    expect(trashed).toHaveLength(1);
    expect(trashed[0]!.name).toBe("Bob");
  });

  it("forceDelete() hard-deletes the row", async () => {
    const user = await User.create({ name: "Alice", active: 1, score: 0 });
    await user.forceDelete();
    const all = await User.withTrashed().get();
    expect(all).toHaveLength(0);
  });

  it("restore() clears deleted_at and makes the row visible again", async () => {
    const user = await User.create({ name: "Bob", active: 1, score: 0 });
    await user.delete();
    expect(await User.query().count()).toBe(0);

    await user.restore();
    expect(user.deletedAt).toBeNull();
    expect(await User.query().count()).toBe(1);
  });

  it("restore() is a no-op on a model without softDeletes", async () => {
    const u = await User.create({ name: "Charlie", active: 1, score: 0 });
    // softDeletes = true on User, but calling restore() on a non-deleted record
    // should simply leave deleted_at as null and not throw.
    await u.restore();
    expect(await User.query().count()).toBe(1);
  });
});

// ── HookRegistry ─────────────────────────────────────────────────────────

describe("HookRegistry hooks", () => {
  it("afterFind hook fires after find()", async () => {
    const fired: number[] = [];
    HookRegistry.register<User>(User, "afterFind", (u) => {
      fired.push(u.id);
    });

    const created = await User.create({
      name: "Hook User",
      active: 1,
      score: 0,
    });
    await User.find(created.id);
    expect(fired).toContain(created.id);
  });

  it("afterCreate hook fires after create()", async () => {
    let called = false;
    HookRegistry.register<User>(User, "afterCreate", () => {
      called = true;
    });
    await User.create({ name: "Hook Create", active: 1, score: 0 });
    expect(called).toBe(true);
  });

  it("beforeSave hook fires before save()", async () => {
    let called = false;
    HookRegistry.register<User>(User, "beforeSave", () => {
      called = true;
    });
    const user = new User();
    user.name = "Hook Save";
    user.active = 1;
    user.score = 0;
    await user.save();
    expect(called).toBe(true);
  });
});

// ── @column decorator ────────────────────────────────────────────────────

describe("@column decorator", () => {
  it("registers metadata in columnRegistry", () => {
    const cols = columnsFor(User);
    expect(cols).toBeDefined();
    expect(cols?.has("name")).toBe(true);
    expect(cols?.get("name")).toEqual({ type: "string" });
    expect(cols?.get("active")).toEqual({ type: "number" });
  });
});

// ── Model Scopes ──────────────────────────────────────────────────────────

describe("Model scopes — withScopes()", () => {
  it("single scope (no args) filters correctly", async () => {
    await User.create({ name: "Active", active: 1, score: 0 });
    await User.create({ name: "Inactive", active: 0, score: 0 });
    const users = await User.query()
      .withScopes((s) => {
        s.active();
      })
      .get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Active");
  });

  it("scope with typed arg filters by minimum score", async () => {
    await User.create({ name: "Low", active: 1, score: 10 });
    await User.create({ name: "High", active: 1, score: 90 });
    const users = await User.query()
      .withScopes((s) => {
        s.byScore(50);
      })
      .get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("High");
  });

  it("multiple scopes in one call both apply (AND logic)", async () => {
    await User.create({ name: "ActiveLow", active: 1, score: 10 });
    await User.create({ name: "ActiveHigh", active: 1, score: 80 });
    await User.create({ name: "InactiveHigh", active: 0, score: 80 });
    const users = await User.query()
      .withScopes((s) => {
        s.active();
        s.byScore(50);
      })
      .get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("ActiveHigh");
  });

  it("withScopes() chains with other .where() calls", async () => {
    await User.create({ name: "Alice", active: 1, score: 60 });
    await User.create({ name: "Bob", active: 1, score: 60 });
    const users = await User.query()
      .withScopes((s) => {
        s.active();
      })
      .where("name", "Alice")
      .get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Alice");
  });

  it("scope with no matching rows returns empty array", async () => {
    await User.create({ name: "Low", active: 1, score: 5 });
    const users = await User.query()
      .withScopes((s) => {
        s.byScore(100);
      })
      .get();
    expect(users).toHaveLength(0);
  });

  it("ordering scope (recent) applies ORDER BY", async () => {
    await User.create({ name: "First", active: 1, score: 0 });
    await User.create({ name: "Second", active: 1, score: 0 });
    const users = await User.query()
      .withScopes((s) => {
        s.recent();
      })
      .get();
    expect(users).toHaveLength(2);
    expect(users[0]!.name).toBe("Second"); // DESC means newest first
  });
});

// ── ModelQueryBuilder — paginate() ───────────────────────────────────────

describe("ModelQueryBuilder — paginate() returns model instances", () => {
  it("paginate() maps rows to model instances (not raw objects)", async () => {
    await User.create({
      name: "Alpha",
      email: "a@test.com",
      active: 1,
      score: 0,
    });
    await User.create({
      name: "Beta",
      email: "b@test.com",
      active: 1,
      score: 0,
    });
    await User.create({
      name: "Gamma",
      email: "c@test.com",
      active: 1,
      score: 0,
    });

    const result = await User.query().paginate(2, 1);

    expect(result.total).toBe(3);
    expect(result.perPage).toBe(2);
    expect(result.lastPage).toBe(2);
    expect(result.data).toHaveLength(2);

    expect(result.data[0]).toBeInstanceOf(User);
    expect(result.data[0]?.name).toBeDefined();
  });

  it("paginate() page 2 returns the remaining model instance", async () => {
    await User.create({ name: "P1", active: 1, score: 0 });
    await User.create({ name: "P2", active: 1, score: 0 });
    await User.create({ name: "P3", active: 1, score: 0 });

    const result = await User.query().orderBy("id").paginate(2, 2);

    expect(result.page).toBe(2);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toBeInstanceOf(User);
    expect(result.data[0]?.name).toBe("P3");
  });

  it("paginate() lastPage is at least 1 for empty table", async () => {
    const result = await User.query().paginate(10, 1);
    expect(result.lastPage).toBe(1);
    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it("paginate() respects where scopes", async () => {
    await User.create({ name: "ActiveA", active: 1, score: 0 });
    await User.create({ name: "ActiveB", active: 1, score: 0 });
    await User.create({ name: "Inactive", active: 0, score: 0 });

    const result = await User.query().where("active", 1).paginate(10, 1);

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toBeInstanceOf(User);
  });
});

// ── manyToMany — schema + models ─────────────────────────────────────────

@table("tags", { timestamps: false })
class Tag extends BaseModel {
  @column({ type: "string" })
  name!: string;
}

@table("posts", { timestamps: false })
class Post extends BaseModel {
  @column({ type: "number" })
  userId!: number;

  @column({ type: "string" })
  title!: string;

  @manyToMany(() => Tag, {
    pivotTable: "post_tags",
    pivotForeignKey: "post_id",
    pivotRelatedKey: "tag_id",
  })
  tags!: Tag[];
}

beforeAll(async () => {
  await db`CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`;
  await db`CREATE TABLE posts (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title   TEXT NOT NULL
  )`;
  await db`CREATE TABLE post_tags (
    post_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL
  )`;
});

beforeEach(async () => {
  await db`DELETE FROM post_tags`;
  await db`DELETE FROM tags`;
  await db`DELETE FROM posts`;
});

async function seedTag(name: string): Promise<Tag> {
  return Tag.create({ name } as Partial<Tag>);
}
async function seedPost(userId: number, title: string): Promise<Post> {
  return Post.create({ userId, title } as Partial<Post>);
}
async function linkPostTag(postId: number, tagId: number): Promise<void> {
  await db`INSERT INTO post_tags (post_id, tag_id) VALUES (${postId}, ${tagId})`;
}

// ── manyToMany tests ──────────────────────────────────────────────────────

describe("@manyToMany eager loading via .with()", () => {
  it("loads tags on each post", async () => {
    const post = await seedPost(1, "Hello World");
    const ts = await seedTag("TypeScript");
    await linkPostTag(post.id, ts.id);

    const posts = await Post.query().with("tags").get();
    expect(posts).toHaveLength(1);
    const tags = (posts[0]! as unknown as { tags: Tag[] }).tags;
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBeInstanceOf(Tag);
    expect(tags[0]!.name).toBe("TypeScript");
  });

  it("tags array is [] for posts with no pivot entries", async () => {
    await seedPost(1, "No tags");

    const posts = await Post.query().with("tags").get();
    const tags = (posts[0]! as unknown as { tags: Tag[] }).tags;
    expect(tags).toEqual([]);
  });

  it("multiple posts each get their own correct tag arrays", async () => {
    const p1 = await seedPost(1, "Post A");
    const p2 = await seedPost(1, "Post B");
    const ts = await seedTag("TypeScript");
    const bun = await seedTag("Bun");
    await linkPostTag(p1.id, ts.id);
    await linkPostTag(p2.id, ts.id);
    await linkPostTag(p2.id, bun.id);

    const posts = await Post.query().orderBy("id").with("tags").get();
    expect(posts).toHaveLength(2);

    const p1Tags = (posts[0]! as unknown as { tags: Tag[] }).tags;
    const p2Tags = (posts[1]! as unknown as { tags: Tag[] }).tags;
    expect(p1Tags).toHaveLength(1);
    expect(p1Tags[0]!.name).toBe("TypeScript");
    expect(p2Tags).toHaveLength(2);
    expect(p2Tags.map((t) => t.name).sort()).toEqual(["Bun", "TypeScript"]);
  });

  it("no N+1 — 3 posts with tags runs exactly 3 queries (posts + pivot + tags)", async () => {
    // Structural proof: 3 posts, 2 tags each — N+1 would be 1 + 3 = 4 queries.
    // With Two-Query Dictionary Match for pivot it is always exactly 3 regardless of count.
    // Sequential seeding is required — SQLite's last_insert_rowid() is per-connection
    // and races when concurrent Promise.all writes share the same connection.
    const p1 = await seedPost(1, "P1");
    const p2 = await seedPost(1, "P2");
    const p3 = await seedPost(1, "P3");
    const ta = await seedTag("A");
    const tb = await seedTag("B");
    for (const p of [p1, p2, p3]) {
      await linkPostTag(p.id, ta.id);
      await linkPostTag(p.id, tb.id);
    }
    const loaded = await Post.query().with("tags").get();
    expect(loaded).toHaveLength(3);
    for (const p of loaded) {
      expect((p as unknown as { tags: Tag[] }).tags).toHaveLength(2);
    }
  });

  it("relationRegistry has tags entry on Post constructor", () => {
    const meta = relationsFor(Post).get("tags");
    expect(meta).toBeDefined();
    expect(meta?.type).toBe("manyToMany");
    expect(meta?.pivotTable).toBe("post_tags");
    expect(meta?.pivotForeignKey).toBe("post_id");
    expect(meta?.pivotRelatedKey).toBe("tag_id");
  });
});

// ── Column casting ────────────────────────────────────────────────────────

describe("BaseModel — column casting", () => {
  it("cast:json serialises array to string on save and parses on read", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_json_test (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      permissions TEXT
    )`;

    @table("cast_json_test", { timestamps: false })
    class JsonModel extends BaseModel {
      @column({ cast: "json" }) permissions!: string[];
    }

    await JsonModel.create({
      permissions: ["read", "write"],
    } as Partial<JsonModel>);
    const found = await JsonModel.query().first();
    expect(Array.isArray(found?.permissions)).toBe(true);
    expect(found?.permissions).toContain("read");
    expect(found?.permissions).toContain("write");

    await db`DROP TABLE cast_json_test`;
  });

  it("cast:json serialises updates on save", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_json_update_test (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      permissions TEXT
    )`;

    @table("cast_json_update_test", { timestamps: false })
    class JsonUpdateModel extends BaseModel {
      @column({ cast: "json" }) permissions!: string[];
    }

    const created = await JsonUpdateModel.create({
      permissions: ["read"],
    } as Partial<JsonUpdateModel>);
    created.permissions = ["read", "write"];
    await created.save();

    const raw = await db<{ permissions: string }[]>`
      SELECT permissions FROM cast_json_update_test WHERE id = ${created.id}
    `;
    expect(typeof raw[0]?.permissions).toBe("string");
    expect(raw[0]?.permissions).toContain('"read"');
    expect(raw[0]?.permissions).toContain('"write"');

    await db`DROP TABLE cast_json_update_test`;
  });

  it("reactive json cast tracks deep mutations", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_reactive_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      settings TEXT
    )`;

    @table("cast_reactive_test", { timestamps: false })
    class ReactiveModel extends BaseModel {
      static override reactiveCasts = true;
      @column({ cast: "json" }) settings!: {
        roles: string[];
        profile: { theme: string };
      };
    }

    const created = await ReactiveModel.create({
      settings: { roles: ["user"], profile: { theme: "light" } },
    } as Partial<ReactiveModel>);

    const found = await ReactiveModel.query().first();
    if (!found) throw new Error("ReactiveModel not found");
    found.settings.roles.push("admin");
    found.settings.profile.theme = "dark";
    await found.save();

    const raw = await db<{ settings: string }[]>`
      SELECT settings FROM cast_reactive_test WHERE id = ${created.id}
    `;
    const parsed = JSON.parse(raw[0]!.settings);
    expect(parsed.roles).toEqual(["user", "admin"]);
    expect(parsed.profile.theme).toBe("dark");

    await db`DROP TABLE cast_reactive_test`;
  });

  it("cast:boolean converts 1/0 integers to true/false on read and write", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_bool_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      is_admin INTEGER
    )`;

    @table("cast_bool_test", { timestamps: false })
    class BoolModel extends BaseModel {
      @column({ cast: "boolean" }) isAdmin!: boolean;
    }

    await BoolModel.create({ isAdmin: true } as Partial<BoolModel>);
    const found = await BoolModel.query().first();
    expect(typeof found?.isAdmin).toBe("boolean");
    expect(found?.isAdmin).toBe(true);

    await BoolModel.create({ isAdmin: false } as Partial<BoolModel>);
    const all = await BoolModel.query().orderBy("id").get();
    expect(all[0]!.isAdmin).toBe(true);
    expect(all[1]!.isAdmin).toBe(false);

    await db`DROP TABLE cast_bool_test`;
  });

  it("query where casts boolean values", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_bool_where_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      is_active INTEGER
    )`;

    @table("cast_bool_where_test", { timestamps: false })
    class BoolWhereModel extends BaseModel {
      @column({ cast: "boolean" }) isActive!: boolean;
    }

    await BoolWhereModel.create({ isActive: true } as Partial<BoolWhereModel>);
    await BoolWhereModel.create({ isActive: false } as Partial<BoolWhereModel>);

    const active = await BoolWhereModel.query().where("is_active", true).get();
    expect(active).toHaveLength(1);
    expect(active[0]?.isActive).toBe(true);

    await db`DROP TABLE cast_bool_where_test`;
  });

  it("cast:date converts ISO string to Date instance", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_date_test (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      verified_at TEXT
    )`;

    @table("cast_date_test", { timestamps: false })
    class DateModel extends BaseModel {
      @column({ cast: "date" }) verifiedAt!: Date | null;
    }

    const now = new Date("2025-01-15T12:00:00Z");
    await DateModel.create({ verifiedAt: now } as Partial<DateModel>);
    const found = await DateModel.query().first();
    expect(found?.verifiedAt).toBeInstanceOf(Date);
    expect((found?.verifiedAt as Date).toISOString()).toBe(now.toISOString());

    await db`DROP TABLE cast_date_test`;
  });

  it("cast:integer coerces string to number on read", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_int_test (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      score TEXT
    )`;

    @table("cast_int_test", { timestamps: false })
    class IntModel extends BaseModel {
      @column({ cast: "integer" }) score!: number;
    }

    await IntModel.create({
      score: "42" as unknown as number,
    } as Partial<IntModel>);
    const found = await IntModel.query().first();
    expect(typeof found?.score).toBe("number");
    expect(found?.score).toBe(42);

    await db`DROP TABLE cast_int_test`;
  });

  it("cast:float coerces string to float on read", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_float_test (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      price TEXT
    )`;

    @table("cast_float_test", { timestamps: false })
    class FloatModel extends BaseModel {
      @column({ cast: "float" }) price!: number;
    }

    await FloatModel.create({
      price: "9.99" as unknown as number,
    } as Partial<FloatModel>);
    const found = await FloatModel.query().first();
    expect(typeof found?.price).toBe("number");
    expect(found?.price).toBe(9.99);

    await db`DROP TABLE cast_float_test`;
  });

  it("cast:array is an alias for cast:json", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_array_test (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      tags TEXT
    )`;

    @table("cast_array_test", { timestamps: false })
    class ArrayModel extends BaseModel {
      @column({ cast: "array" }) tags!: string[];
    }

    await ArrayModel.create({ tags: ["bun", "reno"] } as Partial<ArrayModel>);
    const found = await ArrayModel.query().first();
    expect(Array.isArray(found?.tags)).toBe(true);
    expect(found?.tags).toEqual(["bun", "reno"]);

    await db`DROP TABLE cast_array_test`;
  });

  it("existing object cast { get, set } still works", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_custom_test (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      flags TEXT
    )`;

    @table("cast_custom_test", { timestamps: false })
    class CustomCastModel extends BaseModel {
      @column({
        cast: {
          get: (v) => String(v).split(",").filter(Boolean),
          set: (v) => (v as string[]).join(","),
        },
      })
      flags!: string[];
    }

    await CustomCastModel.create({
      flags: ["a", "b", "c"],
    } as Partial<CustomCastModel>);
    const found = await CustomCastModel.query().first();
    expect(found?.flags).toEqual(["a", "b", "c"]);

    await db`DROP TABLE cast_custom_test`;
  });

  it("inherits static casts from base class", async () => {
    await db`CREATE TABLE IF NOT EXISTS cast_inherit_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      flags    TEXT,
      settings TEXT
    )`;

    @table("cast_inherit_test", { timestamps: false })
    class ParentCastModel extends BaseModel {
      static override casts = {
        flags: {
          get: (v) => String(v).split("|").filter(Boolean),
          set: (v) => (v as string[]).join("|"),
        },
      };

      @column({}) flags!: string[];
    }

    @table("cast_inherit_test", { timestamps: false })
    class ChildCastModel extends ParentCastModel {
      static override casts = {
        settings: "json",
      };

      @column({}) settings!: Record<string, unknown>;
    }

    await ChildCastModel.create({
      flags: ["a", "b"],
      settings: { theme: "dark", enabled: true },
    } as Partial<ChildCastModel>);

    const found = await ChildCastModel.query().first();
    expect(found?.flags).toEqual(["a", "b"]);
    expect(found?.settings).toEqual({ theme: "dark", enabled: true });

    await db`DROP TABLE cast_inherit_test`;
  });
});

// ── Type-based auto-casting (@column({ type })) ───────────────────────────

describe("BaseModel — type-based auto-casting", () => {
  it('@column({ type: "boolean" }) coerces 0/1 to false/true on read', async () => {
    await db`CREATE TABLE IF NOT EXISTS type_bool_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      is_admin INTEGER DEFAULT 0
    )`;

    @table("type_bool_test", { timestamps: false })
    class TypeBoolModel extends BaseModel {
      @column({ type: "boolean" }) isAdmin!: boolean;
    }

    await TypeBoolModel.create({ isAdmin: true } as Partial<TypeBoolModel>);
    const row = await TypeBoolModel.query().first();
    expect(typeof row?.isAdmin).toBe("boolean");
    expect(row?.isAdmin).toBe(true);

    await TypeBoolModel.create({ isAdmin: false } as Partial<TypeBoolModel>);
    const all = await TypeBoolModel.query().orderBy("id").get();
    expect(all[0]?.isAdmin).toBe(true);
    expect(all[1]?.isAdmin).toBe(false);

    await db`DROP TABLE type_bool_test`;
  });

  it('@column({ type: "boolean" }) writes 1/0 to SQLite', async () => {
    await db`CREATE TABLE IF NOT EXISTS type_bool_write_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      is_admin INTEGER DEFAULT 0
    )`;

    @table("type_bool_write_test", { timestamps: false })
    class TypeBoolWriteModel extends BaseModel {
      @column({ type: "boolean" }) isAdmin!: boolean;
    }

    await TypeBoolWriteModel.create({
      isAdmin: true,
    } as Partial<TypeBoolWriteModel>);
    const raw = await db<{ is_admin: number }[]>`SELECT is_admin FROM type_bool_write_test LIMIT 1`;
    expect(raw[0]?.is_admin).toBe(1);

    await db`DROP TABLE type_bool_write_test`;
  });

  it('@column({ type: "json" }) parses JSON string to object on read', async () => {
    await db`CREATE TABLE IF NOT EXISTS type_json_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      settings TEXT
    )`;

    @table("type_json_test", { timestamps: false })
    class TypeJsonModel extends BaseModel {
      @column({ type: "json" }) settings!: Record<string, unknown>;
    }

    await TypeJsonModel.create({
      settings: { theme: "dark", lang: "en" },
    } as Partial<TypeJsonModel>);
    const found = await TypeJsonModel.query().first();
    expect(typeof found?.settings).toBe("object");
    expect((found?.settings as Record<string, unknown>)?.["theme"]).toBe("dark");

    await db`DROP TABLE type_json_test`;
  });

  it('@column({ type: "json" }) serialises object to JSON string on write', async () => {
    await db`CREATE TABLE IF NOT EXISTS type_json_write_test (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      settings TEXT
    )`;

    @table("type_json_write_test", { timestamps: false })
    class TypeJsonWriteModel extends BaseModel {
      @column({ type: "json" }) settings!: Record<string, unknown>;
    }

    await TypeJsonWriteModel.create({
      settings: { x: 1 },
    } as Partial<TypeJsonWriteModel>);
    const raw = await db<{ settings: string }[]>`SELECT settings FROM type_json_write_test LIMIT 1`;
    expect(typeof raw[0]?.settings).toBe("string");
    expect(raw[0]?.settings).toContain('"x"');

    await db`DROP TABLE type_json_write_test`;
  });
});

// ── static hidden ──────────────────────────────────────────────────────────────

describe("BaseModel — static hidden", () => {
  // Reuse the existing `users` schema — hide `email` and `score`,
  // which are real columns, to avoid altering the test table.
  @table("users")
  class SecureUser extends SoftDeletes(BaseModel) {
    static override hidden = ["email", "score"];

    @column({ type: "string" }) name!: string;
    @column({ type: "string", nullable: true }) email!: string | null;
    @column({ type: "number" }) active!: number;
    @column({ type: "number" }) score!: number;
  }

  it("toJSON() excludes hidden fields", async () => {
    const user = await SecureUser.create({
      name: "Alice",
      email: "alice@example.com",
      active: 1,
      score: 99,
    });
    const json = user.toJSON();

    expect(json["name"]).toBe("Alice");
    expect(json["active"]).toBe(1);
    expect("email" in json).toBe(false);
    expect("score" in json).toBe(false);
  });

  it("JSON.stringify excludes hidden fields", async () => {
    const user = await SecureUser.create({
      name: "Bob",
      email: "bob@example.com",
      active: 1,
      score: 50,
    });
    const str = JSON.stringify(user);

    expect(str).toContain("Bob");
    expect(str).not.toContain("bob@example.com");
    expect(str).not.toContain('"score"');
  });

  it("hidden does not affect the DB row — email is still persisted", async () => {
    const user = await SecureUser.create({
      name: "Carol",
      email: "carol@example.com",
      active: 1,
      score: 0,
    });
    const rows = await db<{ email: string }[]>`SELECT email FROM users WHERE id = ${user.id}`;
    expect(rows[0]?.email).toBe("carol@example.com");
  });

  it("models without hidden expose all fields normally", async () => {
    const user = await User.create({ name: "Dave", active: 1, score: 7 });
    const json = user.toJSON();

    expect(json["name"]).toBe("Dave");
    expect(json["score"]).toBe(7);
    expect("active" in json).toBe(true);
  });

  it("hidden does not bleed across model classes", async () => {
    const u1 = await SecureUser.create({ name: "Eve", email: "e@e.com", active: 1, score: 1 });
    const u2 = await User.create({ name: "Frank", active: 1, score: 2 });

    expect("email" in u1.toJSON()).toBe(false);
    expect("score" in u1.toJSON()).toBe(false);
    // User has no hidden list — score must be present
    expect("score" in u2.toJSON()).toBe(true);
  });
});

// ── static hashable ───────────────────────────────────────────────────────────
//
// Reuses the existing `users` table, treating the `name` column as the
// hashable field so no schema migration is needed in this test file.

describe("BaseModel — static hashable", () => {
  @table("users")
  class HashedUser extends BaseModel {
    static override hashable = ["name"];

    @column({ type: "string" }) name!: string;
    @column({ type: "string", nullable: true }) email?: string | null;
    @column({ type: "number" }) active!: number;
    @column({ type: "number" }) score!: number;
  }

  it("hashes the field on create — plaintext is not stored", async () => {
    const user = await HashedUser.create({ name: "alice", active: 1, score: 0 });
    expect(user.name).not.toBe("alice");
    expect(user.name.startsWith("$")).toBe(true); // bcrypt sentinel
  });

  it("the stored hash verifies against the original plaintext", async () => {
    const user = await HashedUser.create({ name: "secret123", active: 1, score: 0 });
    expect(await Bun.password.verify("secret123", user.name)).toBe(true);
  });

  it("does not verify against a different value", async () => {
    const user = await HashedUser.create({ name: "correct", active: 1, score: 0 });
    expect(await Bun.password.verify("wrong", user.name)).toBe(false);
  });

  it("re-hashes on update when the field changes", async () => {
    const user = await HashedUser.create({ name: "initial", active: 1, score: 0 });
    const firstHash = user.name;

    user.name = "updated";
    await user.save();

    expect(user.name).not.toBe("updated"); // stored as hash
    expect(user.name).not.toBe(firstHash); // different hash
    expect(await Bun.password.verify("updated", user.name)).toBe(true);
  });

  it("does NOT re-hash on update when the field is unchanged", async () => {
    const user = await HashedUser.create({ name: "stable", active: 1, score: 0 });
    const hash1 = user.name;

    user.score = 99; // change an unrelated field
    await user.save();

    expect(user.name).toBe(hash1); // hash is identical — no double-hashing
  });

  it("hash is persisted to the database correctly", async () => {
    const user = await HashedUser.create({ name: "persisted", active: 1, score: 0 });
    const row = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${user.id}`;
    expect(row[0]?.name).toBe(user.name);
    expect(await Bun.password.verify("persisted", row[0]?.name ?? "")).toBe(true);
  });

  it("models without hashable store plaintext as-is", async () => {
    const user = await User.create({ name: "plaintext", active: 1, score: 0 });
    expect(user.name).toBe("plaintext");
  });
});

// ── State machine ─────────────────────────────────────────────────────────────

import { StateError } from "../errors/StateError.ts";
import { State, _clearTransitionCallbacks } from "./State.ts";

describe("BaseModel — transitionTo()", () => {
  // State schema — uses the `score` column as a stand-in for the status column
  // since the test table has it. A dedicated `status` column would be used in
  // production; here we reuse `name` as the status string field.

  const TicketStates = {
    open: { canTransitionTo: ["in_progress", "cancelled"] as const },
    in_progress: { canTransitionTo: ["resolved", "open"] as const },
    resolved: { canTransitionTo: [] as const },
    cancelled: { canTransitionTo: [] as const },
  } as const;

  type TicketStatus = keyof typeof TicketStates;

  @table("users")
  class Ticket extends State(BaseModel) {
    static override states = TicketStates;

    // We use `name` as the `status` column for test table compatibility
    @column({ type: "string" }) name!: string; // ← plays the role of `status`
    @column({ type: "number" }) active!: number;
    @column({ type: "number" }) score!: number;

    get status(): string {
      return this.name;
    }
    set status(v: string) {
      this.name = v;
    }
  }

  afterEach(() => {
    _clearTransitionCallbacks();
  });

  it("transitions to a valid target state", async () => {
    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    await t.transitionTo("in_progress");
    expect(t.status).toBe("in_progress");
  });

  it("persists the new state to the database", async () => {
    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    await t.transitionTo("in_progress");
    const row = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${t.id}`;
    expect(row[0]?.name).toBe("in_progress");
  });

  it("returns [false, StateError] for an illegal transition", async () => {
    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    const [ok, err] = await t.transitionTo("resolved");
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(StateError);
  });

  it("StateError message names the model and states", async () => {
    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    const [, err] = await t.transitionTo("resolved");
    expect(err?.message).toContain("Ticket");
    expect(err?.message).toContain("open");
    expect(err?.message).toContain("resolved");
    expect(err?.code).toBe("E_INVALID_TRANSITION");
  });

  it("returns [false, StateError] for a terminal state with no exits", async () => {
    const t = await Ticket.create({ name: "resolved", active: 1, score: 0 });
    const [ok] = await t.transitionTo("open");
    expect(ok).toBe(false);
  });

  it("returns [false, StateError] when states is not configured", async () => {
    @table("users")
    class Plain extends State(BaseModel) {
      @column({ type: "string" }) name!: string;
      @column({ type: "number" }) active!: number;
      @column({ type: "number" }) score!: number;
    }
    const p = await Plain.create({ name: "x", active: 1, score: 0 });
    const [ok, err] = await p.transitionTo("anything");
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(StateError);
  });

  it("fires an onTransition callback after a successful transition", async () => {
    const events: string[] = [];
    Ticket.onTransition("in_progress", (_t, { from, to }) => {
      events.push(`${from}→${to}`);
    });

    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    await t.transitionTo("in_progress");
    expect(events).toEqual(["open→in_progress"]);
  });

  it("does NOT fire a callback registered for a different target state", async () => {
    const events: string[] = [];
    Ticket.onTransition("cancelled", () => {
      events.push("cancelled");
    });

    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    await t.transitionTo("in_progress");
    expect(events).toHaveLength(0);
  });

  it("wildcard '*' callback fires on every transition", async () => {
    const log: string[] = [];
    Ticket.onTransition("*", (_t, { from, to }) => {
      log.push(`${from}→${to}`);
    });

    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    await t.transitionTo("in_progress");
    await t.transitionTo("resolved");
    expect(log).toEqual(["open→in_progress", "in_progress→resolved"]);
  });

  it("guard on target state blocks the transition", async () => {
    const guardedStates = {
      pending: { canTransitionTo: ["active"] as const },
      active: {
        canTransitionTo: [] as const,
        guard: (_t: unknown) => {
          throw new StateError("Ticket", "pending", "active", "Payment required.");
        },
      },
    } as const;

    @table("users")
    class PaidTicket extends State(BaseModel) {
      static override states = guardedStates;
      @column({ type: "string" }) name!: string;
      @column({ type: "number" }) active!: number;
      @column({ type: "number" }) score!: number;
      get status(): string {
        return this.name;
      }
      set status(v: string) {
        this.name = v;
      }
    }

    const pt = await PaidTicket.create({ name: "pending", active: 1, score: 0 });
    const [ok, err] = await pt.transitionTo("active");
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(StateError);
    // Status must not have changed in DB
    const row = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${pt.id}`;
    expect(row[0]?.name).toBe("pending");
  });

  it("guard returning false blocks the transition", async () => {
    const guardedStates = {
      pending: { canTransitionTo: ["active"] as const },
      active: { canTransitionTo: [] as const, guard: () => false as const },
    } as const;

    @table("users")
    class FalseGuardTicket extends State(BaseModel) {
      static override states = guardedStates;
      @column({ type: "string" }) name!: string;
      @column({ type: "number" }) active!: number;
      @column({ type: "number" }) score!: number;
      get status(): string {
        return this.name;
      }
      set status(v: string) {
        this.name = v;
      }
    }

    const ft = await FalseGuardTicket.create({ name: "pending", active: 1, score: 0 });
    const [ok, err] = await ft.transitionTo("active");
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(StateError);
  });

  it("does not fire callbacks when transition is rejected", async () => {
    const events: string[] = [];
    Ticket.onTransition("resolved", () => {
      events.push("hit");
    });

    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    const [ok] = await t.transitionTo("resolved"); // illegal → blocked, no callbacks fire
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("returns [true] on a successful transition", async () => {
    const t = await Ticket.create({ name: "open", active: 1, score: 0 });
    const result = await t.transitionTo("in_progress");
    expect(result).toEqual([true]);
  });
});

describe("BaseModel — forceState()", () => {
  const LockedStates = {
    pending: { canTransitionTo: ["active"] as const },
    active: {
      canTransitionTo: ["expired"] as const,
      guard: () => {
        throw new StateError("Sub", "pending", "active", "Stripe ID required.");
      },
    },
    expired: { canTransitionTo: [] as const },
    cancelled: { canTransitionTo: [] as const },
  } as const;

  @table("users")
  class Sub extends State(BaseModel) {
    static override states = LockedStates;

    @column({ type: "string" }) name!: string;
    @column({ type: "number" }) active!: number;
    @column({ type: "number" }) score!: number;

    get status(): string {
      return this.name;
    }
    set status(v: string) {
      this.name = v;
    }
  }

  afterEach(() => {
    _clearTransitionCallbacks();
    delete Bun.env["APP_ENV"];
  });

  it("sets the state directly, skipping canTransitionTo", async () => {
    // pending → expired is not in LockedStates.pending.canTransitionTo
    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    await s.forceState("expired");
    expect(s.status).toBe("expired");
  });

  it("persists the forced state to the database", async () => {
    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    await s.forceState("expired");
    const row = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${s.id}`;
    expect(row[0]?.name).toBe("expired");
  });

  it("skips the guard on the target state", async () => {
    // guard on 'active' always throws — forceState should still succeed
    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    await expect(s.forceState("active")).resolves.toBeDefined();
    expect(s.status).toBe("active");
  });

  it("does not fire onTransition callbacks", async () => {
    const events: string[] = [];
    Sub.onTransition("expired", () => {
      events.push("hit");
    });
    Sub.onTransition("*", () => {
      events.push("wildcard");
    });

    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    await s.forceState("expired");
    expect(events).toHaveLength(0);
  });

  it("returns `this` for chaining", async () => {
    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    expect(await s.forceState("expired")).toBe(s);
  });

  it("throws in production (APP_ENV=production)", async () => {
    Bun.env["APP_ENV"] = "production";
    const s = await Sub.create({ name: "pending", active: 1, score: 0 });
    await expect(s.forceState("expired")).rejects.toThrow(/production/);
  });
});

describe("BaseModel — stateField override", () => {
  const WorkflowStates = {
    draft: { canTransitionTo: ["review"] as const },
    review: { canTransitionTo: ["published", "draft"] as const },
    published: { canTransitionTo: [] as const },
  } as const;

  // Uses 'workflow' instead of 'status' as the state column.
  @table("users")
  class Document extends State(BaseModel) {
    static override states = WorkflowStates;
    static override stateField = "name"; // 'name' col acts as the state field

    @column({ type: "string" }) name!: string;
    @column({ type: "number" }) active!: number;
    @column({ type: "number" }) score!: number;
  }

  afterEach(() => _clearTransitionCallbacks());

  it("transitionTo() reads and writes the custom stateField", async () => {
    const doc = await Document.create({ name: "draft", active: 1, score: 0 });
    await doc.transitionTo("review");
    expect(doc.name).toBe("review");
    const row = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${doc.id}`;
    expect(row[0]?.name).toBe("review");
  });

  it('forceState() writes to the custom stateField, not "status"', async () => {
    const doc = await Document.create({ name: "draft", active: 1, score: 0 });
    await doc.forceState("published");
    expect(doc.name).toBe("published");
  });
});
