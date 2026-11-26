/**
 * The `make:*` generators against an app shaped like a starter: what they import, how they are
 * formatted, and what they read from the app's models.
 *
 * From the 1.18.0 starter walk: in the React, Vue and Flow starters, `make:model`, `make:factory`,
 * `make:notification`, `make:job` and `make:command` wrote `@zerotal/*` imports, `BaseModel` and
 * single quotes, so the starter's own `bun run format:check` failed; `make:policy --model Task`
 * wrote `Policy<unknown>` with every check returning true; and `make:command` said to run the
 * command with `bun zt.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as prettier from "prettier";
import {
  _BUNDLED,
  _formatAppSource,
  _frameworkImport,
  _readModel,
  _relativeImport,
} from "./appSource.ts";
import { commandStub, MakeCommandCommand } from "./builtin/MakeCommandCommand.ts";
import { jobStub } from "./builtin/MakeJobCommand.ts";
import { notificationStub } from "./builtin/MakeNotificationCommand.ts";
import { policyStub } from "./builtin/MakePolicyCommand.ts";
import { featureTestStub, unitTestStub } from "./builtin/MakeTestCommand.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { Application } from "../application/Application.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
/** The Prettier config every starter ships. */
const STARTER_PRETTIER = JSON.parse(
  readFileSync(join(ROOT, "packages/create-zerotal/templates/react/_prettierrc.json"), "utf8"),
) as prettier.Options;

const TASK_MODEL = `import { Model, column, table } from "zerotal/orm";

@table("tasks")
export class Task extends Model {
  static override fillable = ["title", "notes", "done"] as const;

  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) title!: string;
  @column({ type: "text", nullable: true }) notes?: string | null | undefined;
  @column({ type: "boolean", default: false }) done!: boolean;
  @column({ name: "due_on" }) dueAt?: Date | undefined;
}
`;

const USER_MODEL = `import { Model, column } from "zerotal/orm";
export class User extends Model {
  @column({ type: "string" }) name!: string;
}
`;

let app: string;
let cwd: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(app, path)), { recursive: true });
  writeFileSync(join(app, path), text);
}

beforeEach(() => {
  cwd = process.cwd();
  app = mkdtempSync(join(tmpdir(), "zt-app-source-"));
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(app, { recursive: true, force: true });
});

describe("_frameworkImport()", () => {
  it("imports through the bundle in an app that declares it, as every starter does", () => {
    write("package.json", JSON.stringify({ dependencies: { zerotal: "^1.18.0" } }));
    expect(_frameworkImport("@zerotal/orm", app)).toBe("zerotal/orm");
    expect(_frameworkImport("@zerotal/core", app)).toBe("zerotal");
    expect(_frameworkImport("@zerotal/testing", app)).toBe("zerotal/testing");
  });

  it("keeps the scoped name in an app that declares the packages instead", () => {
    write(
      "package.json",
      JSON.stringify({ dependencies: { "@zerotal/core": "^1", "@zerotal/orm": "^1" } }),
    );
    expect(_frameworkImport("@zerotal/orm", app)).toBe("@zerotal/orm");
    expect(_frameworkImport("@zerotal/core", app)).toBe("@zerotal/core");
  });

  it("never routes a package the bundle does not carry through it", () => {
    write("package.json", JSON.stringify({ dependencies: { zerotal: "^1.18.0" } }));
    expect(_frameworkImport("@zerotal/notifications", app)).toBe("@zerotal/notifications");
    expect(_frameworkImport("@zerotal/flow", app)).toBe("@zerotal/flow");
  });

  it("names only subpaths the bundle exports, each re-exporting that package", () => {
    const bundle = JSON.parse(readFileSync(join(ROOT, "packages/zerotal/package.json"), "utf8"));
    for (const [scoped, specifier] of Object.entries(_BUNDLED)) {
      const subpath = specifier === "zerotal" ? "." : `./${specifier.slice("zerotal/".length)}`;
      const file = bundle.exports[subpath] as string | undefined;
      expect(file, `${specifier} is not exported by the bundle`).toBeDefined();
      const source = readFileSync(join(ROOT, "packages/zerotal", file!), "utf8");
      expect(source, `${file} does not re-export ${scoped}`).toContain(
        `export * from "${scoped}";`,
      );
    }
  });
});

