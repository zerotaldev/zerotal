/**
 * The ORM's generators write files a starter's own checks accept as they are.
 *
 * From the 1.18.0 starter walk: in the React, Vue and Flow starters, `make:model` and
 * `make:factory` wrote `@zerotal/*` imports, `BaseModel` and single quotes, so the starter's CI
 * (`bun run format:check`) failed on a file nobody had touched; and `make:factory TaskFactory`
 * wrote `TaskFactoryFactory`, importing a model called `TaskFactory`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as prettier from "prettier";
import { _readModel } from "@zerotal/core/commands";
import { MakeFactoryCommand, _factoryColumns, factoryStub } from "./MakeFactoryCommand.ts";
import { migrationStub } from "./MakeMigrationCommand.ts";
import { MakeModelCommand, modelStub } from "./MakeModelCommand.ts";
import { seederStub } from "./MakeSeederCommand.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const STARTER_PRETTIER = JSON.parse(
  readFileSync(join(ROOT, "packages/create-zerotal/templates/react/_prettierrc.json"), "utf8"),
) as prettier.Options;

const quiet = { write: () => {}, writeLine: () => {}, writeError: () => {} };

let app: string;
let cwd: string;
beforeEach(() => {
  cwd = process.cwd();
  app = mkdtempSync(join(tmpdir(), "zt-orm-make-"));
  writeFileSync(join(app, "package.json"), JSON.stringify({ dependencies: { zerotal: "^1" } }));
  process.chdir(app);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(app, { recursive: true, force: true });
});

describe("ORM stubs are in a starter's style as written", () => {
  // An app without Prettier gets the stub unformatted, so it has to match already.
  const stubs: Record<string, string> = {
    "make:model": modelStub("Task", "tasks"),
    "make:migration": migrationStub("CreateTasksTable", {
      table: "tasks",
      columns: ['table.string("name");'],
    }),
    "make:migration (placeholder)": migrationStub("AddDueToTasks"),
    "make:seeder": seederStub("TaskSeeder"),
    "make:factory": factoryStub("Task"),
    "make:factory (columns)": factoryStub("Task", {
      columns: ["title: fake.title(),", "done: fake.boolean(),"],
    }),
  };
  for (const [name, source] of Object.entries(stubs)) {
    it(name, async () => {
      expect(source).toBe(
        await prettier.format(source, { ...STARTER_PRETTIER, parser: "typescript" }),
      );
      expect(source).not.toContain("@zerotal/");
      expect(source).not.toContain("BaseModel");
    });
  }
});

describe("make:model", () => {
  it("imports the ORM by its scoped name in an app that declares that instead", async () => {
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { "@zerotal/orm": "^1" } }),
    );
    const cmd = new MakeModelCommand();
    cmd.args = { name: "Task" };
    cmd.flags = { migration: true };
    cmd._writer = quiet;
    await cmd.run();

    expect(readFileSync(join(app, "app/models/Task.ts"), "utf8")).toContain('from "@zerotal/orm"');
    const [migration] = new Bun.Glob("database/migrations/*.ts").scanSync({ cwd: app });
    expect(readFileSync(join(app, migration!), "utf8")).toContain('from "@zerotal/orm"');
  });
});

describe("make:factory", () => {
  const TASK = `import { Model, column, table } from "zerotal/orm";
@table("tasks")
export class Task extends Model {
  static override fillable = ["title", "notes", "done", "status"] as const;
  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) title!: string;
  @column({ type: "text", nullable: true }) notes?: string | null | undefined;
  @column({ type: "boolean" }) done!: boolean;
  @column({ type: "string" }) status!: TaskStatus;
}
`;

  it("reads `TaskFactory` as the factory's name, not a model called TaskFactory", async () => {
    mkdirSync(join(app, "app/models"), { recursive: true });
    writeFileSync(join(app, "app/models/Task.ts"), TASK);
    const cmd = new MakeFactoryCommand();
    cmd.args = { model: "TaskFactory" };
    cmd.flags = {};
    cmd._writer = quiet;
    await cmd.run();

    const source = readFileSync(join(app, "database/factories/TaskFactory.ts"), "utf8");
    expect(source).toContain('import { Factory } from "zerotal/testing";');
    expect(source).toContain('import { Task } from "../../app/models/Task.ts";');
    expect(source).toContain("export const TaskFactory = Factory.define(Task, (fake) => ({");
    expect(source).not.toContain("TaskFactoryFactory");
  });

  it("fills the model's own columns, leaving out the owner and types it cannot fake", () => {
    mkdirSync(join(app, "app/models"), { recursive: true });
    writeFileSync(join(app, "app/models/Task.ts"), TASK);

    expect(_factoryColumns(_readModel("Task")!)).toEqual([
      "title: fake.title(),",
      "notes: fake.sentence(),",
      "done: fake.boolean(),",
    ]);
  });
});
