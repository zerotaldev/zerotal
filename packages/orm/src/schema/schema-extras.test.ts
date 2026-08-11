/**
 * Extra tests for Blueprint, ColumnDefinition (ColumnBuilder / ForeignKeyBuilder /
 * ForeignIdColumnBuilder), SchemaInspector, ModelInspector, and MigrationRunner.
 *
 * Blueprint and ColumnDefinition are tested purely (no DB), while SchemaInspector
 * and MigrationRunner use an in-memory SQLite instance.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";

import { Blueprint } from "./Blueprint.ts";
import { ColumnBuilder, ForeignKeyBuilder } from "./ColumnDefinition.ts";
import { SchemaInspector } from "./SchemaInspector.ts";
import { ModelInspector } from "./ModelInspector.ts";
import { MigrationRunner } from "./MigrationRunner.ts";
import { Schema } from "./Schema.ts";
import { Migration } from "./Migration.ts";
import { _setDbConnection } from "../db/DB.ts";
import { columnRegistry } from "../model/decorators/column.ts";
import { _setBaseModelConnection, _setBaseModelDialect } from "../model/BaseModel.ts";

// ── ColumnBuilder (ColumnDefinition.ts) ───────────────────────────────────────

describe("ColumnBuilder — toColumnSQL()", () => {
  it("produces basic NOT NULL column", () => {
    const col = new ColumnBuilder("name", "TEXT");
    expect(col.toColumnSQL()).toBe("name TEXT NOT NULL");
  });

  it("nullable removes NOT NULL", () => {
    const col = new ColumnBuilder("email", "TEXT");
    col.nullable();
    expect(col.toColumnSQL()).toBe("email TEXT");
  });

  it("notNullable adds NOT NULL explicitly", () => {
    const col = new ColumnBuilder("slug", "TEXT");
    col.notNullable();
    expect(col.toColumnSQL()).toBe("slug TEXT NOT NULL");
  });

  it("default null serialises to NULL", () => {
    const col = new ColumnBuilder("bio", "TEXT");
    (col as ColumnBuilder<never>).nullable();
    (col as unknown as { _hasDefault: boolean; _default: unknown })._hasDefault = true;
    (col as unknown as { _hasDefault: boolean; _default: unknown })._default = null;
    expect(col.toColumnSQL()).toContain("DEFAULT NULL");
  });

  it("default boolean true serialises to 1", () => {
    const col = new ColumnBuilder("active", "INTEGER");
    col.default(true);
    expect(col.toColumnSQL()).toContain("DEFAULT 1");
  });

  it("default boolean false serialises to 0", () => {
    const col = new ColumnBuilder("locked", "INTEGER");
    col.default(false);
    expect(col.toColumnSQL()).toContain("DEFAULT 0");
  });

  it("default string is quoted and apostrophes escaped", () => {
    const col = new ColumnBuilder("status", "TEXT");
    col.default("it's");
    expect(col.toColumnSQL()).toContain("DEFAULT 'it''s'");
  });

  it("default numeric value rendered without quotes", () => {
    const col = new ColumnBuilder("score", "INTEGER");
    col.default(42);
    expect(col.toColumnSQL()).toContain("DEFAULT 42");
  });

  it("useCurrent adds DEFAULT CURRENT_TIMESTAMP", () => {
    const col = new ColumnBuilder("created_at", "TEXT");
    col.nullable().useCurrent();
    expect(col.toColumnSQL()).toContain("DEFAULT CURRENT_TIMESTAMP");
  });

  it("defaultTo is alias for default", () => {
    const col = new ColumnBuilder("role", "TEXT");
    col.defaultTo("user");
    expect(col.toColumnSQL()).toContain("DEFAULT 'user'");
  });

  it("unique adds UNIQUE", () => {
    const col = new ColumnBuilder("email", "TEXT");
    col.unique();
    expect(col.toColumnSQL()).toContain("UNIQUE");
  });

  it("check adds CHECK constraint", () => {
    const col = new ColumnBuilder("age", "INTEGER");
    col.check("age >= 0");
    expect(col.toColumnSQL()).toContain("CHECK (age >= 0)");
  });

  it("storedAs adds GENERATED ALWAYS AS ... STORED", () => {
    const col = new ColumnBuilder("full_name", "TEXT");
    col.storedAs("first_name || ' ' || last_name");
    const sql = col.toColumnSQL();
    expect(sql).toContain("GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED");
  });

  it("virtualAs adds GENERATED ALWAYS AS ... VIRTUAL", () => {
    const col = new ColumnBuilder("initials", "TEXT");
    col.virtualAs("substr(name, 1, 1)");
    const sql = col.toColumnSQL();
    expect(sql).toContain("GENERATED ALWAYS AS (substr(name, 1, 1)) VIRTUAL");
  });

  it("primary() sets isPrimary flag and includes PRIMARY KEY in SQL", () => {
    const col = new ColumnBuilder("uuid", "TEXT");
    col.primary();
    expect(col.isPrimary).toBe(true);
    expect(col.toColumnSQL()).toContain("PRIMARY KEY");
  });

  it("index() flag sets wantsIndex=true and is cleared by unique()", () => {
    const col1 = new ColumnBuilder("ref", "TEXT");
    col1.index();
    expect(col1.wantsIndex).toBe(true);

    const col2 = new ColumnBuilder("email", "TEXT");
    col2.index();
    col2.unique();
    // wantsIndex is false when unique is also set
    expect(col2.wantsIndex).toBe(false);
  });

  it("alter() / change() marks isAlter=true", () => {
    const col = new ColumnBuilder("bio", "TEXT");
    expect(col.isAlter).toBe(false);
    col.alter();
    expect(col.isAlter).toBe(true);
    const col2 = new ColumnBuilder("x", "TEXT");
    col2.change();
    expect(col2.isAlter).toBe(true);
  });

  it("unsigned(), comment(), after(), before() are fluent no-ops", () => {
    const col = new ColumnBuilder("amount", "REAL");
    const result = col.unsigned().comment("price").after("id").before("name");
    expect(result).toBe(col);
  });

  it("useCurrentOnUpdate() is a fluent no-op", () => {
    const col = new ColumnBuilder("updated_at", "TEXT");
    const result = col.useCurrentOnUpdate();
    expect(result).toBe(col);
  });

  it("PK column omits NOT NULL", () => {
    const col = new ColumnBuilder("id", "INTEGER", true, true);
    const sql = col.toColumnSQL();
    expect(sql).toContain("PRIMARY KEY");
    expect(sql).toContain("AUTOINCREMENT");
    expect(sql).not.toContain("NOT NULL");
  });
});

// ── ForeignKeyBuilder ─────────────────────────────────────────────────────────

describe("ForeignKeyBuilder", () => {
  it("basic references + on + onDelete", () => {
    const fk = new ForeignKeyBuilder("user_id");
    fk.references("id").on("users").onDelete("CASCADE");
    expect(fk.toConstraintSQL()).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    );
  });

  it("references with table.column shorthand", () => {
    const fk = new ForeignKeyBuilder("author_id");
    fk.references("users.id").onDelete("SET NULL");
    expect(fk.toConstraintSQL()).toContain("REFERENCES users(id)");
    expect(fk.toConstraintSQL()).toContain("ON DELETE SET NULL");
  });

  it("cascadeOnDelete shorthand", () => {
    const fk = new ForeignKeyBuilder("post_id");
    fk.references("id").on("posts").cascadeOnDelete();
    expect(fk.toConstraintSQL()).toContain("ON DELETE CASCADE");
  });

  it("cascadeOnUpdate shorthand", () => {
    const fk = new ForeignKeyBuilder("post_id");
    fk.references("id").on("posts").cascadeOnUpdate();
    expect(fk.toConstraintSQL()).toContain("ON UPDATE CASCADE");
  });

  it("nullOnDelete shorthand", () => {
    const fk = new ForeignKeyBuilder("post_id");
    fk.references("id").on("posts").nullOnDelete();
    expect(fk.toConstraintSQL()).toContain("ON DELETE SET NULL");
  });

  it("restrictOnDelete shorthand", () => {
    const fk = new ForeignKeyBuilder("post_id");
    fk.references("id").on("posts").restrictOnDelete();
    expect(fk.toConstraintSQL()).toContain("ON DELETE RESTRICT");
  });

  it("onUpdate", () => {
    const fk = new ForeignKeyBuilder("cat_id");
    fk.references("id").on("cats").onUpdate("NO ACTION");
    expect(fk.toConstraintSQL()).toContain("ON UPDATE NO ACTION");
  });

  it("no actions produces clean constraint", () => {
    const fk = new ForeignKeyBuilder("user_id");
    fk.references("id").on("users");
    expect(fk.toConstraintSQL()).toBe("FOREIGN KEY (user_id) REFERENCES users(id)");
  });
});

// ── Blueprint extended coverage ────────────────────────────────────────────────

describe("Blueprint — extended column types", () => {
  it("bigIncrements", () => {
    const b = new Blueprint();
    b.bigIncrements("id");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("id INTEGER PRIMARY KEY AUTOINCREMENT");
  });

  it("bigInteger", () => {
    const b = new Blueprint();
    b.bigInteger("views");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("views INTEGER");
  });

  it("tinyInteger / smallInteger / mediumInteger", () => {
    const b = new Blueprint();
    b.tinyInteger("tiny");
    b.smallInteger("small");
    b.mediumInteger("med");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("tiny INTEGER");
    expect(sql).toContain("small INTEGER");
    expect(sql).toContain("med INTEGER");
  });

  it("unsignedInteger / unsignedBigInteger / unsignedSmallInteger / unsignedTinyInteger / unsignedMediumInteger", () => {
    const b = new Blueprint();
    b.unsignedInteger("a");
    b.unsignedBigInteger("b");
    b.unsignedSmallInteger("c");
    b.unsignedTinyInteger("d");
    b.unsignedMediumInteger("e");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("a INTEGER");
    expect(sql).toContain("b INTEGER");
  });

  it("char", () => {
    const b = new Blueprint();
    b.char("code", 3);
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("code TEXT");
  });

  it("tinyText / mediumText / longText", () => {
    const b = new Blueprint();
    b.tinyText("t1");
    b.mediumText("t2");
    b.longText("t3");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("t1 TEXT");
    expect(sql).toContain("t2 TEXT");
    expect(sql).toContain("t3 TEXT");
  });

  it("uuid / ulid", () => {
    const b = new Blueprint();
    b.uuid("uuid_col");
    b.ulid("ulid_col");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("uuid_col TEXT");
    expect(sql).toContain("ulid_col TEXT");
  });

  it("float / double / decimal", () => {
    const b = new Blueprint();
    b.float("f");
    b.double("d", 10, 2);
    b.decimal("p", 8, 2);
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("f REAL");
    expect(sql).toContain("d REAL");
    expect(sql).toContain("p REAL");
  });

  it("unsignedDecimal", () => {
    const b = new Blueprint();
    b.unsignedDecimal("price");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("price REAL");
  });

  it("date / time / year", () => {
    const b = new Blueprint();
    b.date("birthday");
    b.time("start_time");
    b.year("grad_year");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("birthday TEXT");
    expect(sql).toContain("start_time TEXT");
    expect(sql).toContain("grad_year INTEGER");
  });

  it("binary BLOB", () => {
    const b = new Blueprint();
    b.binary("data");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("data BLOB");
  });

  it("json", () => {
    const b = new Blueprint();
    b.json("settings");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("settings TEXT");
  });

  it("set", () => {
    const b = new Blueprint();
    b.set("roles", ["admin", "user"]);
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("roles TEXT");
  });

  it("ipAddress / macAddress", () => {
    const b = new Blueprint();
    b.ipAddress("ip");
    b.macAddress("mac");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("ip TEXT");
    expect(sql).toContain("mac TEXT");
  });

  it("nullableTimestamps is alias for timestamps", () => {
    const b = new Blueprint();
    b.nullableTimestamps();
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("created_at TEXT");
    expect(sql).toContain("updated_at TEXT");
  });

  it("rememberToken adds nullable string", () => {
    const b = new Blueprint();
    b.rememberToken();
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("remember_token TEXT");
  });

  it("softDeletes adds nullable deleted_at", () => {
    const b = new Blueprint();
    b.softDeletes();
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("deleted_at TEXT");
  });

  it("softDeletes with custom column name", () => {
    const b = new Blueprint();
    b.softDeletes("trashed_at");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("trashed_at TEXT");
  });

  it("morphs adds _id + _type + composite index", () => {
    const b = new Blueprint();
    b.increments("id");
    b.morphs("taggable");
    const sqls = b.toCreateSQL("items");
    expect(sqls[0]).toContain("taggable_id INTEGER");
    expect(sqls[0]).toContain("taggable_type TEXT");
    expect(sqls.some((s) => s.includes("taggable_id"))).toBe(true);
  });

  it("nullableMorphs adds nullable _id + _type", () => {
    const b = new Blueprint();
    b.increments("id");
    b.nullableMorphs("commentable");
    const [sql] = b.toCreateSQL("items");
    expect(sql).toContain("commentable_id INTEGER");
    expect(sql).toContain("commentable_type TEXT");
  });

  it("uuidMorphs adds uuid _id + _type", () => {
    const b = new Blueprint();
    b.uuidMorphs("morphable");
    const [sql] = b.toCreateSQL("items");
    expect(sql).toContain("morphable_id TEXT");
    expect(sql).toContain("morphable_type TEXT");
  });
});

describe("Blueprint — ALTER TABLE / indexes", () => {
  it("primary() sets composite PK", () => {
    const b = new Blueprint();
    b.integer("user_id");
    b.integer("role_id");
    b.primary(["user_id", "role_id"]);
    const [sql] = b.toCreateSQL("user_roles");
    expect(sql).toContain("PRIMARY KEY (user_id, role_id)");
  });

  it("primary() with single string column", () => {
    const b = new Blueprint();
    b.string("code");
    b.primary("code");
    const [sql] = b.toCreateSQL("t");
    expect(sql).toContain("PRIMARY KEY (code)");
  });

  it("unique() adds unique index", () => {
    const b = new Blueprint();
    b.unique(["email"]);
    const [, indexSql] = b.toCreateSQL("users");
    expect(indexSql).toContain("UNIQUE INDEX");
  });

  it("unique() with explicit name", () => {
    const b = new Blueprint();
    b.unique(["email"], "idx_unique_email");
    const sqls = b.toCreateSQL("users");
    expect(sqls.some((s) => s.includes("idx_unique_email"))).toBe(true);
  });

  it("index() with explicit name", () => {
    const b = new Blueprint();
    b.index(["created_at"], "idx_created_at");
    const sqls = b.toCreateSQL("t");
    expect(sqls.some((s) => s.includes("idx_created_at"))).toBe(true);
  });

  it("spatialIndex creates a plain index on SQLite", () => {
    const b = new Blueprint();
    b.spatialIndex("location");
    const sqls = b.toCreateSQL("t");
    expect(sqls.some((s) => s.includes("INDEX") && s.includes("location"))).toBe(true);
  });

  it("fulltext with explicit name", () => {
    const b = new Blueprint();
    b.fulltext(["title"], "ft_title");
    const sqls = b.toCreateSQL("posts");
    expect(sqls.some((s) => s.includes("ft_title"))).toBe(true);
  });

  it("dropColumn emits ALTER TABLE DROP COLUMN", () => {
    const b = new Blueprint();
    b.dropColumn("old_col");
    const sqls = b.toAlterSQL("users");
    expect(sqls.some((s) => s.includes("DROP COLUMN old_col"))).toBe(true);
  });

  it("renameColumn emits ALTER TABLE RENAME COLUMN", () => {
    const b = new Blueprint();
    b.renameColumn("old", "new");
    const sqls = b.toAlterSQL("users");
    expect(sqls.some((s) => s.includes("RENAME COLUMN old TO new"))).toBe(true);
  });

  it("dropIndex by name emits DROP INDEX", () => {
    const b = new Blueprint();
    b.dropIndex("my_index");
    const sqls = b.toAlterSQL("t");
    expect(sqls.some((s) => s.includes("DROP INDEX IF EXISTS my_index"))).toBe(true);
  });

  it("dropIndex by column array derives name", () => {
    const b = new Blueprint();
    b.dropIndex(["col_a", "col_b"]);
    const sqls = b.toAlterSQL("t");
    expect(sqls.some((s) => s.includes("DROP INDEX IF EXISTS t_col_a_col_b_index"))).toBe(true);
  });

  it("dropUnique delegates to dropIndex", () => {
    const b = new Blueprint();
    b.dropUnique("my_unique_idx");
    const sqls = b.toAlterSQL("t");
    expect(sqls.some((s) => s.includes("DROP INDEX"))).toBe(true);
  });

  it("dropPrimary is a no-op on SQLite", () => {
    const b = new Blueprint();
    const result = b.dropPrimary();
    expect(result).toBe(b);
    expect(b.toAlterSQL("t")).toHaveLength(0);
  });

  it("toAlterSQL adds new columns with ADD COLUMN", () => {
    const b = new Blueprint();
    b.string("bio").nullable();
    const sqls = b.toAlterSQL("users");
    expect(sqls.some((s) => s.includes("ADD COLUMN bio TEXT"))).toBe(true);
  });

  it("toAlterSQL with alter column on postgres emits TYPE change", () => {
    const b = new Blueprint();
    b.string("email").notNullable().alter();
    const sqls = b.toAlterSQL("users", "postgres");
    expect(sqls.some((s) => s.includes("ALTER COLUMN email"))).toBe(true);
  });

  // The NOT NULL / DEFAULT regexes once carried literal backspace characters where
  // `\b` word boundaries were meant, so neither branch could ever match — every
  // postgres alter emitted DROP NOT NULL and DROP DEFAULT regardless of the column
  // definition. These pin the actual statements, not just the column name.
  it("toAlterSQL on postgres keeps NOT NULL when the altered column declares it", () => {
    const b = new Blueprint();
    b.string("email").notNullable().alter();
    const sqls = b.toAlterSQL("users", "postgres");
    expect(sqls).toContain("ALTER TABLE users ALTER COLUMN email SET NOT NULL");
    expect(sqls).not.toContain("ALTER TABLE users ALTER COLUMN email DROP NOT NULL");
  });

  it("toAlterSQL on postgres drops NOT NULL for a nullable altered column", () => {
    const b = new Blueprint();
    b.string("email").nullable().alter();
    const sqls = b.toAlterSQL("users", "postgres");
    expect(sqls).toContain("ALTER TABLE users ALTER COLUMN email DROP NOT NULL");
  });

  it("toAlterSQL on postgres keeps a declared DEFAULT", () => {
    const b = new Blueprint();
    b.string("status").default("active").alter();
    const sqls = b.toAlterSQL("users", "postgres");
    expect(
      sqls.some((s) => s.startsWith("ALTER TABLE users ALTER COLUMN status SET DEFAULT")),
    ).toBe(true);
    expect(sqls).not.toContain("ALTER TABLE users ALTER COLUMN status DROP DEFAULT");
  });

  it("toAlterSQL with alter column on mysql emits MODIFY COLUMN", () => {
    const b = new Blueprint();
    b.string("email").alter();
    const sqls = b.toAlterSQL("users", "mysql");
    expect(sqls.some((s) => s.includes("MODIFY COLUMN email"))).toBe(true);
  });

  it("toAlterSQL with alter column on sqlite emits nothing (warn only)", () => {
    const b = new Blueprint();
    b.string("email").alter();
    // Should emit empty (console.warn is called but not testable)
    const sqls = b.toAlterSQL("users", "sqlite");
    expect(sqls.filter((s) => !s.includes("INDEX"))).toHaveLength(0);
  });

  it("foreignId creates integer col + constrained() FK pointing to inferred table", () => {
    const b = new Blueprint();
    b.foreignId("user_id").constrained();
    const sqls = b.toCreateSQL("posts");
    expect(sqls[0]).toContain("user_id INTEGER");
    expect(sqls[0]).toContain("REFERENCES users(id)");
  });

  it("foreignId constrained() with explicit table and column", () => {
    const b = new Blueprint();
    b.foreignId("author_id").constrained("accounts", "uuid");
    const sqls = b.toCreateSQL("posts");
    expect(sqls[0]).toContain("REFERENCES accounts(uuid)");
  });

  it("foreignUuid creates TEXT col", () => {
    const b = new Blueprint();
    b.foreignUuid("user_uuid").constrained("users", "uuid");
    const sqls = b.toCreateSQL("posts");
    expect(sqls[0]).toContain("user_uuid TEXT");
    expect(sqls[0]).toContain("REFERENCES users(uuid)");
  });

  it("toAlterSQL index statements include IF NOT EXISTS when modifying", () => {
    const b = new Blueprint();
    b.string("name");
    b.index(["name"]);
    const sqls = b.toAlterSQL("t");
    expect(sqls.some((s) => s.includes("IF NOT EXISTS"))).toBe(true);
  });
});

// ── SchemaInspector ───────────────────────────────────────────────────────────

let db: SQLInstance;

beforeEach(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  _setBaseModelDialect("sqlite");
});

afterEach(async () => {
  _setDbConnection(null);
  _setBaseModelConnection(null);
  await db.end();
});

describe("SchemaInspector (SQLite)", () => {
  it("tables() returns user-defined tables, excludes sqlite_ internals", async () => {
    await db`CREATE TABLE foo (id INTEGER PRIMARY KEY)`;
    await db`CREATE TABLE bar (id INTEGER PRIMARY KEY)`;
    const tables = await SchemaInspector.tables();
    expect(tables).toContain("foo");
    expect(tables).toContain("bar");
    expect(tables.every((t) => !t.startsWith("sqlite_"))).toBe(true);
  });

  it("tables() returns empty array when no user tables exist", async () => {
    const tables = await SchemaInspector.tables();
    expect(tables).toEqual([]);
  });

  it("columns() returns null for non-existent table", async () => {
    const cols = await SchemaInspector.columns("does_not_exist");
    expect(cols).toBeNull();
  });

  it("columns() returns column details for existing table", async () => {
    await db`CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL)`;
    const cols = await SchemaInspector.columns("products");
    expect(cols).not.toBeNull();
    const id = cols!.find((c) => c.name === "id");
    const name = cols!.find((c) => c.name === "name");
    const price = cols!.find((c) => c.name === "price");
    expect(id?.primary).toBe(true);
    expect(name?.nullable).toBe(false);
    expect(price?.nullable).toBe(true);
  });

  it("columns() rawType is uppercased", async () => {
    await db`CREATE TABLE x (val real)`;
    const cols = await SchemaInspector.columns("x");
    expect(cols![0]!.rawType).toBe("REAL");
  });

  it("describe() returns LiveTable or null", async () => {
    await db`CREATE TABLE things (id INTEGER PRIMARY KEY)`;
    const live = await SchemaInspector.describe("things");
    expect(live).not.toBeNull();
    expect(live!.name).toBe("things");
    expect(live!.columns.length).toBeGreaterThan(0);

    const missing = await SchemaInspector.describe("missing_table");
    expect(missing).toBeNull();
  });

  it("columns() sanitises table name against injection", async () => {
    // A table name with injection chars — should return null, not throw
    const result = await SchemaInspector.columns("foo; DROP TABLE bar; --");
    expect(result).toBeNull();
  });
});

// ── ModelInspector ────────────────────────────────────────────────────────────

describe("ModelInspector", () => {
  it("fromClass() returns null for class with no @column decorators", () => {
    class NoColumns {}
    (NoColumns as unknown as Record<string, unknown>)["table"] = "no_cols";
    expect(ModelInspector.fromClass(NoColumns)).toBeNull();
  });

  it("fromClass() returns null for class with no static table", () => {
    function WithCols() {}
    columnRegistry.set(WithCols, new Map([["name", { type: "string" }]]));
    expect(ModelInspector.fromClass(WithCols)).toBeNull();
  });

  it("fromClass() returns correct schema for a class with @column and static table", () => {
    function MyModel() {}
    (MyModel as unknown as Record<string, unknown>)["table"] = "my_models";
    (MyModel as unknown as Record<string, unknown>)["primaryKey"] = "id";
    (MyModel as unknown as Record<string, unknown>)["timestamps"] = true;
    (MyModel as unknown as Record<string, unknown>)["softDeletes"] = false;
    columnRegistry.set(
      MyModel,
      new Map([
        ["title", { type: "string", nullable: false }],
        ["content", { type: "string", nullable: true }],
      ]),
    );
    const schema = ModelInspector.fromClass(MyModel);
    expect(schema).not.toBeNull();
    expect(schema!.table).toBe("my_models");
    expect(schema!.primaryKey).toBe("id");
    expect(schema!.timestamps).toBe(true);
    expect(schema!.softDeletes).toBe(false);
    expect(schema!.columns.map((c) => c.name)).toContain("title");
    expect(schema!.columns.map((c) => c.name)).toContain("content");
  });

  it("fromClass() uses defaults when optional static fields are absent", () => {
    function MinModel() {}
    (MinModel as unknown as Record<string, unknown>)["table"] = "min_models";
    columnRegistry.set(MinModel, new Map([["x", { type: "number" }]]));
    const schema = ModelInspector.fromClass(MinModel);
    expect(schema!.primaryKey).toBe("id");
    expect(schema!.timestamps).toBe(true);
    expect(schema!.softDeletes).toBe(false);
  });

  it("all() includes schemas for registered classes with table", () => {
    function AModel() {}
    (AModel as unknown as Record<string, unknown>)["table"] = "a_models";
    columnRegistry.set(AModel, new Map([["col", { type: "string" }]]));
    const schemas = ModelInspector.all();
    expect(schemas.some((s) => s.table === "a_models")).toBe(true);
  });
});

// ── MigrationRunner — additional coverage ─────────────────────────────────────

describe("MigrationRunner — additional paths", () => {
  class CreateFoo extends Migration {
    async up() {
      await Schema.create("foo", (table) => {
        table.increments("id");
        table.string("title");
      });
    }
    async down() {
      await Schema.dropIfExists("foo");
    }
  }

  class CreateBar extends Migration {
    async up() {
      await Schema.create("bar", (table) => {
        table.increments("id");
      });
    }
    async down() {
      await Schema.dropIfExists("bar");
    }
  }

  it("run() returns empty array when all entries already ran", async () => {
    const runner = new MigrationRunner({ connection: db });
    const entry = { name: "001_foo", migration: new CreateFoo() };
    await runner.run([entry]);
    const second = await runner.run([entry]);
    expect(second).toEqual([]);
  });

  it("pending() returns only un-run migrations", async () => {
    const runner = new MigrationRunner({ connection: db });
    const foo = { name: "001_foo", migration: new CreateFoo() };
    const bar = { name: "002_bar", migration: new CreateBar() };
    await runner.run([foo]);
    const pending = await runner.pending([foo, bar]);
    expect(pending).toEqual(["002_bar"]);
  });

  it("rollback() returns empty when no batches exist", async () => {
    const runner = new MigrationRunner({ connection: db });
    const result = await runner.rollback([{ name: "001_foo", migration: new CreateFoo() }]);
    expect(result).toEqual([]);
  });

  it("reset() rolls back all batches", async () => {
    const runner = new MigrationRunner({ connection: db });
    await runner.run([{ name: "001_foo", migration: new CreateFoo() }]);
    await runner.run([{ name: "002_bar", migration: new CreateBar() }]);
    await runner.reset([
      { name: "001_foo", migration: new CreateFoo() },
      { name: "002_bar", migration: new CreateBar() },
    ]);
    expect(await Schema.hasTable("foo")).toBe(false);
    expect(await Schema.hasTable("bar")).toBe(false);
  });

  it("status() reports ran and not-ran migrations with batch info", async () => {
    const runner = new MigrationRunner({ connection: db });
    const fooEntry = { name: "001_foo", migration: new CreateFoo() };
    const barEntry = { name: "002_bar", migration: new CreateBar() };
    await runner.run([fooEntry]);
    const statuses = await runner.status([fooEntry, barEntry]);

    const fooStatus = statuses.find((s) => s.name === "001_foo");
    const barStatus = statuses.find((s) => s.name === "002_bar");
    expect(fooStatus?.ran).toBe(true);
    expect(fooStatus?.batch).toBe(1);
    expect(fooStatus?.ranAt).toBeInstanceOf(Date);
    expect(barStatus?.ran).toBe(false);
  });

  it("custom table name is used for tracking", async () => {
    const runner = new MigrationRunner({ connection: db, table: "my_migrations" });
    await runner.run([{ name: "001_foo", migration: new CreateFoo() }]);
    expect(await Schema.hasTable("my_migrations")).toBe(true);
  });

  it("runFromDirectory() loads and runs migrations from a directory", async () => {
    const { resolve } = await import("node:path");
    const dir = resolve(import.meta.dir, "__test_migrations__");
    const runner = new MigrationRunner({ connection: db });
    const ran = await runner.runFromDirectory(dir);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toBe("001_create_test_table");
    expect(await Schema.hasTable("test_from_dir")).toBe(true);
  });

  it("rollbackFromDirectory() loads and rolls back migrations from a directory", async () => {
    const { resolve } = await import("node:path");
    const dir = resolve(import.meta.dir, "__test_migrations__");
    const runner = new MigrationRunner({ connection: db });
    await runner.runFromDirectory(dir);
    const rolledBack = await runner.rollbackFromDirectory(dir);
    expect(rolledBack).toHaveLength(1);
    expect(await Schema.hasTable("test_from_dir")).toBe(false);
  });
});

// ── ModelInspector.load() ──────────────────────────────────────────────────────

describe("ModelInspector.load()", () => {
  it("imports files matching the pattern without throwing", async () => {
    const { resolve } = await import("node:path");
    const cwd = resolve(import.meta.dir, "..");
    // Load the SchemaInspector file — it doesn't register columns but tests the glob + import path
    let threw = false;
    try {
      await ModelInspector.load("schema/SchemaInspector.ts", cwd);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("handles a pattern that matches no files gracefully", async () => {
    const { resolve } = await import("node:path");
    const cwd = resolve(import.meta.dir, "..");
    let threw = false;
    try {
      await ModelInspector.load("**/__no_such_files_xyz__.ts", cwd);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── SchemaInspector — postgres dialect ────────────────────────────────────────

