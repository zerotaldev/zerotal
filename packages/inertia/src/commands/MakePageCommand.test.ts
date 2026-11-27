import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MakePageCommand,
  _componentName,
  _pageStub,
  _routeFile,
  _routeStub,
} from "./MakePageCommand.ts";

class Collector {
  out = "";
  write(s: string) {
    this.out += s;
  }
  writeLine(s: string) {
    this.out += s + "\n";
  }
  writeError(s: string) {
    this.out += s + "\n";
  }
}

const cwd = process.cwd();
const dirs: string[] = [];
afterEach(async () => {
  process.chdir(cwd);
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  // A refusal fails the command through the exit code, which would fail this test run too.
  process.exitCode = 0;
});

/** An app laid out like the React or Vue starter: pages beside `Layouts/AppLayout`. */
async function starter(ext: "tsx" | "vue"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "makepage-"));
  dirs.push(root);
  await Bun.write(join(root, `resources/js/Layouts/AppLayout.${ext}`), "");
  await Bun.write(join(root, "resources/js/pages/home.tsx"), "export default function Home() {}\n");
  process.chdir(root);
  return root;
}

async function run(args: Record<string, string>, flags: Record<string, unknown>): Promise<string> {
  const c = new MakePageCommand();
  const col = new Collector();
  (c as unknown as { _writer: unknown })._writer = col;
  (c as unknown as { args: Record<string, string> }).args = args;
  (c as unknown as { flags: Record<string, unknown> }).flags = flags;
  await c.run();
  return col.out;
}

// From the 1.18.1 walk: `make:page tasks/index` wrote single quotes, a component named `index`,
// no layout and a `// TODO` props interface, and failed the starter's own `format:check`.
describe("make:page", () => {
  it("names the component from the whole path", () => {
    expect(_componentName("tasks/index")).toBe("TasksIndex");
    expect(_componentName("Dashboard")).toBe("Dashboard");
    expect(_componentName("settings/two-factor")).toBe("SettingsTwoFactor");
    expect(_componentName("404")).toBe("Page404");
  });

  it("writes a React page in the starter's style, in AppLayout", async () => {
    const root = await starter("tsx");
    await run({ name: "tasks/index" }, { layout: "", framework: "react" });

    const src = await Bun.file(join(root, "resources/js/pages/tasks/index.tsx")).text();
    expect(src).toContain('import { Head } from "@inertiajs/react";');
    expect(src).toContain('import AppLayout from "../../Layouts/AppLayout";');
    expect(src).toContain("function TasksIndex({ title }: Props) {");
    expect(src).toContain(
      "TasksIndex.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;",
    );
    expect(src).toContain("export default TasksIndex;");
    expect(src).not.toContain("'");
    expect(src).not.toContain("TODO");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(src)).not.toThrow();
  });

  it("writes a Vue page in the starter's style, in AppLayout", async () => {
    const root = await starter("vue");
    await run({ name: "tasks/index" }, { layout: "", framework: "vue" });

    const src = await Bun.file(join(root, "resources/js/pages/tasks/index.vue")).text();
    expect(src).toContain('import { Head } from "@inertiajs/vue3";');
    expect(src).toContain('import AppLayout from "../../Layouts/AppLayout.vue";');
    expect(src).toContain('defineOptions({ name: "TasksIndex", layout: AppLayout });');
    expect(src).toContain('<Head :title="title" />');
    expect(src).not.toContain("'");
    expect(src).not.toContain("TODO");
  });

  it("writes no layout with --layout none, or when the app has none", () => {
    const src = _pageStub({ framework: "react", component: "About", layout: undefined });
    expect(src).not.toContain("layout");
    expect(src).not.toContain("ReactNode");
    expect(src).toContain("export default About;");
  });

  it("says how to write the route when --route is not given", async () => {
    await starter("tsx");
    const out = await run({ name: "tasks/index" }, { layout: "", framework: "react" });
    expect(out).toContain("--route");
    expect(await Bun.file("app/routes/tasks/index.ts").exists()).toBe(false);
  });

  it("says so when the layout it was asked for is not there", async () => {
    await starter("tsx");
    const out = await run({ name: "about" }, { layout: "PublicLayout", framework: "react" });
    expect(out).toContain("No PublicLayout.tsx");
  });
});

