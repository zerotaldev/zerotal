import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { _globalScopeRegistry } from "./ModelQueryBuilder.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )
  `;
  await db`INSERT INTO users (name, active) VALUES ('Alice', 1)`;
  await db`INSERT INTO users (name, active) VALUES ('Bob', 0)`;
  await db`INSERT INTO users (name, active) VALUES ('Carol', 1)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await (db as unknown as { close(): Promise<void> }).close();
});

// ── Model fixtures ────────────────────────────────────────────────────────

@table("users")
class User extends BaseModel {
  @column({}) name!: string;
  @column({}) active!: number;
}

class ActiveUser extends User {
  // inherits the table
}

// ── Reset scopes before each test ─────────────────────────────────────────

beforeEach(() => {
  _globalScopeRegistry().delete(User);
  _globalScopeRegistry().delete(ActiveUser);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("addGlobalScope()", () => {
  it("auto-applies a scope to all queries on the model", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    const users = await User.query().get();
    expect(users.map((u) => u.name).sort()).toEqual(["Alice", "Carol"]);
  });

  it("does not affect other models", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    @table("users")
    class OtherModel extends BaseModel {
      @column({}) name!: string;
      @column({}) active!: number;
    }
    const all = await OtherModel.query().get();
    expect(all).toHaveLength(3);
  });

  it("applies scope to first() as well", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    const u = await User.query().where("name", "Bob").first();
    expect(u).toBeNull();
  });

  it("multiple scopes are all applied", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));
    User.addGlobalScope("named-a", (qb) => qb.where("name", "Alice"));

    const users = await User.query().get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Alice");
  });
});

describe("withoutGlobalScope()", () => {
  it("skips a named scope", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    const users = await User.query().withoutGlobalScope("active").get();
    expect(users).toHaveLength(3);
  });

  it("skipping a non-existent scope is a no-op", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    const users = await User.query().withoutGlobalScope("nonexistent").get();
    expect(users).toHaveLength(2);
  });
});

describe("withoutGlobalScopes()", () => {
  it("bypasses all scopes", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));
    User.addGlobalScope("named-a", (qb) => qb.where("name", "Alice"));

    const users = await User.query().withoutGlobalScopes().get();
    expect(users).toHaveLength(3);
  });
});

describe("removeGlobalScope()", () => {
  it("removes a previously registered scope", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));
    User.removeGlobalScope("active");

    const users = await User.query().get();
    expect(users).toHaveLength(3);
  });
});

describe("scope inheritance", () => {
  it("child class inherits parent scopes", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));

    const users = await ActiveUser.query().get();
    expect(users).toHaveLength(2);
  });

  it("child can add its own scope on top of parent", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));
    ActiveUser.addGlobalScope("named-a", (qb) => qb.where("name", "Alice"));

    const users = await ActiveUser.query().get();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Alice");

    // Parent query unaffected by child's extra scope
    const parentUsers = await User.query().get();
    expect(parentUsers).toHaveLength(2);
  });

  it("child scope overrides parent scope with same name", async () => {
    User.addGlobalScope("active", (qb) => qb.where("active", 1));
    // child redefines 'active' to include inactive users too (no-op constraint)
    ActiveUser.addGlobalScope("active", (qb) => qb.whereRaw("1=1"));

    const users = await ActiveUser.query().get();
    expect(users).toHaveLength(3);
  });
});