function makeMockConn(handler: (sql: string) => unknown[]) {
  return function (tpl: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> {
    const sql = Array.from(tpl).join("?");
    return Promise.resolve(handler(sql));
  } as unknown as SQLInstance;
}

describe("SchemaInspector.tables() — postgres", () => {
  beforeEach(() => {
    _setBaseModelDialect("postgres");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("information_schema.tables")) {
          return [{ table_name: "users" }, { table_name: "posts" }];
        }
        return [];
      }),
    );
  });

  afterEach(() => {
    _setBaseModelDialect("sqlite");
    _setDbConnection(db);
  });

  it("returns table names from information_schema", async () => {
    const tables = await SchemaInspector.tables();
    expect(tables).toContain("users");
    expect(tables).toContain("posts");
  });
});

describe("SchemaInspector.columns() — postgres", () => {
  afterEach(() => {
    _setBaseModelDialect("sqlite");
    _setDbConnection(db);
  });

  it("returns null when table does not exist (exists=false)", async () => {
    _setBaseModelDialect("postgres");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("EXISTS")) return [{ exists: false }];
        return [];
      }),
    );
    const cols = await SchemaInspector.columns("missing_table");
    expect(cols).toBeNull();
  });

  it("returns column descriptors for an existing postgres table", async () => {
    _setBaseModelDialect("postgres");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("EXISTS")) return [{ exists: true }];
        if (sql.includes("ordinal_position")) {
          return [
            { column_name: "id", data_type: "integer", is_nullable: "NO" },
            { column_name: "email", data_type: "text", is_nullable: "YES" },
          ];
        }
        if (sql.includes("PRIMARY KEY")) return [{ column_name: "id" }];
        return [];
      }),
    );
    const cols = await SchemaInspector.columns("users");
    expect(cols).not.toBeNull();
    const id = cols!.find((c) => c.name === "id")!;
    expect(id.primary).toBe(true);
    expect(id.rawType).toBe("INTEGER");
    const email = cols!.find((c) => c.name === "email")!;
    expect(email.nullable).toBe(true);
    expect(email.primary).toBe(false);
  });
});

