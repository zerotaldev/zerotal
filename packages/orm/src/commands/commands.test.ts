import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MigrateCommand } from "./MigrateCommand.ts";
import { MigrateRollbackCommand } from "./MigrateRollbackCommand.ts";
import { MigrateStatusCommand } from "./MigrateStatusCommand.ts";
import {
  MakeMigrationCommand,
  migrationStub,
  toMigrationClassName,
  createMigrationFile,
} from "./MakeMigrationCommand.ts";
import { MakeModelCommand, modelStub } from "./MakeModelCommand.ts";
import { DbSeedCommand } from "./DbSeedCommand.ts";
import { MakeSeederCommand, seederStub } from "./MakeSeederCommand.ts";
import { MakeFactoryCommand, factoryStub } from "./MakeFactoryCommand.ts";
import { MigrateGenerateCommand } from "./MigrateGenerateCommand.ts";
import { loadMigrations } from "./_loadMigrations.ts";
import { ModelInspector } from "../schema/ModelInspector.ts";
import { SchemaDiffer } from "../schema/SchemaDiffer.ts";

describe("MigrateCommand", () => {
  it("declares static properties", () => {
    expect(MigrateCommand.commandName).toBe("migrate");
    expect(MigrateCommand.aliases).toEqual(["db:migrate"]);
    expect(MigrateCommand.description).toBe("Run all pending database migrations");
    expect(MigrateCommand.needsApp).toBe(true);
    expect(MigrateCommand.flags).toHaveLength(1);
    expect(MigrateCommand.flags[0]!.name).toBe("fresh");
  });
});

describe("MigrateRollbackCommand", () => {
  it("declares static properties", () => {
    expect(MigrateRollbackCommand.commandName).toBe("migrate:rollback");
    expect(MigrateRollbackCommand.description).toBe("Roll back the most recent migration batch");
    expect(MigrateRollbackCommand.needsApp).toBe(true);
  });
});

describe("MigrateStatusCommand", () => {
  it("declares static properties", () => {
    expect(MigrateStatusCommand.commandName).toBe("migrate:status");
    expect(MigrateStatusCommand.description).toBe("Show the status of each migration");
    expect(MigrateStatusCommand.needsApp).toBe(true);
  });
});

describe("MakeMigrationCommand", () => {
  it("declares static properties", () => {
    expect(MakeMigrationCommand.commandName).toBe("make:migration");
    expect(MakeMigrationCommand.description).toBe("Create a new migration file");
    expect(MakeMigrationCommand.needsApp).toBe(false);
    expect(MakeMigrationCommand.args).toHaveLength(1);
    expect(MakeMigrationCommand.args[0]!.name).toBe("name");
  });

  it("converts names to class names", () => {
    expect(toMigrationClassName("create_posts_table")).toBe("CreatePostsTable");
    expect(toMigrationClassName("add_email_to_users")).toBe("AddEmailToUsers");
  });

  it("migration stub extends Migration — the base the runner instantiates", () => {
    const output = migrationStub("CreatePostsTable");
    expect(output).toContain("import { Migration, Schema } from '@zerotal/orm'");
    expect(output).toContain("export default class CreatePostsTable extends Migration");
    // The stub used to `implements MigrationFile`, a type the package never
    // exported — every scaffolded migration failed to typecheck.
    expect(output).not.toContain("MigrationFile");
  });
});

describe("MakeModelCommand", () => {
  it("declares static properties", () => {
    expect(MakeModelCommand.commandName).toBe("make:model");
    expect(MakeModelCommand.description).toBe("Create a new model class");
    expect(MakeModelCommand.needsApp).toBe(false);
    expect(MakeModelCommand.args).toHaveLength(1);
    expect(MakeModelCommand.flags).toHaveLength(1);
    expect(MakeModelCommand.args[0]!.name).toBe("name");
    expect(MakeModelCommand.flags[0]!.name).toBe("migration");
  });

  it("model stub references BaseModel", () => {
    const output = modelStub("User", "users");
    expect(output).toContain("extends BaseModel");
  });
});

describe("DbSeedCommand", () => {
  it("declares static properties", () => {
    expect(DbSeedCommand.commandName).toBe("db:seed");
    expect(DbSeedCommand.description).toBe("Run database seeders from database/seeders/");
    expect(DbSeedCommand.needsApp).toBe(true);
  });
});

