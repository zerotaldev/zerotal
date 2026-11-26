#!/usr/bin/env bun
/**
 * Scaffold every starter from the packed release and check it works, before anything
 * is published.
 *
 *   bun run scripts/publish-packages.ts --dry-run     # packs into .release-tarballs/
 *   bun run scripts/starter-smoke.ts                  # then this
 *
 * Unit tests run against the source tree, so they cannot see what a new user gets: the
 * tarballs `bun pm pack` writes, installed into a project `create-zerotal` just made.
 * The breakages that have reached users that way — a file a tarball left out, a
 * starter script that called something the package no longer had, generated agent
 * files that disagreed with the generator — all passed every unit test.
 *
 * So each starter is scaffolded with this checkout's `create-zerotal`, every Zerotal
 * dependency is pointed at its tarball (and overridden, so nothing comes from the
 * registry), and the app is installed and checked the way its own README says to:
 *
 *   - `bun zt test` passes;
 *   - `typecheck` and `format:check` pass, where the starter has them;
 *   - `zt arch:update --dry` has nothing to change (the shipped agent files are current);
 *   - `zt doctor` reports no failure (warnings, such as unrun migrations, are fine);
 *   - `zt list` exits rather than hanging.
 *
 * Then, in the React, Vue and Flow starters, a feature is added the way a developer adds one — the
 * generators a 1.18.0 walk found writing files the starter's own checks rejected — and the
 * checks run again: `make:model`, `make:factory`, `make:notification`, `make:job`,
 * `make:command`, `make:policy --model`, `make:test`, `make:page` in React and Vue, and, in Flow,
 * `make:flow --crud --model`, then `typecheck`, `format:check` and `zt test` must all still pass,
 * and `zt repl` must read piped input.
 *
 * Run in the release workflow after the dry run, so a starter that does not work stops
 * the release before any package reaches npm.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES } from "../packages/create-zerotal/src/args.ts";

const ROOT = join(import.meta.dir, "..");
const TARBALLS = join(ROOT, ".release-tarballs");
const CREATE = join(ROOT, "packages", "create-zerotal", "src", "index.ts");

/** One check's outcome. */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Package name for a tarball file, as `bun pm pack` names them. */
function packageOf(file: string): string | undefined {
  const match = /^(.*)-\d+\.\d+\.\d+(?:-[\w.]+)?\.tgz$/.exec(file);
  if (!match) return undefined;
  const base = match[1]!;
  if (base === "zerotal" || base === "create-zerotal") return base;
  return `@zerotal/${base.replace(/^zerotal-/, "")}`;
}

async function tarballMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const file of await readdir(TARBALLS)) {
    const name = packageOf(file);
    if (name && name !== "create-zerotal")
      map[name] = `file:${join(TARBALLS, file).replace(/\\/g, "/")}`;
  }
  if (Object.keys(map).length === 0) {
    throw new Error(`No tarballs in ${TARBALLS}. Run the publish dry run first.`);
  }
  return map;
}

/**
 * The environment an app is run with: this process's, minus anything an app reads.
 *
 * A new user's app runs on its own `.env`. The release job sets `APP_KEY` and
 * `APP_ENV` for its own tests, and Bun lets a variable already set win over `.env`,
 * so passing them through tested a different app from the one a user gets — and an
 * empty one broke config loading outright.
 */
function appEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value === undefined) continue;
    if (/^(APP_|DATABASE_|ZT_|SESSION_|MAIL_|SMTP_|REDIS_|NODE_ENV$)/.test(key)) continue;
    out[key] = value;
  }
  out["NO_COLOR"] = "1";
  return out;
}

/** Colour codes, which some output carries despite `NO_COLOR`. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Run a command in `cwd`; resolve to its exit code and combined output, uncoloured. */
async function run(
  cmd: string[],
  cwd: string,
  timeoutMs = 300_000,
  stdin?: string,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: appEnv(),
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, out: (out + err).replace(ANSI, "") };
}

function tail(text: string, lines = 15): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