describe("SchemaInspector.describe() — postgres", () => {
  afterEach(() => {
    _setBaseModelDialect("sqlite");
    _setDbConnection(db);
  });

  it("returns null when postgres table does not exist", async () => {
    _setBaseModelDialect("postgres");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("EXISTS")) return [{ exists: false }];
        return [];
      }),
    );
    expect(await SchemaInspector.describe("no_table")).toBeNull();
  });

  it("returns LiveTable with columns for postgres", async () => {
    _setBaseModelDialect("postgres");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("EXISTS")) return [{ exists: true }];
        if (sql.includes("ordinal_position"))
          return [{ column_name: "title", data_type: "text", is_nullable: "NO" }];
        if (sql.includes("PRIMARY KEY")) return [];
        return [];
      }),
    );
    const live = await SchemaInspector.describe("articles");
    expect(live).not.toBeNull();
    expect(live!.name).toBe("articles");
    expect(live!.columns[0]!.name).toBe("title");
  });
});

// ── SchemaInspector — mysql dialect ───────────────────────────────────────────

describe("SchemaInspector.tables() — mysql", () => {
  afterEach(() => {
    _setBaseModelDialect("sqlite");
    _setDbConnection(db);
  });

  it("returns table names from INFORMATION_SCHEMA", async () => {
    _setBaseModelDialect("mysql");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("TABLE_NAME")) return [{ table_name: "orders" }, { table_name: "items" }];
        return [];
      }),
    );
    const tables = await SchemaInspector.tables();
    expect(tables).toContain("orders");
    expect(tables).toContain("items");
  });
});

