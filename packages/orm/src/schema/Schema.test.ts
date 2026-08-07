import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { _setDbConnection } from "../db/DB.ts";
import { Blueprint } from "./Blueprint.ts";
import { Schema } from "./Schema.ts";

// ── Blueprint unit tests (pure SQL generation — no DB) ────────────────────────

describe("Blueprint — CREATE TABLE SQL", () => {
  it("generates increments and NOT NULL string columns", () => {
    const bp = new Blueprint();
    bp.increments("id");
    bp.string("name");

    const [sql] = bp.toCreateSQL("users");
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("id INTEGER PRIMARY KEY AUTOINCREMENT");
    expect(sql).toContain("name TEXT NOT NULL");
  });

  it("nullable() omits NOT NULL", () => {
    const bp = new Blueprint();
    bp.string("email").nullable();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("email TEXT");
    expect(sql).not.toContain("email TEXT NOT NULL");
  });

  it("notNullable() alone produces NOT NULL", () => {
    const bp = new Blueprint();
    bp.string("slug").notNullable();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("slug TEXT NOT NULL");
  });

  it("nullable() then unique() works — different traits do not block each other", () => {
    const bp = new Blueprint();
    bp.string("email").nullable().unique();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("email TEXT");
    expect(sql).toContain("UNIQUE");
    expect(sql).not.toContain("NOT NULL");
  });

  it("generates DEFAULT for numbers, strings and booleans", () => {
    const bp = new Blueprint();
    bp.integer("score").default(0);
    bp.string("status").default("active");
    bp.boolean("active").default(true);
    bp.boolean("locked").default(false);

    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("score INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'active'");
    expect(sql).toContain("active INTEGER NOT NULL DEFAULT 1");
    expect(sql).toContain("locked INTEGER NOT NULL DEFAULT 0");
  });

  it("escapes single-quotes in string defaults", () => {
    const bp = new Blueprint();
    bp.string("note").default("it's fine");
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("DEFAULT 'it''s fine'");
  });

  it("adds UNIQUE inline via column modifier", () => {
    const bp = new Blueprint();
    bp.string("email").unique();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("email TEXT NOT NULL UNIQUE");
  });

  it("generates FOREIGN KEY constraint in CREATE TABLE", () => {
    const bp = new Blueprint();
    bp.integer("user_id");
    bp.foreign("user_id").references("id").on("users");
    const [sql] = bp.toCreateSQL("posts");
    expect(sql).toContain("FOREIGN KEY (user_id) REFERENCES users(id)");
  });

  it("generates ON DELETE / ON UPDATE clauses", () => {
    const bp = new Blueprint();
    bp.integer("user_id");
    bp.foreign("user_id").references("id").on("users").onDelete("CASCADE").onUpdate("RESTRICT");
    const [sql] = bp.toCreateSQL("posts");
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("ON UPDATE RESTRICT");
  });

  it("generates timestamps() as two nullable TEXT columns", () => {
    const bp = new Blueprint();
    bp.increments("id");
    bp.timestamps();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("created_at TEXT");
    expect(sql).toContain("updated_at TEXT");
    expect(sql).not.toContain("created_at TEXT NOT NULL");
  });

  it("generates softDeletes() as nullable deleted_at", () => {
    const bp = new Blueprint();
    bp.increments("id");
    bp.softDeletes();
    const [sql] = bp.toCreateSQL("t");
    expect(sql).toContain("deleted_at TEXT");
    expect(sql).not.toContain("deleted_at TEXT NOT NULL");
  });

  it("emits a CREATE INDEX for .index() column modifier", () => {
    const bp = new Blueprint();
    bp.increments("id");
    bp.integer("account_id").index();
    const stmts = bp.toCreateSQL("entries");
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toMatch(/CREATE INDEX.*entries.*account_id/);
  });

  it("emits CREATE UNIQUE INDEX for Blueprint.unique()", () => {
    const bp = new Blueprint();
    bp.increments("id");
    bp.string("first_name");
    bp.string("last_name");
    bp.unique(["first_name", "last_name"], "full_name_unique");
    const stmts = bp.toCreateSQL("people");
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toContain("CREATE UNIQUE INDEX full_name_unique");
    expect(stmts[1]).toContain("first_name, last_name");
  });
});