describe("_formatAppSource()", () => {
  const messy = `import {Model} from 'zerotal/orm'\nexport const x = {a:1}\n`;

  function withPrettier(config: object): void {
    write("package.json", JSON.stringify({ devDependencies: { prettier: "^3" } }));
    write(".prettierrc.json", JSON.stringify(config));
    mkdirSync(join(app, "node_modules"), { recursive: true });
    // A junction, not a plain directory symlink: Windows refuses those without admin rights or
    // developer mode (EPERM). Elsewhere the type is ignored.
    symlinkSync(
      join(ROOT, "node_modules", "prettier"),
      join(app, "node_modules", "prettier"),
      "junction",
    );
  }

  it("formats with the app's own Prettier and config", async () => {
    withPrettier({ singleQuote: false, semi: true });
    expect(await _formatAppSource("app/models/X.ts", messy, app)).toBe(
      `import { Model } from "zerotal/orm";\nexport const x = { a: 1 };\n`,
    );
  });

  it("follows the app's config, not a house style", async () => {
    withPrettier({ singleQuote: true, semi: false });
    expect(await _formatAppSource("app/models/X.ts", messy, app)).toBe(
      `import { Model } from 'zerotal/orm'\nexport const x = { a: 1 }\n`,
    );
  });

  it("leaves a file the app's .prettierignore ignores as it is", async () => {
    withPrettier({});
    write(".prettierignore", "app/models/\n");
    expect(await _formatAppSource("app/models/X.ts", messy, app)).toBe(messy);
  });

  it("leaves the source as it is in an app without Prettier", async () => {
    write("package.json", JSON.stringify({ dependencies: { zerotal: "^1" } }));
    expect(await _formatAppSource("app/models/X.ts", messy, app)).toBe(messy);
  });
});

describe("_readModel()", () => {
  it("reads columns, the fillable list and the owner from the model's source", () => {
    write("app/models/Task.ts", TASK_MODEL);
    const shape = _readModel("Task", app)!;

    expect(shape.file).toBe("app/models/Task");
    expect(shape.fillable).toEqual(["title", "notes", "done"]);
    expect(shape.columns).toEqual([
      { property: "userId", column: "user_id", type: "number", nullable: false },
      { property: "title", column: "title", type: "string", nullable: false },
      { property: "notes", column: "notes", type: "string", nullable: true },
      { property: "done", column: "done", type: "boolean", nullable: false },
      { property: "dueAt", column: "due_on", type: "Date", nullable: true },
    ]);
    expect(shape.owner?.property).toBe("userId");
  });

  it("finds a model by what a file exports, and nothing when no file does", () => {
    write("app/models/tasks.ts", TASK_MODEL);
    expect(_readModel("Task", app)?.file).toBe("app/models/tasks");
    expect(_readModel("Missing", app)).toBeUndefined();
  });

  it("_relativeImport() reaches a model from a nested file", () => {
    expect(_relativeImport("app/policies/TaskPolicy.ts", "app/models/Task")).toBe("../models/Task");
    expect(_relativeImport("tests/tasks.test.ts", "tests/support")).toBe("./support");
  });
});

describe("generated sources pass a starter's `format:check` as written", () => {
  // In an app without Prettier installed the stub is written as it is, so it has to be in the
  // starters' style already: double quotes, the starters' print width.
  const stubs: Record<string, string> = {
    "make:command": commandStub("SendReport"),
    "make:job": jobStub("SendReport"),
    "make:notification": notificationStub("TaskAssigned"),
    "make:policy (owned)": policyStub("TaskPolicy", "Task", { owner: "userId" }),
    "make:policy (no owner)": policyStub("TaskPolicy", "Task"),
    "make:policy (no User)": policyStub("TaskPolicy", "Task", { userImport: false }),
    "make:test (starter)": featureTestStub("tasks", { support: true, userFactory: true }),
    "make:test (starter, no users)": featureTestStub("tasks", { support: true, routeExists: true }),
    "make:test (helpers)": featureTestStub("tasks", { helpers: true }),
    "make:test (bootstrap)": featureTestStub("tasks"),
    "make:test --unit": unitTestStub("Slugify"),
  };
  for (const [name, source] of Object.entries(stubs)) {
    it(name, async () => {
      const formatted = await prettier.format(source, {
        ...STARTER_PRETTIER,
        parser: "typescript",
      });
      expect(source).toBe(formatted);
    });
  }
});