describe("SchemaInspector.columns() — mysql", () => {
  afterEach(() => {
    _setBaseModelDialect("sqlite");
    _setDbConnection(db);
  });

  it("returns null when mysql table has no columns (does not exist)", async () => {
    _setBaseModelDialect("mysql");
    _setDbConnection(makeMockConn(() => []));
    const cols = await SchemaInspector.columns("missing");
    expect(cols).toBeNull();
  });

  it("returns column descriptors for an existing mysql table", async () => {
    _setBaseModelDialect("mysql");
    _setDbConnection(
      makeMockConn((sql) => {
        if (sql.includes("COLUMN_NAME")) {
          return [
            { COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", COLUMN_KEY: "PRI" },
            { COLUMN_NAME: "email", DATA_TYPE: "varchar", IS_NULLABLE: "YES", COLUMN_KEY: "" },
          ];
        }
        return [];
      }),
    );
    const cols = await SchemaInspector.columns("customers");
    expect(cols).not.toBeNull();
    const id = cols!.find((c) => c.name === "id")!;
    expect(id.primary).toBe(true);
    expect(id.rawType).toBe("INT");
    const email = cols!.find((c) => c.name === "email")!;
    expect(email.nullable).toBe(true);
    expect(email.primary).toBe(false);
  });
});
