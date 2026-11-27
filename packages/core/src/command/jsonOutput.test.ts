/**
 * `--json` on `route:list`, `doctor` and `dev --list` (in `DevCommand.test.ts`): one JSON document
 * on stdout, with no colour and no boot log ahead of it.
 *
 * Before 1.19.0 none of the three declared `--json`, so the parser dropped it and each printed its
 * table. A script had to scrape coloured columns, and the boot log went to stdout ahead of them.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../application/Application.ts";
import { Router } from "../router/Router.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { DoctorCommand } from "./builtin/DoctorCommand.ts";
import type { DoctorJson } from "./builtin/DoctorCommand.ts";
import { RouteListCommand } from "./builtin/RouteListCommand.ts";
import type { RouteListJson } from "./builtin/RouteListCommand.ts";

let application: Application;
let runner: CommandRunner;

beforeEach(async () => {
  Application._resetInstance();
  application = Application.create({ env: "test" });
  await application.boot();
  runner = new CommandRunner(application);
  runner.registerAll([RouteListCommand, DoctorCommand]);
});
afterEach(() => {
  Router.reset();
  Application._resetInstance();
});

describe("route:list --json", () => {
  class PostController {}
  class Authenticate {}

  beforeEach(() => {
    Router.reset();
    Router.get("/posts", PostController as never, "index").name("posts.index");
    Router.post("/posts", PostController as never, "store", [Authenticate as never]);
    Router.get("/about", PostController as never, "about");
  });

  it("prints the routes as one document, sorted by path then method", async () => {
    const result = await runner.callInProcess(["route:list", "--json"]);

    expect(result.code).toBe(0);
    expect(result.output).not.toContain("\x1b[");
    const document = JSON.parse(result.output) as RouteListJson;
    expect(document).toEqual({
      routes: [
        {
          method: "GET",
          path: "/about",
          name: null,
          controller: "PostController",
          action: "about",
          middleware: [],
        },
        {
          method: "GET",
          path: "/posts",
          name: "posts.index",
          controller: "PostController",
          action: "index",
          middleware: [],
        },
        {
          method: "POST",
          path: "/posts",
          name: null,
          controller: "PostController",
          action: "store",
          middleware: ["Authenticate"],
        },
      ],
      ambiguousNames: {},
    });
  });

  it("applies the filters, and prints an empty list rather than a warning", async () => {
    const posts = JSON.parse(
      (await runner.callInProcess(["route:list", "--json", "--method", "post"])).output,
    ) as RouteListJson;
    expect(posts.routes.map((route) => `${route.method} ${route.path}`)).toEqual(["POST /posts"]);

    const none = await runner.callInProcess(["route:list", "--json", "--path", "/nothing"]);
    expect(none.code).toBe(0);
    expect(JSON.parse(none.output)).toEqual({ routes: [], ambiguousNames: {} });
  });
});

describe("doctor --json", () => {
  it("prints every finding as one document, and exits 1 exactly when ok is false", async () => {
    application.registerDoctorCheck({
      id: "always-fails",
      label: "Always fails",
      run: () => ({ status: "fail", message: "It failed.", fix: "Fix it." }),
    });

    const result = await runner.callInProcess(["doctor", "--json"]);

    expect(result.output).not.toContain("\x1b[");
    const document = JSON.parse(result.output) as DoctorJson;
    expect(document.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(document.checks).toContainEqual({
      id: "always-fails",
      label: "Always fails",
      status: "fail",
      message: "It failed.",
      fix: "Fix it.",
    });
    expect(document.transport).toBeNull();
    expect(document.headers).toBeNull();
    expect(document.summary.checks).toBe(document.checks.length);
    expect(document.summary.failures).toBe(
      document.checks.filter((check) => check.status === "fail").length,
    );
  });
});

describe("a --json run's stdout", () => {
  // In a child process, because what is under test is the process's own stdout.
  it("carries only what the command writes; console.log and stdout writes go to stderr", async () => {
    const script = `
      import { _reserveStdoutForJson, TerminalWriter } from ${JSON.stringify(join(import.meta.dir, "OutputWriter.ts"))};
      _reserveStdoutForJson();
      console.log("boot log line");
      console.info("provider notice");
      process.stdout.write("logger line\\n");
      new TerminalWriter().write(JSON.stringify({ ok: true }) + "\\n");
    `;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(child.stdout.toString()).toBe('{"ok":true}\n');
    const stderr = child.stderr.toString();
    for (const line of ["boot log line", "provider notice", "logger line"]) {
      expect(stderr).toContain(line);
    }
  });

  // The runner exits as soon as the command returns, and an asynchronous write to a pipe lost
  // everything past the first 64 KiB.
  it("carries a large document whole, through a pipe, when the process exits at once", async () => {
    const script = `
      import { _reserveStdoutForJson, TerminalWriter } from ${JSON.stringify(join(import.meta.dir, "OutputWriter.ts"))};
      _reserveStdoutForJson();
      const rows = Array.from({ length: 20000 }, (_, i) => ({ i, path: "/rows/" + i }));
      new TerminalWriter().write(JSON.stringify({ rows }) + "\\n");
      process.exit(0);
    `;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const text = await new Response(child.stdout).text();
    await child.exited;

    expect((JSON.parse(text) as { rows: unknown[] }).rows).toHaveLength(20000);
  });

  // Through the real entry point: an app file that logs as it is imported, before the runner
  // exists, used to land ahead of the document too.
  it("is the document alone for `zt route:list --json`, whatever the app logs as it loads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zt-json-run-"));
    try {
      mkdirSync(join(dir, "bootstrap"));
      mkdirSync(join(dir, "config"));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "json-run" }));
      writeFileSync(
        join(dir, "bootstrap/app.ts"),
        `import { Application, Router } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};
class Home {}
const app = Application.create();
Router.get("/", Home as never, "index").name("home");
console.log("an app file says hello as it loads");
export default app;
`,
      );
      writeFileSync(
        join(dir, "zt.ts"),
        `import { startZerotal } from ${JSON.stringify(join(import.meta.dir, "../index.ts"))};
await startZerotal(() => import("./bootstrap/app.ts"));
`,
      );
      const child = Bun.spawn([process.execPath, "zt.ts", "route:list", "--json"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...Bun.env, APP_ENV: "local" },
      });
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(await child.exited).toBe(0);

      expect((JSON.parse(stdout) as RouteListJson).routes.map((route) => route.name)).toEqual([
        "home",
      ]);
      expect(stderr).toContain("an app file says hello as it loads");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