describe("make:policy --model", () => {
  async function runner(): Promise<CommandRunner> {
    Application._resetInstance();
    const application = Application.create({ env: "test" });
    await application.boot();
    const r = new CommandRunner(application);
    const { MakePolicyCommand } = await import("./builtin/MakePolicyCommand.ts");
    r.register(MakePolicyCommand);
    return r;
  }

  // Every spelling of the flag a user types: the walk found each one ignored.
  for (const argv of [
    ["make:policy", "TaskPolicy", "--model", "Task"],
    ["make:policy", "TaskPolicy", "--model=Task"],
    ["make:policy", "TaskPolicy", "-m", "Task"],
    ["make:policy", "ChoreAccess", "--model", "Task"],
  ]) {
    it(`${argv.slice(1).join(" ")} types the policy by the app's Task and User`, async () => {
      write("package.json", JSON.stringify({ dependencies: { zerotal: "^1.18.0" } }));
      write("app/models/Task.ts", TASK_MODEL);
      write("app/models/User.ts", USER_MODEL);
      process.chdir(app);
      const r = await runner();

      const result = await r.callInProcess(argv);
      expect(result.code).toBe(0);
      const source = readFileSync(join(app, `app/policies/${argv[1]}.ts`), "utf8");

      expect(source).toContain(`export class ${argv[1]} extends Policy<Task>`);
      expect(source).toContain('import { Policy } from "zerotal/auth";');
      expect(source).toContain('import type { Task } from "../models/Task.ts";');
      expect(source).toContain('import type { User } from "../models/User.ts";');
      expect(source).not.toContain("unknown");
      // The owner checks the starters' ProjectPolicy makes.
      for (const verb of ["view", "update", "delete"]) {
        expect(source).toContain(`${verb}(user: User, task: Task): boolean {`);
      }
      expect(source.match(/return task\.userId === user\.id;/g)).toHaveLength(3);
      expect(source).toContain("create(_user: User): boolean {\n    return true;");
    });
  }

  it("says so, rather than guessing an owner, when the model has none", async () => {
    write("package.json", JSON.stringify({ dependencies: { zerotal: "^1.18.0" } }));
    write(
      "app/models/Note.ts",
      `export class Note extends Model {\n  @column() body!: string;\n}\n`,
    );
    write("app/models/User.ts", USER_MODEL);
    process.chdir(app);
    const r = await runner();

    const result = await r.callInProcess(["make:policy", "NotePolicy", "-m", "Note"]);
    const source = readFileSync(join(app, "app/policies/NotePolicy.ts"), "utf8");

    expect(source).toContain("extends Policy<Note>");
    expect(source).toContain("view(_user: User, _note: Note): boolean {");
    expect(result.output).toContain("Note has no userId column");
  });
});

describe("make:command", () => {
  it("says to run the command with `bun zt`, the script every starter has", async () => {
    write("package.json", JSON.stringify({ dependencies: { zerotal: "^1.18.0" } }));
    process.chdir(app);
    const lines: string[] = [];
    const cmd = new MakeCommandCommand();
    cmd.args = { name: "PruneTasks" };
    cmd.flags = {};
    cmd._writer = {
      write: (m: string) => void lines.push(m),
      writeLine: (m: string) => void lines.push(m),
      writeError: (m: string) => void lines.push(m),
    };
    await cmd.run();

    const output = lines.join("\n");
    expect(output).toContain("Run it with: bun zt prune-tasks");
    expect(output).not.toContain("zt.ts");
  });
});
