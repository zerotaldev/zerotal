import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableNameFor } from "@zerotal/core";
import { MakeModelCommand } from "./MakeModelCommand.ts";
import {
  MakeMigrationCommand,
  migrationStub,
  tableFromMigrationName,
} from "./MakeMigrationCommand.ts";

/**
 * `make:model Post -m` has to leave a model and a migration that agree about the table.
 *
 * It did not. The model was bound to `post` (the snake-cased class name) while the ORM's own
 * convention, and the Getting Started guide, say `posts`; and the migration created a placeholder
 * called `table_name` whatever the model was. Following the guide, which has you put `posts` in
 * the migration, gave `SQLiteError: no such table: post` on the first query. The existing tests
 * mocked `Bun.write` and checked file names, so nothing ever compared the two files.
 *
 * These run the real commands against a real directory and read what they wrote.
 */
let dir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "zt-make-model-"));
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(dir, { recursive: true, force: true });
});

const quiet = { write: () => {}, writeLine: () => {}, writeError: () => {} };

async function makeModel(name: string, migration = true): Promise<void> {
  const cmd = new MakeModelCommand();
  cmd.args = { name };
  cmd.flags = { migration };
  cmd._writer = quiet;
  await cmd.run();
}

async function makeMigration(name: string): Promise<void> {
  const cmd = new MakeMigrationCommand();
  cmd.args = { name };
  cmd.flags = {};
  cmd._writer = quiet;
  await cmd.run();
}

const read = (path: string) => readFile(join(dir, path), "utf8");
const migrations = () => readdir(join(dir, "database", "migrations"));

describe("make:model --migration", () => {
  it.each([
    ["Post", "posts"],
    ["BlogPost", "blog_posts"],
    ["Category", "categories"],
    ["Task", "tasks"],
  ])("%s is bound to %s, the table the ORM would pick", async (model, table) => {
    await makeModel(model);

    expect(tableNameFor(model)).toBe(table);
    expect(await read(`app/models/${model}.ts`)).toContain(`@table('${table}')`);
  });

  it("creates a migration for the same table, named for it", async () => {
    await makeModel("Post");

    const files = await migrations();
    expect(files).toEqual(["001_create_posts_table.ts"]);
    const migration = await read("database/migrations/001_create_posts_table.ts");
    expect(migration).toContain("Schema.create('posts'");
    expect(migration).toContain("Schema.drop('posts')");
    expect(migration).not.toContain("table_name");
  });

  it("gives the migration the column the model declares, so the pair works as generated", async () => {
    await makeModel("Post");

    const model = await read("app/models/Post.ts");
    const migration = await read("database/migrations/001_create_posts_table.ts");
    expect(model).toContain("@column() name!: string;");
    expect(model).toContain("fillable = ['name']");
    expect(migration).toContain("table.string('name');");
  });

  it("the model and the migration name one table", async () => {
    await makeModel("BlogPost");

    const model = await read("app/models/BlogPost.ts");
    const [file] = await migrations();
    const migration = await read(`database/migrations/${file}`);
    const modelTable = /@table\('([^']+)'\)/.exec(model)?.[1];
    const created = /Schema\.create\('([^']+)'/.exec(migration)?.[1];
    const dropped = /Schema\.drop\('([^']+)'\)/.exec(migration)?.[1];
    expect(modelTable).toBe("blog_posts");
    expect(created).toBe(modelTable);
    expect(dropped).toBe(modelTable);
  });

  it("writes no migration without the flag", async () => {
    await makeModel("Post", false);

    expect(await read("app/models/Post.ts")).toContain("@table('posts')");
    await expect(migrations()).rejects.toThrow();
  });
});

describe("make:migration", () => {
  it("names the table a create_<table>_table migration creates", async () => {
    await makeMigration("create_invoices_table");

    const migration = await read("database/migrations/001_create_invoices_table.ts");
    expect(migration).toContain("Schema.create('invoices'");
    expect(migration).not.toContain("table_name");
  });

  it("leaves the placeholder where the name does not say", async () => {
    await makeMigration("add_email_to_users");

    expect(await read("database/migrations/001_add_email_to_users.ts")).toContain("table_name");
  });
});

describe("tableFromMigrationName", () => {
  it("reads the table out of create_<table>_table, and nothing else", () => {
    expect(tableFromMigrationName("create_posts_table")).toBe("posts");
    expect(tableFromMigrationName("create_blog_posts_table")).toBe("blog_posts");
    expect(tableFromMigrationName("add_email_to_users")).toBeUndefined();
    expect(tableFromMigrationName("create_posts")).toBeUndefined();
    expect(tableFromMigrationName("drop_posts_table")).toBeUndefined();
  });
});

describe("migrationStub", () => {
  it("is valid TypeScript with a table and columns", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const source = migrationStub("CreatePostsTable", {
      table: "posts",
      columns: ["table.string('title');", "table.text('body');"],
    });

    expect(() => transpiler.transformSync(source)).not.toThrow();
    expect(source).toContain("table.string('title');");
    expect(source.indexOf("table.increments('id')")).toBeLessThan(
      source.indexOf("table.string('title')"),
    );
    expect(source.indexOf("table.text('body')")).toBeLessThan(source.indexOf("table.timestamps()"));
  });

  it("still creates the placeholder when it is told nothing", () => {
    expect(migrationStub("CreateThings")).toContain("Schema.create('table_name'");
  });
});