describe("MakeSeederCommand", () => {
  it("declares static properties", () => {
    expect(MakeSeederCommand.commandName).toBe("make:seeder");
    expect(MakeSeederCommand.description).toBe("Create a new database seeder class");
    expect(MakeSeederCommand.needsApp).toBe(false);
    expect(MakeSeederCommand.args).toHaveLength(1);
    expect(MakeSeederCommand.args[0]!.name).toBe("name");
  });

  it("seederStub generates a class extending Seeder", () => {
    const output = seederStub("UserSeeder");
    expect(output).toContain("extends Seeder");
    expect(output).toContain("class UserSeeder");
    expect(output).toContain("async run()");
    expect(output).toContain("@zerotal/orm");
  });
});

describe("MakeFactoryCommand", () => {
  it("declares static properties", () => {
    expect(MakeFactoryCommand.commandName).toBe("make:factory");
    expect(MakeFactoryCommand.description).toBe("Create a new model factory");
    expect(MakeFactoryCommand.needsApp).toBe(false);
    expect(MakeFactoryCommand.args).toHaveLength(1);
    expect(MakeFactoryCommand.args[0]!.name).toBe("model");
  });

  it("factoryStub references Factory.define and the model name", () => {
    const output = factoryStub("Post");
    expect(output).toContain("Factory.define");
    expect(output).toContain("PostFactory");
    expect(output).toContain("@zerotal/testing");
    expect(output).toContain("Post");
  });
});

// ── MigrateGenerateCommand ─────────────────────────────────────────────────────

describe("MigrateGenerateCommand", () => {
  it("declares static properties", () => {
    expect(MigrateGenerateCommand.commandName).toBe("migrate:generate");
    expect(MigrateGenerateCommand.needsApp).toBe(false);
    expect(MigrateGenerateCommand.args).toHaveLength(1);
    expect(MigrateGenerateCommand.flags).toHaveLength(1);
  });
});

// ── Bun.file / Bun.write mocks ────────────────────────────────────────────────

const noop = { write: () => {}, writeLine: () => {}, writeError: () => {} };

let origFile: typeof Bun.file;
let origWrite: typeof Bun.write;
let written: Record<string, string>;

beforeEach(() => {
  origFile = Bun.file;
  origWrite = Bun.write;
  written = {};
  (Bun as any).write = async (path: string, content: string) => {
    written[path] = content;
    return 0;
  };
});

afterEach(() => {
  (Bun as any).file = origFile;
  (Bun as any).write = origWrite;
});

function mockFile(exists: boolean): void {
  (Bun as any).file = (_path: string) => ({
    exists: async () => exists,
    text: async () => {
      throw new Error("ENOENT");
    },
    parent: { mkdir: async (_opts: unknown) => {} },
  });
}

// ── createMigrationFile() ─────────────────────────────────────────────────────

describe("createMigrationFile()", () => {
  it("writes a migration file when it does not exist", async () => {
    const origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {
        /* no files */
      }
    };
    mockFile(false);

    const result = await createMigrationFile("create_posts_table");
    expect(result.created).toBe(true);
    expect(result.path).toContain("create_posts_table");
    const content = Object.values(written)[0];
    expect(content).toContain("extends Migration");

    (Bun as any).Glob = origGlob;
  });

  it("returns created:false when file already exists", async () => {
    const origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {
        /* no files */
      }
    };
    mockFile(true);

    const result = await createMigrationFile("create_posts_table");
    expect(result.created).toBe(false);

    (Bun as any).Glob = origGlob;
  });
});

// ── MakeMigrationCommand.run() ────────────────────────────────────────────────

describe("MakeMigrationCommand.run() — new file", () => {
  it("writes migration stub and prints info", async () => {
    const origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    mockFile(false);

    const lines: string[] = [];
    const cmd = new MakeMigrationCommand();
    cmd.args = { name: "add_email_to_users" };
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();

    expect(Object.values(written).length).toBe(1);
    expect(lines.some((l) => l.includes("Created"))).toBe(true);

    (Bun as any).Glob = origGlob;
  });

  it("prints error when migration file already exists", async () => {
    const origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    mockFile(true);

    const errors: string[] = [];
    const cmd = new MakeMigrationCommand();
    cmd.args = { name: "add_email_to_users" };
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: () => {},
      writeError: (l: string) => errors.push(l),
    };
    await cmd.run();

    expect(errors.some((e) => e.includes("already exists"))).toBe(true);
    expect(Object.values(written).length).toBe(0);

    (Bun as any).Glob = origGlob;
  });
});

// ── MakeModelCommand.run() ────────────────────────────────────────────────────

