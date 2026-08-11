import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { hasMany } from "./decorators/hasMany.ts";
import type { HasMany } from "./relations/RelationRegistry.ts";

let db: SQLInstance;
beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, password TEXT, balance INTEGER DEFAULT 0, price TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, total INTEGER, created_at TEXT, updated_at TEXT)`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  await db`DELETE FROM orders`;
  await db`DELETE FROM users`;
  await db`DELETE FROM sqlite_sequence`;
});

class Order extends BaseModel {
  static override table = "orders";
  userId!: number;
  total!: number;
}
@table("users")
class User extends BaseModel {
  static override hidden = ["password"];
  static appends = ["displayName"];
  @column() name!: string;
  @column() email!: string | null;
  @column() password!: string;
  @column("integer") balance!: number;
  @column("decimal:2") price!: string;
  @hasMany(() => Order, { foreignKey: "user_id" }) orders!: HasMany<Order>;
  get displayName(): string {
    return `User: ${this.name}`;
  }
}

describe("static factory methods", () => {
  it("updateOrCreate updates existing", async () => {
    await User.create({ name: "Al", email: "al@x.com" } as never);
    const u = await User.updateOrCreate({ email: "al@x.com" } as never, { name: "Alice" } as never);
    expect(u.name).toBe("Alice");
    expect(await User.query().count()).toBe(1);
  });
  it("updateOrCreate creates new", async () => {
    const u = await User.updateOrCreate(
      { email: "new@x.com" } as never,
      { name: "Newbie" } as never,
    );
    expect(u.id).toBeGreaterThan(0);
    expect(u.name).toBe("Newbie");
  });
  it("firstOrNew returns unsaved", async () => {
    const u = await User.firstOrNew({ email: "ghost@x.com" } as never, { name: "Ghost" } as never);
    expect(u.name).toBe("Ghost");
    expect(await User.query().count()).toBe(0);
  });
  it("findOrNew", async () => {
    const u = await User.findOrNew(999);
    expect(u).toBeInstanceOf(User);
    expect(await User.query().count()).toBe(0);
  });
  it("createMany + findMany", async () => {
    const created = await User.createMany([{ name: "A" }, { name: "B" }, { name: "C" }] as never);
    expect(created.length).toBe(3);
    const found = await User.findMany([created[0]!.id, created[2]!.id]);
    expect(found.map((u: any) => u.name).sort()).toEqual(["A", "C"]);
  });
});

describe("instance utilities", () => {
  it("replicate makes unsaved copy without id", async () => {
    const u = await User.create({ name: "Orig", email: "o@x.com" } as never);
    const copy = u.replicate();
    expect(copy.id).toBeUndefined();
    expect(copy.name).toBe("Orig");
    await copy.save();
    expect(copy.id).toBeGreaterThan(0);
    expect(await User.query().count()).toBe(2);
  });
  it("is / isNot", async () => {
    const a = await User.create({ name: "A" } as never);
    const aAgain = await User.find(a.id);
    const b = await User.create({ name: "B" } as never);
    expect(a.is(aAgain)).toBe(true);
    expect(a.is(b)).toBe(false);
    expect(a.isNot(b)).toBe(true);
  });
  it("refresh mutates in place", async () => {
    const u = await User.create({ name: "A", balance: 5 } as never);
    await User.query().where("id", u.id).update({ name: "Changed" });
    await u.refresh();
    expect(u.name).toBe("Changed");
  });
  it("increment / decrement", async () => {
    const u = await User.create({ name: "A", balance: 10 } as never);
    await u.increment("balance", 5);
    expect(u.balance).toBe(15);
    expect(await User.query().where("id", u.id).value("balance")).toBe(15);
    await u.decrement("balance", 3);
    expect(u.balance).toBe(12);
  });
  it("touch bumps updated_at", async () => {
    const u = await User.create({ name: "A" } as never);
    const before = (u.updatedAt as any)?.valueOf?.() ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    await u.touch();
    expect((u.updatedAt as any).valueOf()).toBeGreaterThan(before);
  });
  it("loadCount", async () => {
    const u = await User.create({ name: "A" } as never);
    await Order.create({ userId: u.id, total: 10 } as never);
    await Order.create({ userId: u.id, total: 20 } as never);
    await u.loadCount("orders");
    expect((u as any).ordersCount).toBe(2);
  });
  it("loadSum", async () => {
    const u = await User.create({ name: "A" } as never);
    await Order.create({ userId: u.id, total: 10 } as never);
    await Order.create({ userId: u.id, total: 20 } as never);
    await u.loadSum("orders", "total");
    expect((u as any).ordersSumTotal).toBe(30);
  });
});

describe("serialization", () => {
  it("hidden + appends in toJSON", async () => {
    const u = await User.create({ name: "Al", email: "a@x.com", password: "secret" } as never);
    const json = u.toJSON();
    expect(json.password).toBeUndefined();
    expect(json.displayName).toBe("User: Al");
    expect(json.name).toBe("Al");
  });
  it("makeVisible reveals hidden", async () => {
    const u = await User.create({ name: "Al", password: "secret" } as never);
    const json = u.makeVisible("password").toJSON();
    expect(json.password).toBe("secret");
  });
  it("makeHidden hides extra", async () => {
    const u = await User.create({ name: "Al", email: "a@x.com" } as never);
    const json = u.makeHidden("email").toJSON();
    expect(json.email).toBeUndefined();
  });
  it("append adds accessor per-instance", async () => {
    const u = await User.create({ name: "Al" } as never);
    (u as any).extra = "x";
    const json = u.append("displayName").toJSON();
    expect(json.displayName).toBe("User: Al");
  });
});

describe("casts", () => {
  it("decimal:2 cast", async () => {
    const u = await User.create({ name: "A", price: 12.5 } as never);
    const reloaded = await User.find(u.id);
    expect(reloaded!.price).toBe("12.50");
  });
});

describe("named connections", () => {
  it("registerConnection + static connection", async () => {
    const db2 = new SQL(":memory:");
    await db2`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, password TEXT, balance INTEGER DEFAULT 0, price TEXT, created_at TEXT, updated_at TEXT)`;
    BaseModel.registerConnection("secondary", db2);
    @table("users")
    class TenantUser extends BaseModel {
      static override connection = "secondary";
      @column() name!: string;
    }
    await TenantUser.create({ name: "OnDb2" } as never);
    expect(await TenantUser.query().count()).toBe(1);
    expect(await User.query().count()).toBe(0); // primary db untouched
    await db2.end();
  });
});

// ── withoutTimestamps() ───────────────────────────────────────────────────────

describe("withoutTimestamps()", () => {
  it("disables timestamps during the callback", async () => {
    expect(User.timestamps).toBe(true);
    let timestampsDuring = true;
    await User.withoutTimestamps(async () => {
      timestampsDuring = User.timestamps;
    });
    expect(timestampsDuring).toBe(false);
    expect(User.timestamps).toBe(true);
  });

  it("restores timestamps even if the callback throws", async () => {
    await expect(
      User.withoutTimestamps(async () => {
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");
    expect(User.timestamps).toBe(true);
  });
});

// ── createMany() / saveMany() ─────────────────────────────────────────────────

describe("createMany()", () => {
  it("creates multiple records and returns them", async () => {
    const users = await User.createMany([{ name: "Alice" } as never, { name: "Bob" } as never]);
    expect(users).toHaveLength(2);
    expect(users[0]!.name).toBe("Alice");
    expect(users[1]!.name).toBe("Bob");
    expect(await User.query().count()).toBe(2);
  });
});

describe("saveMany()", () => {
  it("persists all provided model instances", async () => {
    const a = await User.create({ name: "A" } as never);
    const b = await User.create({ name: "B" } as never);
    a.name = "A2";
    b.name = "B2";
    await User.saveMany([a, b]);
    expect((await User.find(a.id))!.name).toBe("A2");
    expect((await User.find(b.id))!.name).toBe("B2");
  });
});

// ── findMany() ────────────────────────────────────────────────────────────────

describe("findMany()", () => {
  it("returns an empty array for an empty id list", async () => {
    const result = await User.findMany([]);
    expect(result).toEqual([]);
  });

  it("returns matching records for a list of ids", async () => {
    const a = await User.create({ name: "A" } as never);
    const b = await User.create({ name: "B" } as never);
    await User.create({ name: "C" } as never);
    const found = await User.findMany([a.id, b.id]);
    expect(found).toHaveLength(2);
    const names = found.map((u) => u.name).sort();
    expect(names).toEqual(["A", "B"]);
  });
});

// ── upsert() ──────────────────────────────────────────────────────────────────
// Use a dedicated table with a UNIQUE constraint for upsert tests.

let upsertSetup = false;

async function ensureUpsertTable() {
  if (upsertSetup) return;
  await db`CREATE TABLE IF NOT EXISTS upsert_items (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    slug  TEXT    NOT NULL UNIQUE,
    title TEXT    NOT NULL
  )`;
  upsertSetup = true;
}

@table("upsert_items", { timestamps: false })
class UpsertItem extends BaseModel {
  @column() slug!: string;
  @column() title!: string;
}

describe("upsert()", () => {
  it("inserts when no conflict exists", async () => {
    await ensureUpsertTable();
    await db`DELETE FROM upsert_items`;
    await UpsertItem.upsert({ slug: "new-slug", title: "New" } as never, ["slug"], ["title"]);
    expect(await UpsertItem.query().where("slug", "new-slug").count()).toBe(1);
  });

  it("updates on conflict", async () => {
    await ensureUpsertTable();
    await db`DELETE FROM upsert_items`;
    await UpsertItem.create({ slug: "existing", title: "Original" } as never);
    await UpsertItem.upsert({ slug: "existing", title: "Updated" } as never, ["slug"], ["title"]);
    const found = await UpsertItem.query().where("slug", "existing").first();
    expect(found!.title).toBe("Updated");
  });
});

// ── fresh() / refresh() / replicate() / touch() ──────────────────────────────

describe("fresh()", () => {
  it("returns a new instance with fresh data from DB", async () => {
    const u = await User.create({ name: "Original" } as never);
    await db`UPDATE users SET name = 'Modified' WHERE id = ${u.id}`;
    const fresh = await u.fresh();
    expect(fresh.name).toBe("Modified");
    expect(fresh).not.toBe(u); // different object
  });
});

describe("refresh()", () => {
  it("updates the current instance attributes from DB", async () => {
    const u = await User.create({ name: "Before" } as never);
    await db`UPDATE users SET name = 'After' WHERE id = ${u.id}`;
    const returned = await u.refresh();
    expect(u.name).toBe("After");
    expect(returned).toBe(u); // same instance
  });
});

describe("replicate()", () => {
  it("returns a new unsaved instance without primary key", async () => {
    const u = await User.create({ name: "Original", email: "e@x.com" } as never);
    const copy = u.replicate();
    expect(copy).not.toBe(u);
    expect((copy as any).id).toBeUndefined();
    expect(copy.name).toBe("Original");
    expect(copy.email).toBe("e@x.com");
  });

  it("replicate(except) omits specified keys", async () => {
    const u = await User.create({ name: "Bob", email: "b@x.com" } as never);
    const copy = u.replicate(["email"]);
    expect(copy.email).toBeUndefined();
    expect(copy.name).toBe("Bob");
  });
});

describe("touch()", () => {
  it("updates updated_at on a timestamps-enabled model", async () => {
    const u = await User.create({ name: "Touch Me" } as never);
    // updatedAt is Carbon after create (no getTime); normalise to epoch ms
    const toMs = (d: Date | undefined) => (d ? ((d as any).toDate?.() ?? d).getTime() : 0);
    const beforeMs = toMs(u.updatedAt);
    await new Promise((r) => setTimeout(r, 10));
    await u.touch();
    expect(toMs(u.updatedAt)).toBeGreaterThan(beforeMs);
  });

  it("is a no-op when timestamps are disabled", async () => {
    @table("users", { timestamps: false })
    class NoTsUser extends BaseModel {
      @column() name!: string;
    }
    const u = await NoTsUser.create({ name: "NoTs" } as never);
    const result = await u.touch();
    expect(result).toBe(u);
  });
});

describe("makeVisible() un-hides without becoming an allow-list", () => {
  class Account extends BaseModel {
    static override table = "accounts";
    static override hidden = ["password"];
    name!: string;
    email!: string;
    password!: string;
  }

  function account(): Account {
    const a = new Account();
    Object.assign(a, { id: 1, name: "Ada", email: "a@x.test", password: "secret" });
    return a;
  }

  it("keeps every other field when un-hiding one", () => {
    // With `static visible` empty — the normal case — treating the per-instance set as an
    // allow-list reduced the whole payload to exactly the un-hidden field.
    const json = account().makeVisible("password").toJSON();
    expect(json).toEqual({ id: 1, name: "Ada", email: "a@x.test", password: "secret" });
  });

  it("still hides by default", () => {
    expect(account().toJSON()).not.toHaveProperty("password");
  });

  it("extends a class-level allow-list rather than replacing it", () => {
    class Narrow extends Account {
      static override visible = ["id", "name"];
    }
    const n = new Narrow();
    Object.assign(n, { id: 1, name: "Ada", email: "a@x.test", password: "secret" });

    expect(n.toJSON()).toEqual({ id: 1, name: "Ada" });
    expect(n.makeVisible("email").toJSON()).toEqual({ id: 1, name: "Ada", email: "a@x.test" });
  });
});