// From the 1.18.2 and 1.18.3 walks: the React and Vue kits had no generator for a route, so a new
// screen meant writing the route file by hand beside the page make:page wrote.
// Through the shared generator base since 1.19.0: before it, `--dry-run` was dropped by the
// parser and the page, its route and the registry were all written; and an existing page was
// refused with exit code 0.
describe("make:page as a generator", () => {
  it("--dry-run prints the page and its route, and writes neither, nor the registry", async () => {
    const root = await starter("tsx");
    const out = await run(
      { name: "tasks/index" },
      { layout: "", framework: "react", route: true, "dry-run": true },
    );

    expect(out).toContain("Would create: resources/js/pages/tasks/index.tsx");
    expect(out).toContain("function TasksIndex(");
    expect(out).toContain("Would create: app/routes/tasks/index.ts");
    expect(out).toContain("Would regenerate the page registry.");
    expect(await Bun.file(join(root, "resources/js/pages/tasks/index.tsx")).exists()).toBe(false);
    expect(await Bun.file(join(root, "app/routes/tasks/index.ts")).exists()).toBe(false);
  });

  it("refuses an existing page with a failing exit code, and --force overwrites it", async () => {
    const root = await starter("tsx");
    await Bun.write(join(root, "resources/js/pages/reports.tsx"), "// mine\n");

    const refused = await run({ name: "reports" }, { layout: "", framework: "react" });
    expect(refused).toContain("File already exists: resources/js/pages/reports.tsx");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    const forced = await run({ name: "reports" }, { layout: "", framework: "react", force: true });
    expect(forced).toContain("Overwrote: resources/js/pages/reports.tsx");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("refuses a name that leaves the pages directory", async () => {
    const root = await starter("tsx");
    const out = await run({ name: "../escape" }, { layout: "", framework: "react" });

    expect(out).toContain('"../escape" is not a valid file name');
    expect(process.exitCode).toBe(1);
    expect(await Bun.file(join(root, "resources/js/escape.tsx")).exists()).toBe(false);
  });
});

describe("make:page --route", () => {
  /** The starter's signed-in groups, so a new page lands where its own pages are. */
  async function withGroups(root: string): Promise<void> {
    await Bun.write(join(root, "app/routes/(auth)/(verified)/_middleware.ts"), "");
  }

  it("writes the GET route that renders the page, in the signed-in group", async () => {
    const root = await starter("tsx");
    await withGroups(root);
    const out = await run({ name: "tasks/index" }, { layout: "", framework: "react", route: true });

    const src = await Bun.file(join(root, "app/routes/(auth)/(verified)/tasks/index.ts")).text();
    expect(src).toContain('import { Inertia } from "@zerotal/inertia";');
    expect(src).toContain(
      'export const GET = () => Inertia.render("tasks/index", { title: "Tasks" });',
    );
    expect(src).not.toContain("'");
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(src)).not.toThrow();
    expect(out).toContain("GET /tasks");
    expect(out).toContain("route:types");
  });

  it("writes it at --path, parameters included, for Vue too", async () => {
    const root = await starter("vue");
    await withGroups(root);
    await run({ name: "tasks/edit" }, { layout: "", framework: "vue", path: "tasks/[task]/edit" });

    const src = await Bun.file(
      join(root, "app/routes/(auth)/(verified)/tasks/[task]/edit.ts"),
    ).text();
    expect(src).toContain("// GET /tasks/:task/edit");
    expect(src).toContain('Inertia.render("tasks/edit", { title: "Edit" })');
  });

  it("leaves a route that already serves the path alone", async () => {
    const root = await starter("tsx");
    await Bun.write(join(root, "app/routes/reports.ts"), "// mine\n");
    const out = await run({ name: "reports" }, { layout: "", framework: "react", route: true });

    expect(await Bun.file(join(root, "app/routes/reports.ts")).text()).toBe("// mine\n");
    expect(out).toContain("already serves /reports");
  });

  it("maps a page name to its URL", () => {
    const none = (): boolean => false;
    expect(_routeFile("app/routes", "tasks/index", "", none)).toEqual({
      file: "app/routes/tasks/index.ts",
      url: "/tasks",
      group: "",
    });
    expect(_routeFile("app/routes", "reports/monthly-totals", "", none).url).toBe(
      "/reports/monthly-totals",
    );
    expect(_routeFile("app/routes", "x", "/projects/[project]/edit.ts", none).file).toBe(
      "app/routes/projects/[project]/edit.ts",
    );
    expect(_routeStub("reports/monthly-totals", "/reports/monthly-totals")).toContain(
      'title: "Monthly totals"',
    );
  });
});