describe("MakeModelCommand.run()", () => {
  it("writes model file when it does not exist", async () => {
    mockFile(false);
    const lines: string[] = [];
    const cmd = new MakeModelCommand();
    cmd.args = { name: "Post" };
    cmd.flags = { migration: false };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(written["app/models/Post.ts"]).toContain("extends BaseModel");
    expect(lines.some((l) => l.includes("Created"))).toBe(true);
  });

  it("prints error when model file already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeModelCommand();
    cmd.args = { name: "Post" };
    cmd.flags = { migration: false };
    cmd._writer = {
      write: () => {},
      writeLine: () => {},
      writeError: (l: string) => errors.push(l),
    };
    await cmd.run();
    expect(errors.some((e) => e.includes("already exists"))).toBe(true);
  });

  it("creates model and migration when --migration flag is set", async () => {
    const origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    mockFile(false);
    const lines: string[] = [];
    const cmd = new MakeModelCommand();
    cmd.args = { name: "Comment" };
    cmd.flags = { migration: true };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();

    const keys = Object.keys(written);
    expect(keys.some((k) => k.includes("Comment.ts"))).toBe(true);
    expect(keys.some((k) => k.includes("create_comment_table"))).toBe(true);
    (Bun as any).Glob = origGlob;
  });
});

// ── MakeSeederCommand.run() ───────────────────────────────────────────────────

describe("MakeSeederCommand.run()", () => {
  it("writes seeder file", async () => {
    mockFile(false);
    const cmd = new MakeSeederCommand();
    cmd.args = { name: "UserSeeder" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written["database/seeders/UserSeeder.ts"]).toContain("extends Seeder");
  });

  it("prints error when seeder already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeSeederCommand();
    cmd.args = { name: "UserSeeder" };
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: () => {},
      writeError: (l: string) => errors.push(l),
    };
    await cmd.run();
    expect(errors.some((e) => e.includes("already exists"))).toBe(true);
  });
});

// ── MakeFactoryCommand.run() ──────────────────────────────────────────────────

describe("MakeFactoryCommand.run()", () => {
  it("writes factory file", async () => {
    mockFile(false);
    const cmd = new MakeFactoryCommand();
    cmd.args = { model: "User" };
    cmd.flags = {};
    cmd._writer = noop;
    await cmd.run();
    expect(written["database/factories/UserFactory.ts"]).toContain("Factory.define");
  });

  it("prints error when factory already exists", async () => {
    mockFile(true);
    const errors: string[] = [];
    const cmd = new MakeFactoryCommand();
    cmd.args = { model: "User" };
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: () => {},
      writeError: (l: string) => errors.push(l),
    };
    await cmd.run();
    expect(errors.some((e) => e.includes("already exists"))).toBe(true);
  });
});

// ── Migrate commands are tested separately in commands-migrate.test.ts
// (which mocks loadMigrations to avoid filesystem dependency)

// ── DbSeedCommand.run() ───────────────────────────────────────────────────────

describe("DbSeedCommand.run()", () => {
  it("prints error when DatabaseSeeder.ts does not exist and no legacy index", async () => {
    mockFile(false);
    const errors: string[] = [];
    const cmd = new DbSeedCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: () => {},
      writeError: (l: string) => errors.push(l),
    };
    await cmd.run();
    expect(errors.some((e) => e.includes("not found") || e.includes("Seeder"))).toBe(true);
  });
});

// ── loadMigrations() ──────────────────────────────────────────────────────────

describe("loadMigrations()", () => {
  it("returns an empty array when no migration files exist", async () => {
    const records = await loadMigrations();
    expect(Array.isArray(records)).toBe(true);
  });
});

// ── MigrateGenerateCommand.run() ──────────────────────────────────────────────

describe("MigrateGenerateCommand.run() — no models found", () => {
  let origLoad: typeof ModelInspector.load;
  let origAll: typeof ModelInspector.all;
  let origGlob: typeof Bun.Glob;

  beforeEach(() => {
    origLoad = ModelInspector.load;
    origAll = ModelInspector.all;
    origGlob = Bun.Glob;
    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    ModelInspector.load = async () => {};
    ModelInspector.all = () => [];
  });

  afterEach(() => {
    ModelInspector.load = origLoad;
    ModelInspector.all = origAll;
    (Bun as any).Glob = origGlob;
  });

  it("warns when no models match the pattern", async () => {
    const lines: string[] = [];
    const cmd = new MigrateGenerateCommand();
    cmd.args = { name: "create_users_table" };
    cmd.flags = { models: "app/models/**/*.ts" };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("No models found"))).toBe(true);
  });
});

