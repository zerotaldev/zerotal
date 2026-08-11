import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { SQL } from "bun";
import { _setDbConnection } from "../db/DB.ts";
import { _setBaseModelConnection, _setBaseModelDialect } from "../model/BaseModel.ts";
import { column } from "../model/decorators/column.ts";
import { table } from "../model/decorators/table.ts";
import { SchemaInspector } from "./SchemaInspector.ts";
import { ModelInspector } from "./ModelInspector.ts";
import { SchemaDiffer } from "./SchemaDiffer.ts";
import { generateMigrationContent } from "./MigrationCodegen.ts";

// ── Test DB setup ─────────────────────────────────────────────────────────────

let db: InstanceType<typeof SQL>;

beforeAll(() => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _setBaseModelConnection(db);
  _setBaseModelDialect("sqlite");
});

afterAll(() => {
  db.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTable(sql: string): Promise<void> {
  const strings = [sql];
  const tpl = Object.assign(strings, { raw: strings }) as TemplateStringsArray;
  await (db as unknown as (tpl: TemplateStringsArray) => Promise<unknown>)(tpl);
}

// ── SchemaInspector ───────────────────────────────────────────────────────────

describe("SchemaInspector.tables()", () => {
  afterEach(async () => {
    await createTable("DROP TABLE IF EXISTS si_alpha");
    await createTable("DROP TABLE IF EXISTS si_beta");
  });

  it("returns an empty array for an empty DB", async () => {
    const tables = await SchemaInspector.tables();
    const userDefined = tables.filter((t) => !t.startsWith("_"));
    expect(userDefined).toEqual([]);
  });

  it("lists created tables", async () => {
    await createTable("CREATE TABLE si_alpha (id INTEGER PRIMARY KEY)");
    await createTable("CREATE TABLE si_beta  (id INTEGER PRIMARY KEY)");
    const tables = await SchemaInspector.tables();
    expect(tables).toContain("si_alpha");
    expect(tables).toContain("si_beta");
  });
});

describe("SchemaInspector.columns()", () => {
  afterEach(async () => {
    await createTable("DROP TABLE IF EXISTS si_users");
  });

  it("returns null for a non-existent table", async () => {
    expect(await SchemaInspector.columns("si_users")).toBeNull();
  });

  it("returns column descriptors for an existing table", async () => {
    await createTable(
      `CREATE TABLE si_users (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        email TEXT
      )`,
    );

    const cols = await SchemaInspector.columns("si_users");
    expect(cols).not.toBeNull();
    expect(cols!.length).toBe(3);

    const id = cols!.find((c) => c.name === "id")!;
    expect(id.primary).toBe(true);
    expect(id.rawType).toBe("INTEGER");

    const name = cols!.find((c) => c.name === "name")!;
    expect(name.primary).toBe(false);
    expect(name.rawType).toBe("TEXT");

    const email = cols!.find((c) => c.name === "email")!;
    expect(email.nullable).toBe(true);
  });
});

describe("SchemaInspector.describe()", () => {
  afterEach(async () => {
    await createTable("DROP TABLE IF EXISTS si_posts");
  });

  it("returns null for a missing table", async () => {
    expect(await SchemaInspector.describe("si_posts")).toBeNull();
  });

  it("returns LiveTable with name + columns", async () => {
    await createTable(`CREATE TABLE si_posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`);
    const live = await SchemaInspector.describe("si_posts");
    expect(live).not.toBeNull();
    expect(live!.name).toBe("si_posts");
    expect(live!.columns.map((c) => c.name)).toContain("title");
  });
});

// ── ModelInspector ────────────────────────────────────────────────────────────

describe("ModelInspector.fromClass()", () => {
  it("returns null for a class without a table", () => {
    // No @table → fromClass returns null at the table check (before columns are read).
    // We intentionally do NOT put @column here: a column decorator with no @table to
    // drain it would leak its registration into the next @table'd class.
    class NoTable {
      name!: string;
    }
    expect(ModelInspector.fromClass(NoTable)).toBeNull();
  });

  it("reads columns, table, timestamps and softDeletes from a class", () => {
    @table("articles")
    class Article {
      static softDeletes = true;
      @column({ type: "string" }) title!: string;
      @column({ type: "number" }) views!: number;
      @column({ type: "boolean" }) hidden!: boolean;
      @column({ type: "json" }) meta!: object;
      @column({ type: "datetime" }) publishedAt!: string;
    }

    const schema = ModelInspector.fromClass(Article);
    expect(schema).not.toBeNull();
    expect(schema!.table).toBe("articles");
    expect(schema!.timestamps).toBe(true);
    expect(schema!.softDeletes).toBe(true);

    const names = schema!.columns.map((c) => c.name);
    expect(names).toContain("title");
    expect(names).toContain("views");
    expect(names).toContain("hidden");
    expect(names).toContain("meta");
    expect(names).toContain("publishedAt");

    const views = schema!.columns.find((c) => c.name === "views")!;
    expect(views.type).toBe("number");
  });

  it('uses "id" as default primaryKey', () => {
    @table("widgets")
    class Widget {
      @column({ type: "string" }) label!: string;
    }
    const schema = ModelInspector.fromClass(Widget);
    expect(schema!.primaryKey).toBe("id");
  });

  it("picks up nullable and default column options", () => {
    @table("tags")
    class Tag {
      @column({ type: "string", nullable: true, default: "draft" }) status!: string;
    }
    const schema = ModelInspector.fromClass(Tag);
    const col = schema!.columns.find((c) => c.name === "status")!;
    expect(col.nullable).toBe(true);
    expect(col.default).toBe("draft");
  });
});

describe("ModelInspector — prototype chain inheritance", () => {
  it("includes parent-class columns in a child schema", () => {
    @table("base_things")
    class Base {
      @column({ type: "string" }) name!: string;
      @column({ type: "number" }) score!: number;
    }
    @table("child_things")
    class Child extends Base {
      @column({ type: "boolean" }) active!: boolean;
    }

    const schema = ModelInspector.fromClass(Child);
    expect(schema).not.toBeNull();
    const names = schema!.columns.map((c) => c.name);
    // Own column
    expect(names).toContain("active");
    // Inherited columns
    expect(names).toContain("name");
    expect(names).toContain("score");
  });

  it("child @column definition overrides parent @column on same field", () => {
    @table("override_things")
    class ParentModel {
      @column({ type: "string", nullable: false }) kind!: string;
    }
    @table("override_things_child")
    class ChildModel extends ParentModel {
      // @ts-expect-error — deliberately shadowing the parent column is the behaviour under test
      @column({ type: "string", nullable: true }) kind!: string; // nullable override
    }

    const schema = ModelInspector.fromClass(ChildModel);
    const col = schema!.columns.find((c) => c.name === "kind")!;
    expect(col.nullable).toBe(true); // child wins
  });

  it("fromClass returns null for a class with no columns anywhere in chain", () => {
    class Empty {
      static table = "empties";
    }
    expect(ModelInspector.fromClass(Empty)).toBeNull();
  });
});

describe("ModelInspector.all()", () => {
  it("returns only classes that have a static table property", () => {
    // Registry already has entries from previous tests.
    // fromClass() correctly filters — all() uses the same filter.
    const schemas = ModelInspector.all();
    for (const s of schemas) {
      expect(s.table).toBeTruthy();
    }
  });
});

// ── SchemaDiffer ──────────────────────────────────────────────────────────────

describe("SchemaDiffer.diff()", () => {
  afterEach(async () => {
    await createTable("DROP TABLE IF EXISTS sd_comments");
    await createTable("DROP TABLE IF EXISTS sd_likes");
  });

  it("flags a missing table as newTable", async () => {
    @table("sd_comments", { timestamps: false })
    class Comment {
      @column({ type: "string" }) body!: string;
    }

    const schemas = [ModelInspector.fromClass(Comment)!];
    const diff = await SchemaDiffer.diff(schemas);
    expect(diff.newTables.length).toBe(1);
    expect(diff.newTables[0]!.schema.table).toBe("sd_comments");
    expect(diff.newColumns.length).toBe(0);
  });

  it("flags new columns on an existing table", async () => {
    await createTable(`CREATE TABLE sd_comments (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);

    @table("sd_comments", { timestamps: false })
    class Comment2 {
      @column({ type: "string" }) body!: string;
      @column({ type: "number" }) authorId!: number; // NEW
      @column({ type: "boolean" }) pinned!: boolean; // NEW
    }

    const schemas = [ModelInspector.fromClass(Comment2)!];
    const diff = await SchemaDiffer.diff(schemas);
    expect(diff.newTables.length).toBe(0);

    const newNames = diff.newColumns.map((c) => c.column.name);
    expect(newNames).toContain("authorId");
    expect(newNames).toContain("pinned");
    expect(newNames).not.toContain("body");
  });

  it("detects missing timestamp columns when timestamps=true", async () => {
    await createTable(`CREATE TABLE sd_likes (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`);

    @table("sd_likes")
    class Like {
      @column({ type: "number" }) value!: number;
    }

    const schemas = [ModelInspector.fromClass(Like)!];
    const diff = await SchemaDiffer.diff(schemas);
    const newNames = diff.newColumns.map((c) => c.column.name);
    expect(newNames).toContain("created_at");
    expect(newNames).toContain("updated_at");
  });

  it("detects missing deleted_at when softDeletes=true", async () => {
    await createTable(`CREATE TABLE sd_likes (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`);

    @table("sd_likes", { timestamps: false })
    class Like2 {
      static softDeletes = true;
      @column({ type: "number" }) value!: number;
    }

    const schemas = [ModelInspector.fromClass(Like2)!];
    const diff = await SchemaDiffer.diff(schemas);
    const newNames = diff.newColumns.map((c) => c.column.name);
    expect(newNames).toContain("deleted_at");
  });

  it("returns an empty diff when everything is in sync", async () => {
    await createTable(`CREATE TABLE sd_likes (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`);

    @table("sd_likes", { timestamps: false })
    class Like3 {
      @column({ type: "number" }) value!: number;
    }

    const diff = await SchemaDiffer.diff([ModelInspector.fromClass(Like3)!]);
    expect(SchemaDiffer.isEmpty(diff)).toBe(true);
  });

  it("handles multiple schemas — new table + altered table in one diff", async () => {
    await createTable(`CREATE TABLE sd_likes (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`);

    @table("sd_likes", { timestamps: false })
    class Like4 {
      @column({ type: "number" }) value!: number;
      @column({ type: "string" }) label!: string; // NEW
    }
    @table("sd_comments", { timestamps: false })
    class Comment3 {
      @column({ type: "string" }) body!: string;
    }

    const diff = await SchemaDiffer.diff([
      ModelInspector.fromClass(Like4)!,
      ModelInspector.fromClass(Comment3)!,
    ]);

    expect(diff.newTables.length).toBe(1);
    expect(diff.newTables[0]!.schema.table).toBe("sd_comments");
    expect(diff.newColumns.length).toBeGreaterThanOrEqual(1);
    expect(diff.newColumns.some((c) => c.column.name === "label")).toBe(true);
  });
});

// ── MigrationCodegen ──────────────────────────────────────────────────────────

describe("generateMigrationContent()", () => {
  it("generates a CREATE TABLE migration for a new table", () => {
    @table("orders")
    class Order {
      @column({ type: "string" }) status!: string;
      @column({ type: "number" }) total!: number;
    }

    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [{ schema: ModelInspector.fromClass(Order)! }],
      newColumns: [],
    };

    const content = generateMigrationContent("CreateOrdersTable", diff);

    expect(content).toContain("export default class CreateOrdersTable");
    expect(content).toContain("Schema.create('orders'");
    expect(content).toContain("table.increments('id')");
    expect(content).toContain("table.string('status')");
    expect(content).toContain("table.integer('total')");
    expect(content).toContain("table.timestamps()");
    expect(content).toContain("Schema.dropIfExists('orders')");
  });

  it("generates an ALTER TABLE migration for new columns", () => {
    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [],
      newColumns: [
        {
          table: "products",
          column: {
            name: "sku",
            type: "string",
            nullable: false,
            primary: false,
            default: undefined,
          },
        },
        {
          table: "products",
          column: { name: "stock", type: "number", nullable: true, primary: false, default: 0 },
        },
      ],
    };

    const content = generateMigrationContent("AddSkuToProducts", diff);
    expect(content).toContain("Schema.table('products'");
    expect(content).toContain("table.string('sku')");
    expect(content).toContain("table.integer('stock').nullable().default(0)");
  });

  it("maps all five column types correctly", () => {
    @table("everything", { timestamps: false })
    class Everything {
      @column({ type: "string" }) str!: string;
      @column({ type: "number" }) num!: number;
      @column({ type: "boolean" }) bool!: boolean;
      @column({ type: "datetime" }) dt!: string;
      @column({ type: "json" }) data!: object;
    }

    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [{ schema: ModelInspector.fromClass(Everything)! }],
      newColumns: [],
    };
    const content = generateMigrationContent("CreateEverythingTable", diff);
    expect(content).toContain("table.string(");
    expect(content).toContain("table.integer(");
    expect(content).toContain("table.boolean(");
    expect(content).toContain("table.dateTime(");
    expect(content).toContain("table.json(");
  });

  it("skips primary key columns in CREATE body (increments handles it)", () => {
    @table("invoices", { timestamps: false, primaryKey: "id" })
    class Invoice {
      @column({ type: "number", primary: true }) id!: number;
      @column({ type: "string" }) ref!: string;
    }

    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [{ schema: ModelInspector.fromClass(Invoice)! }],
      newColumns: [],
    };
    const content = generateMigrationContent("CreateInvoicesTable", diff);
    // 'id' should appear only in increments(), not as a separate string/integer call
    const lines = content.split("\n").filter((l) => l.includes("table.") && l.includes("'id'"));
    expect(lines.every((l) => l.includes("increments"))).toBe(true);
  });

  it("produces a no-op down() when only columns are added (no new tables)", () => {
    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [],
      newColumns: [
        {
          table: "users",
          column: {
            name: "phone",
            type: "string",
            nullable: true,
            primary: false,
            default: undefined,
          },
        },
      ],
    };
    const content = generateMigrationContent("AddPhoneToUsers", diff);
    expect(content).toContain("// no-op");
    expect(content).not.toContain("drop");
  });

  it("generates softDeletes() call when softDeletes=true", () => {
    @table("soft_docs", { timestamps: false })
    class SoftDoc {
      static softDeletes = true;
      @column({ type: "string" }) name!: string;
    }
    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [{ schema: ModelInspector.fromClass(SoftDoc)! }],
      newColumns: [],
    };
    const content = generateMigrationContent("CreateSoftDocsTable", diff);
    expect(content).toContain("table.softDeletes()");
  });

  it("generates valid TypeScript (contains required imports)", () => {
    const diff: import("./SchemaDiffer.ts").DiffResult = {
      newTables: [],
      newColumns: [
        {
          table: "x",
          column: {
            name: "y",
            type: "string",
            nullable: false,
            primary: false,
            default: undefined,
          },
        },
      ],
    };
    const content = generateMigrationContent("SomeMigration", diff);
    expect(content).toContain("import { Migration, Schema } from '@zerotal/orm'");
    expect(content).toContain("export default class SomeMigration extends Migration");
    // `MigrationFile` was never exported — generated migrations did not compile.
    expect(content).not.toContain("MigrationFile");
  });
});
