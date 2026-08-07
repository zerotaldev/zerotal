import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import {
  _setBaseModelConnection,
  _clearTransitionCallbacks,
  BaseModel,
  State,
  column,
  table,
  StateError,
} from "@zerotal/orm";
import { Factory } from "./factory.ts";

// ── DB setup ──────────────────────────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL DEFAULT '',
      email      TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT,
      updated_at TEXT
    )
  `;
  await db`
    CREATE TABLE posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '',
      user_id    INTEGER NOT NULL DEFAULT 0,
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
  await db`DELETE FROM posts`;
});

afterEach(() => {
  _clearTransitionCallbacks();
  delete Bun.env["APP_ENV"];
});

// ── Test models ───────────────────────────────────────────────────────────────

const SubStates = {
  pending: { canTransitionTo: ["active", "cancelled"] as const },
  active: {
    canTransitionTo: ["suspended", "expired", "cancelled"] as const,
    guard: () => {
      throw new StateError("User", "pending", "active", "Stripe required.");
    },
  },
  suspended: { canTransitionTo: ["active", "cancelled"] as const },
  expired: { canTransitionTo: [] as const },
  cancelled: { canTransitionTo: [] as const },
} as const;

@table("users")
class User extends State(BaseModel) {
  static override states = SubStates;

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
  @column({ type: "string" }) status!: string;
}

@table("posts")
class Post extends BaseModel {
  @column({ type: "string" }) title!: string;
  @column({ type: "number" }) userId!: number;
}

// ── Factories ─────────────────────────────────────────────────────────────────

const UserFactory = Factory.define(User, (f) => ({
  name: f.string(8),
  email: f.email(),
  status: "pending",
}));

const PostFactory = Factory.define(Post, (f) => ({
  title: f.sentence(3),
  userId: 0,
}));

// ── Factory.make() ────────────────────────────────────────────────────────────

describe("Factory.make()", () => {
  it("returns an in-memory instance with generated data", () => {
    const u = UserFactory.make();
    expect(u).toBeInstanceOf(User);
    expect(u.name.length).toBeGreaterThan(0);
    expect(u.email).toContain("@");
  });

  it("applies overrides over defaults", () => {
    const u = UserFactory.make({ name: "Alice" });
    expect(u.name).toBe("Alice");
  });

  it("does not persist to the database", async () => {
    UserFactory.make();
    const rows = await db<unknown[]>`SELECT * FROM users`;
    expect(rows).toHaveLength(0);
  });
});

// ── Factory.create() ──────────────────────────────────────────────────────────

describe("Factory.create()", () => {
  it("persists one instance and returns it", async () => {
    const u = await UserFactory.create();
    expect(u.id).toBeGreaterThan(0);
    const rows = await db<unknown[]>`SELECT * FROM users WHERE id = ${u.id}`;
    expect(rows).toHaveLength(1);
  });

  it("applies overrides over defaults", async () => {
    const u = await UserFactory.create({ name: "Bob" });
    expect(u.name).toBe("Bob");
  });

  it("bypasses fillable protection", async () => {
    @table("users")
    class Protected extends BaseModel {
      static override fillable = ["email"];
      @column({ type: "string" }) name!: string;
      @column({ type: "string" }) email!: string;
      @column({ type: "string" }) status!: string;
    }
    const ProtectedFactory = Factory.define(Protected, (f) => ({
      name: f.string(),
      email: f.email(),
      status: "pending",
    }));
    const p = await ProtectedFactory.create({ name: "Direct" });
    // factory bypasses fillable — name should be set
    expect(p.name).toBe("Direct");
  });
});

// ── Factory.count() ───────────────────────────────────────────────────────────

describe("Factory.count().create()", () => {
  it("creates n instances and returns them as an array", async () => {
    const users = await UserFactory.count(5).create();
    expect(users).toHaveLength(5);
    expect(users[0]!.id).not.toBe(users[1]!.id);
  });

  it("each instance has a unique id", async () => {
    const users = await UserFactory.count(3).create();
    const ids = users.map((u) => u.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("applies overrides to all instances", async () => {
    const users = await UserFactory.count(3).create({ name: "Shared" });
    expect(users.every((u) => u.name === "Shared")).toBe(true);
  });

  it("state() is chainable on FactoryBatch", async () => {
    const users = await UserFactory.count(2).state("expired").create();
    expect(users.every((u) => u.status === "expired")).toBe(true);
  });
});

// ── Factory.createMany() ──────────────────────────────────────────────────────

describe("Factory.createMany()", () => {
  it("creates n instances without switching to batch mode", async () => {
    const users = await UserFactory.createMany(4);
    expect(users).toHaveLength(4);
  });
});

// ── Factory.for() ─────────────────────────────────────────────────────────────

describe("Factory.for()", () => {
  it("injects parent model id as foreign key", async () => {
    const user = await UserFactory.create({ name: "Author" });
    const post = await PostFactory.for(user).create();
    expect(post.userId).toBe(user.id);
  });

  it("supports a custom foreign key name", async () => {
    const user = await UserFactory.create();
    const post = await PostFactory.for(user, "userId").create();
    expect(post.userId).toBe(user.id);
  });
});

// ── Factory.state() ───────────────────────────────────────────────────────────

describe("Factory.state()", () => {
  it("forces state after creation, bypassing guards", async () => {
    // 'active' has a guard that always throws — state() must bypass it
    const u = await UserFactory.state("active").create();
    expect(u.status).toBe("active");
  });

  it("forces state to a terminal state not reachable from pending", async () => {
    const u = await UserFactory.state("expired").create();
    expect(u.status).toBe("expired");
    const row = await db<{ status: string }[]>`SELECT status FROM users WHERE id = ${u.id}`;
    expect(row[0]?.status).toBe("expired");
  });

  it("does not fire onTransition callbacks", async () => {
    const events: string[] = [];
    User.onTransition("expired", () => {
      events.push("fired");
    });
    await UserFactory.state("expired").create();
    expect(events).toHaveLength(0);
  });

  it("is immutable — original factory is unchanged", async () => {
    const expiredFactory = UserFactory.state("expired");
    const u1 = await UserFactory.create();
    const u2 = await expiredFactory.create();
    expect(u1.status).toBe("pending");
    expect(u2.status).toBe("expired");
  });
});

// ── Factory.afterCreate() ─────────────────────────────────────────────────────

describe("Factory.afterCreate()", () => {
  it("runs the callback after creation", async () => {
    const log: number[] = [];
    const F = UserFactory.afterCreate(async (u) => {
      log.push(u.id);
    });
    await F.create();
    expect(log).toHaveLength(1);
    expect(log[0]).toBeGreaterThan(0);
  });

  it("runs for every instance in count().create()", async () => {
    const log: number[] = [];
    const F = UserFactory.afterCreate((u) => {
      log.push(u.id);
    });
    await F.count(3).create();
    expect(log).toHaveLength(3);
  });
});