describe("MigrateGenerateCommand.run() — no schema changes", () => {
  let origLoad: typeof ModelInspector.load;
  let origAll: typeof ModelInspector.all;
  let origDiff: typeof SchemaDiffer.diff;
  let origIsEmpty: typeof SchemaDiffer.isEmpty;
  let origGlob: typeof Bun.Glob;

  const fakeSchema = {
    table: "users",
    primaryKey: "id",
    timestamps: true,
    softDeletes: false,
    columns: [
      {
        name: "email",
        type: "string" as const,
        nullable: false,
        primary: false,
        default: undefined,
      },
    ],
  };

  beforeEach(() => {
    origLoad = ModelInspector.load;
    origAll = ModelInspector.all;
    origDiff = SchemaDiffer.diff;
    origIsEmpty = SchemaDiffer.isEmpty;
    origGlob = Bun.Glob;

    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    ModelInspector.load = async () => {};
    ModelInspector.all = () => [fakeSchema];
    SchemaDiffer.diff = async () => ({ newTables: [], newColumns: [], droppedColumns: [] });
    SchemaDiffer.isEmpty = () => true;
  });

  afterEach(() => {
    ModelInspector.load = origLoad;
    ModelInspector.all = origAll;
    SchemaDiffer.diff = origDiff;
    SchemaDiffer.isEmpty = origIsEmpty;
    (Bun as any).Glob = origGlob;
  });

  it("reports no schema changes when diff is empty", async () => {
    const lines: string[] = [];
    const cmd = new MigrateGenerateCommand();
    cmd.args = { name: "create_posts_table" };
    cmd.flags = { models: "app/models/**/*.ts" };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("No schema changes"))).toBe(true);
  });
});

describe("MigrateGenerateCommand.run() — writes migration file", () => {
  let origLoad: typeof ModelInspector.load;
  let origAll: typeof ModelInspector.all;
  let origDiff: typeof SchemaDiffer.diff;
  let origIsEmpty: typeof SchemaDiffer.isEmpty;
  let origGlob: typeof Bun.Glob;
  let origWrite: typeof Bun.write;
  let written: Record<string, string>;

  const fakeSchema = {
    table: "posts",
    primaryKey: "id",
    timestamps: true,
    softDeletes: false,
    columns: [
      {
        name: "title",
        type: "string" as const,
        nullable: false,
        primary: false,
        default: undefined,
      },
    ],
  };

  beforeEach(() => {
    origLoad = ModelInspector.load;
    origAll = ModelInspector.all;
    origDiff = SchemaDiffer.diff;
    origIsEmpty = SchemaDiffer.isEmpty;
    origGlob = Bun.Glob;
    origWrite = Bun.write;
    written = {};

    (Bun as any).Glob = class {
      constructor() {}
      async *scan() {}
    };
    (Bun as any).write = async (path: string, content: string) => {
      written[path] = content;
      return 0;
    };

    ModelInspector.load = async () => {};
    ModelInspector.all = () => [fakeSchema];
    SchemaDiffer.diff = async () => ({
      newTables: [{ schema: fakeSchema }],
      newColumns: [],
      droppedColumns: [],
    });
    SchemaDiffer.isEmpty = () => false;
  });

  afterEach(() => {
    ModelInspector.load = origLoad;
    ModelInspector.all = origAll;
    SchemaDiffer.diff = origDiff;
    SchemaDiffer.isEmpty = origIsEmpty;
    (Bun as any).Glob = origGlob;
    (Bun as any).write = origWrite;
  });

  it("writes a migration file with new table schema", async () => {
    const lines: string[] = [];
    const cmd = new MigrateGenerateCommand();
    cmd.args = { name: "create_posts_table" };
    cmd.flags = { models: "app/models/**/*.ts" };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();

    const writtenPaths = Object.keys(written);
    expect(writtenPaths.length).toBeGreaterThan(0);
    expect(writtenPaths[0]).toContain("create_posts_table");
    expect(lines.some((l) => l.includes("Generated"))).toBe(true);
    expect(lines.some((l) => l.includes("posts"))).toBe(true);
  });

  it("writes a migration file with new columns", async () => {
    SchemaDiffer.diff = async () => ({
      newTables: [],
      newColumns: [
        {
          table: "users",
          column: {
            name: "bio",
            type: "string" as const,
            nullable: true,
            primary: false,
            default: undefined,
          },
        },
      ],
      droppedColumns: [],
    });
    SchemaDiffer.isEmpty = () => false;

    const lines: string[] = [];
    const cmd = new MigrateGenerateCommand();
    cmd.args = { name: "add_bio_to_users" };
    cmd.flags = { models: "app/models/**/*.ts" };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();

    expect(Object.keys(written).length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("users.bio"))).toBe(true);
  });
});