async function smoke(template: string, tarballs: Record<string, string>): Promise<Check[]> {
  const dir = await mkdtemp(join(tmpdir(), `zt-smoke-${template}-`));
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(ok || detail === undefined ? {} : { detail }) });

  try {
    const scaffold = await run(
      [process.execPath, CREATE, "app", `--template=${template}`, "--yes", "--no-install"],
      dir,
    );
    check("scaffold", scaffold.code === 0, tail(scaffold.out));
    if (scaffold.code !== 0) return checks;

    const app = join(dir, "app");
    const manifestPath = join(app, "package.json");
    const manifest = (await Bun.file(manifestPath).json()) as Record<
      string,
      Record<string, string>
    >;
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (tarballs[name]) manifest[field]![name] = tarballs[name]!;
      }
    }
    manifest["overrides"] = tarballs;
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const install = await run([process.execPath, "install"], app);
    check("install", install.code === 0, tail(install.out));
    if (install.code !== 0) return checks;

    const scripts = (manifest["scripts"] ?? {}) as Record<string, string>;
    const zt = (...args: string[]) => run([process.execPath, "zt.ts", ...args], app);

    const test = await zt("test");
    check("zt test", test.code === 0, tail(test.out));

    for (const script of ["typecheck", "format:check"]) {
      if (!scripts[script]) continue;
      const result = await run([process.execPath, "run", script], app);
      check(script, result.code === 0, tail(result.out));
    }

    const arch = await zt("arch:update", "--dry");
    check(
      "arch:update has nothing to change",
      arch.code === 0 && /\b0 file\(s\) would change/.test(arch.out),
      tail(arch.out),
    );

    const doctor = await zt("doctor");
    check("doctor has no failure", doctor.code === 0, tail(doctor.out, 30));

    const list = await run([process.execPath, "zt.ts", "list"], app, 30_000);
    check("zt list exits", list.code === 0, tail(list.out));

    if (template === "react" || template === "vue" || template === "flow") {
      await addFeature(app, template, scripts, check);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return checks;
}

/** Replace `from` with `to` in the app's file, failing the check when `from` is not there. */
async function edit(app: string, file: string, from: string, to: string): Promise<boolean> {
  const path = join(app, file);
  const text = await Bun.file(path).text();
  if (!text.includes(from)) return false;
  await Bun.write(path, text.replace(from, to));
  return true;
}

/**
 * Add a Task feature with the generators, as a developer would, and run the starter's checks
 * over the result. Each generator's output is checked for the thing it used to get wrong.
 */
