/**
 * What every `make:*` generator does the same way, through {@link GeneratorCommand}.
 *
 * Before 1.19.0 a generator that refused ("File already exists", a bad name) exited 0, had no
 * `--dry-run` or `--force` (both were dropped without a word, so `--dry-run` wrote the file),
 * wrote `make:controller ../x` beside `app/`, and said nothing about what to do with the file.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Application } from "../application/Application.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { GeneratorCommand, _nameProblem } from "./GeneratorCommand.ts";
import * as builtin from "./builtin/index.ts";

/** Each generator, the name it is given, and the file that name writes. */
const GENERATORS: { argv: string[]; path: string }[] = [
  { argv: ["make:controller", "PostController"], path: "app/controllers/PostController.ts" },
  { argv: ["make:middleware", "RequireAdmin"], path: "app/middleware/RequireAdmin.ts" },
  { argv: ["make:command", "PruneTasks"], path: "app/commands/PruneTasks.ts" },
  { argv: ["make:request", "StorePostRequest"], path: "app/requests/StorePostRequest.ts" },
  { argv: ["make:notification", "OrderShipped"], path: "app/notifications/OrderShipped.ts" },
  { argv: ["make:job", "ProcessPayment"], path: "app/jobs/ProcessPayment.ts" },
  { argv: ["make:schedule", "SendReminders"], path: "app/schedules/SendReminders.ts" },
  { argv: ["make:event", "UserRegistered"], path: "app/events/UserRegistered.ts" },
  { argv: ["make:listener", "SendWelcome"], path: "app/listeners/SendWelcome.ts" },
  { argv: ["make:observer", "UserObserver"], path: "app/observers/UserObserver.ts" },
  { argv: ["make:policy", "PostPolicy"], path: "app/policies/PostPolicy.ts" },
  { argv: ["make:resource", "UserResource"], path: "app/resources/UserResource.ts" },
  {
    argv: ["make:provider", "Payment", "--no-register"],
    path: "app/providers/PaymentProvider.ts",
  },
  { argv: ["make:test", "posts"], path: "tests/posts.test.ts" },
  { argv: ["make:package", "billing"], path: "packages/billing/package.json" },
];

let app: string;
let cwd: string;
let runner: CommandRunner;

beforeEach(async () => {
  cwd = process.cwd();
  app = mkdtempSync(join(tmpdir(), "zt-generator-"));
  writeFileSync(join(app, "package.json"), JSON.stringify({ dependencies: { zerotal: "^1" } }));
  process.chdir(app);
  Application._resetInstance();
  const application = Application.create({ env: "test" });
  await application.boot();
  runner = new CommandRunner(application);
  for (const exported of Object.values(builtin)) {
    if (typeof exported === "function" && exported.prototype instanceof GeneratorCommand) {
      runner.register(exported as unknown as Parameters<CommandRunner["register"]>[0]);
    }
  }
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(app, { recursive: true, force: true });
  Application._resetInstance();
});

function seed(path: string, text: string): void {
  mkdirSync(dirname(join(app, path)), { recursive: true });
  writeFileSync(join(app, path), text);
}

it("every built-in make:* generator extends GeneratorCommand", () => {
  const generators = Object.values(builtin)
    .filter((exported) => typeof exported === "function" && "commandName" in exported)
    .filter((exported) =>
      String((exported as { commandName: string }).commandName).startsWith("make:"),
    );
  expect(generators.length).toBe(GENERATORS.length);
  for (const generator of generators) {
    expect(generator.prototype instanceof GeneratorCommand).toBe(true);
  }
});