describe("Blueprint — ALTER TABLE SQL", () => {
  it("generates ADD COLUMN", () => {
    const bp = new Blueprint();
    bp.string("bio").nullable();
    const [sql] = bp.toAlterSQL("users");
    expect(sql).toBe("ALTER TABLE users ADD COLUMN bio TEXT");
  });

  it("generates DROP COLUMN", () => {
    const bp = new Blueprint();
    bp.dropColumn("bio");
    const [sql] = bp.toAlterSQL("users");
    expect(sql).toBe("ALTER TABLE users DROP COLUMN bio");
  });

  it("generates multiple DROP COLUMNs", () => {
    const bp = new Blueprint();
    bp.dropColumn("a", "b");
    const stmts = bp.toAlterSQL("t");
    expect(stmts[0]).toBe("ALTER TABLE t DROP COLUMN a");
    expect(stmts[1]).toBe("ALTER TABLE t DROP COLUMN b");
  });

  it("generates RENAME COLUMN", () => {
    const bp = new Blueprint();
    bp.renameColumn("bio", "biography");
    const [sql] = bp.toAlterSQL("users");
    expect(sql).toBe("ALTER TABLE users RENAME COLUMN bio TO biography");
  });

  it("generates CREATE INDEX IF NOT EXISTS in alter context", () => {
    const bp = new Blueprint();
    bp.integer("tag_id").index();
    const stmts = bp.toAlterSQL("posts");
    expect(stmts).toHaveLength(2); // ADD COLUMN + CREATE INDEX
    expect(stmts[1]).toContain("IF NOT EXISTS");
  });
});

// ── Schema facade integration tests (real SQLite in-memory) ───────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
});

afterAll(async () => {
  await db.end();
});

// Each test gets a freshly-named table to avoid inter-test interference.
let _tSeq = 0;
function tbl() {
  return `schema_test_${++_tSeq}`;
}

describe("Schema.create / Schema.drop", () => {
  it("creates a table and verifies its existence", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("name");
    });
    expect(await Schema.hasTable(t)).toBe(true);
    await Schema.drop(t);
    expect(await Schema.hasTable(t)).toBe(false);
  });

  it("throws if table already exists", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
    });
    await expect(
      Schema.create(t, (bp) => {
        bp.increments("id");
      }),
    ).rejects.toThrow();
    await Schema.drop(t);
  });

  it("createIfNotExists does not throw on duplicate", async () => {
    const t = tbl();
    await Schema.createIfNotExists(t, (bp) => {
      bp.increments("id");
    });
    await expect(
      Schema.createIfNotExists(t, (bp) => {
        bp.increments("id");
      }),
    ).resolves.toBeUndefined();
    await Schema.drop(t);
  });

  it("dropIfExists is silent for missing tables", async () => {
    await expect(Schema.dropIfExists("never_existed_xyz")).resolves.toBeUndefined();
  });
});

describe("Schema.hasColumn", () => {
  it("detects existing columns", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("name");
    });
    expect(await Schema.hasColumn(t, "id")).toBe(true);
    expect(await Schema.hasColumn(t, "name")).toBe(true);
    expect(await Schema.hasColumn(t, "missing")).toBe(false);
    await Schema.drop(t);
  });
});

describe("Schema.table (ALTER TABLE)", () => {
  it("adds a column to an existing table", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("name");
    });
    await Schema.table(t, (bp) => {
      bp.string("email").nullable();
    });
    expect(await Schema.hasColumn(t, "email")).toBe(true);
    await Schema.drop(t);
  });

  it("drops a column", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("extra");
    });
    await Schema.table(t, (bp) => {
      bp.dropColumn("extra");
    });
    expect(await Schema.hasColumn(t, "extra")).toBe(false);
    await Schema.drop(t);
  });

  it("renames a column", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("old_name");
    });
    await Schema.table(t, (bp) => {
      bp.renameColumn("old_name", "new_name");
    });
    expect(await Schema.hasColumn(t, "new_name")).toBe(true);
    expect(await Schema.hasColumn(t, "old_name")).toBe(false);
    await Schema.drop(t);
  });
});

describe("Schema.rename", () => {
  it("renames a table", async () => {
    const from = tbl();
    const to = tbl();
    await Schema.create(from, (bp) => {
      bp.increments("id");
    });
    await Schema.rename(from, to);
    expect(await Schema.hasTable(to)).toBe(true);
    expect(await Schema.hasTable(from)).toBe(false);
    await Schema.drop(to);
  });
});

describe("Schema column types round-trip", () => {
  it("creates a table with every major type and inserts a row", async () => {
    const t = tbl();
    await Schema.create(t, (bp) => {
      bp.increments("id");
      bp.string("name");
      bp.text("body").nullable();
      bp.integer("count").default(0);
      bp.boolean("active").default(true);
      bp.float("score").default(0);
      bp.decimal("amount", 10, 2).nullable();
      bp.dateTime("happened_at").nullable();
      bp.json("meta").nullable();
      bp.timestamps();
    });

    // Verify all columns exist
    for (const col of [
      "id",
      "name",
      "body",
      "count",
      "active",
      "score",
      "amount",
      "happened_at",
      "meta",
      "created_at",
      "updated_at",
    ]) {
      expect(await Schema.hasColumn(t, col)).toBe(true);
    }

    await Schema.drop(t);
  });
});