async function addFeature(
  app: string,
  template: string,
  scripts: Record<string, string>,
  check: (name: string, ok: boolean, detail?: string) => void,
): Promise<void> {
  const zt = (...args: string[]) => run([process.execPath, "zt.ts", ...args], app);
  const read = (file: string) =>
    Bun.file(join(app, file))
      .text()
      .catch(() => "");
  const step = async (args: string[], ok: (out: string) => Promise<boolean> | boolean) => {
    const result = await zt(...args);
    check(`zt ${args.join(" ")}`, result.code === 0 && (await ok(result.out)), tail(result.out));
  };

  await step(["make:model", "Task", "-m"], async (out) => {
    const model = await read("app/models/Task.ts");
    return (
      /Created: database\/migrations\//.test(out) &&
      model.includes('from "zerotal/orm"') &&
      model.includes("extends Model {")
    );
  });
  // A task belongs to whoever made it, as the starter's projects do: the owner column the
  // policy and the Flow page scope by.
  const owned =
    (await edit(
      app,
      "app/models/Task.ts",
      '  @column({ type: "string" }) name!: string;',
      '  @column({ type: "number" }) userId!: number;\n  @column({ type: "string" }) name!: string;',
    )) &&
    (await Promise.all(
      [...new Bun.Glob("database/migrations/*_create_tasks_table.ts").scanSync({ cwd: app })].map(
        (file) =>
          edit(
            app,
            file,
            'table.string("name");',
            'table.integer("user_id").index();\n      table.string("name");',
          ),
      ),
    ).then((done) => done.length === 1 && done[0] === true));
  check("give Task an owner column", owned);

  await step(["make:factory", "TaskFactory"], async () => {
    const factory = await read("database/factories/TaskFactory.ts");
    return factory.includes('from "zerotal/testing"') && factory.includes("name: fake.");
  });
  await step(["make:notification", "TaskAssigned"], () => true);
  await step(["make:job", "SendTaskReminder"], async () =>
    (await read("app/jobs/SendTaskReminder.ts")).includes('from "zerotal/queue"'),
  );
  await step(["make:command", "PruneTasks"], (out) =>
    out.includes("Run it with: bun zt prune-tasks"),
  );
  await step(["make:policy", "TaskPolicy", "--model", "Task"], async () => {
    const policy = await read("app/policies/TaskPolicy.ts");
    return (
      policy.includes("extends Policy<Task>") && policy.includes("return task.userId === user.id;")
    );
  });

  if (template === "react" || template === "vue") {
    // It wrote single quotes, a component named `index` and no layout, and failed format:check.
    const ext = template === "vue" ? "vue" : "tsx";
    await step(["make:page", "tasks/index"], async () => {
      const page = await read(`resources/js/pages/tasks/index.${ext}`);
      return page.includes("AppLayout") && page.includes("TasksIndex") && !page.includes("TODO");
    });
  }

  if (template === "flow") {
    await step(
      ["make:flow", "TasksPage", "--crud", "--model", "Task"],
      (out) =>
        !out.includes("serves this automatically") &&
        out.includes('Router.flow("/tasks", TasksPage).name("tasks");'),
    );
    // Register it where the command says: routes/web.ts, inside the signed-in group.
    const routed =
      (await edit(
        app,
        "routes/web.ts",
        'import { ProjectsPage } from "../app/flow/pages/projects/index";',
        'import { ProjectsPage } from "../app/flow/pages/projects/index";\nimport { TasksPage } from "../app/flow/pages/tasks";',
      )) &&
      (await edit(
        app,
        "routes/web.ts",
        '    Router.flow("/projects", ProjectsPage).name("projects");',
        '    Router.flow("/projects", ProjectsPage).name("projects");\n    Router.flow("/tasks", TasksPage).name("tasks");',
      ));
    check("register /tasks in routes/web.ts", routed);
  }

  // With /tasks routed (Flow), the list test runs; without (React), every test is a todo.
  await step(["make:test", "tasks"], async () => {
    const test = await read("tests/tasks.test.ts");
    return (
      test.includes('import { bootApp } from "./support"') &&
      (template === "flow" ? test.includes('  test("lists tasks"') : !/^\s+test\(/m.test(test))
    );
  });

  for (const script of ["typecheck", "format:check"]) {
    if (!scripts[script]) continue;
    const result = await run([process.execPath, "run", script], app);
    check(`${script} after the generators`, result.code === 0, tail(result.out));
  }
  const test = await zt("test");
  check("zt test after the generators", test.code === 0, tail(test.out));

  const repl = await run([process.execPath, "zt.ts", "repl"], app, 60_000, "1+1\n");
  check("zt repl reads piped input", repl.code === 0 && /^2$/m.test(repl.out), tail(repl.out));
}

const tarballs = await tarballMap();
const only = process.argv.slice(2);
const templates = only.length > 0 ? TEMPLATES.filter((t) => only.includes(t)) : [...TEMPLATES];

let failed = 0;
for (const template of templates) {
  const started = Date.now();
  const checks = await smoke(template, tarballs);
  const bad = checks.filter((c) => !c.ok);
  failed += bad.length;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `${bad.length === 0 ? "✓" : "✗"} ${template} (${seconds}s): ${checks.map((c) => `${c.ok ? "" : "✗ "}${c.name}`).join(", ")}`,
  );
  for (const c of bad) console.log(`\n  ── ${template}: ${c.name} ──\n${c.detail ?? ""}\n`);
}

if (failed > 0) {
  console.error(
    `\n${failed} starter check(s) failed. Nothing should be published until they pass.`,
  );
  process.exit(1);
}
console.log(
  `\nstarters:smoke — all ${templates.length} starters install from the packed release and pass.`,
);