for (const { argv, path } of GENERATORS) {
  describe(argv[0]!, () => {
    it("writes the file, then says what to do with it", async () => {
      const result = await runner.callInProcess(argv);

      expect(result.code).toBe(0);
      expect(existsSync(join(app, path))).toBe(true);
      expect(result.output).toContain(`Created: ${path}`);
      expect(result.output).toContain("Next:");
    });

    it("refuses a file that exists, and fails", async () => {
      seed(path, "// mine\n");

      const result = await runner.callInProcess(argv);

      expect(result.code).toBe(1);
      expect(result.output).toMatch(/already exists/);
      expect(result.output).toContain("--force");
      expect(readFileSync(join(app, path), "utf8")).toBe("// mine\n");
    });

    it("overwrites it with --force", async () => {
      seed(path, "// mine\n");

      const result = await runner.callInProcess([...argv, "--force"]);

      expect(result.code).toBe(0);
      expect(readFileSync(join(app, path), "utf8")).not.toBe("// mine\n");
      expect(result.output).toContain(`Overwrote: ${path}`);
    });

    it("prints the file with --dry-run, and writes nothing", async () => {
      const result = await runner.callInProcess([...argv, "--dry-run"]);

      expect(result.code).toBe(0);
      expect(existsSync(join(app, path))).toBe(false);
      expect(existsSync(join(app, path.split("/")[0]!))).toBe(false);
      expect(result.output).toContain(`Would create: ${path}`);
      // The contents, as they would be written.
      expect(result.output).toMatch(/^(import|export) |"name"/m);
    });

    it("fails a --dry-run that would be refused", async () => {
      seed(path, "// mine\n");
      const result = await runner.callInProcess([...argv, "--dry-run"]);
      expect(result.code).toBe(1);
    });
  });
}

describe("the name", () => {
  for (const { argv } of GENERATORS.filter((g) => g.argv[0] !== "make:package")) {
    it(`${argv[0]} refuses a name that leaves app/, and writes nothing`, async () => {
      mkdirSync(join(app, "inner"));
      process.chdir(join(app, "inner"));

      const result = await runner.callInProcess([argv[0]!, "../Escape", ...argv.slice(2)]);

      expect(result.code).toBe(1);
      expect(result.output).toContain('"../Escape" is not a valid');
      expect(existsSync(join(app, "Escape.ts"))).toBe(false);
      expect(existsSync(join(app, "inner", "app"))).toBe(false);
    });
  }

  it("is a class name for a class, and a file name for a test", () => {
    expect(_nameProblem("PostController", "class")).toBeUndefined();
    expect(_nameProblem("post-controller", "class")).toContain("not a valid class name");
    expect(_nameProblem("2Fast", "class")).toContain("not a valid class name");
    expect(_nameProblem("Post Controller", "class")).toContain("not a valid class name");
    expect(_nameProblem("post-test", "file")).toBeUndefined();
    expect(_nameProblem("a/b", "file")).toContain("not a valid file name");
    expect(_nameProblem("Users/Index", "nested-class")).toBeUndefined();
    expect(_nameProblem("Users/../Index", "nested-class")).toContain("in each part");
    expect(_nameProblem("tasks/index", "path")).toBeUndefined();
    expect(_nameProblem("/etc/passwd", "path")).toContain("not a valid");
    expect(_nameProblem("", "class")).toBe("Name is required.");
  });
});

describe("side effects under --dry-run", () => {
  it("make:provider does not register the provider", async () => {
    seed("bootstrap/providers.ts", "export default [];\n");

    const result = await runner.callInProcess(["make:provider", "Payment", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("Would register PaymentProvider in bootstrap/providers.ts");
    expect(readFileSync(join(app, "bootstrap/providers.ts"), "utf8")).toBe("export default [];\n");
  });

  it("make:package checks every file before writing any", async () => {
    seed("packages/billing/src/index.ts", "// mine\n");

    const result = await runner.callInProcess(["make:package", "billing"]);

    expect(result.code).toBe(1);
    expect(existsSync(join(app, "packages/billing/package.json"))).toBe(false);
  });
});

describe("the next step", () => {
  it("make:controller says where to route it, and how to test it", async () => {
    const plain = await runner.callInProcess(["make:controller", "PostController"]);
    expect(plain.output).toContain('Router.get("/posts", PostController, "index");');
    expect(plain.output).toContain("bun zt make:test posts");

    const crud = await runner.callInProcess(["make:controller", "TaskController", "--resource"]);
    expect(crud.output).toContain('Router.resource("tasks", TaskController);');
  });

  it("make:observer says it attaches by name, or how to attach one that does not", async () => {
    const named = await runner.callInProcess(["make:observer", "UserObserver"]);
    expect(named.output).toContain("attaches UserObserver to User at boot");

    const other = await runner.callInProcess(["make:observer", "AuditTrail", "--model", "Post"]);
    expect(other.output).toContain("Post.observe(AuditTrail);");
  });

  it("make:test says how to run it", async () => {
    const result = await runner.callInProcess(["make:test", "posts"]);
    expect(result.output).toContain("bun zt test tests/posts.test.ts");
  });
});
