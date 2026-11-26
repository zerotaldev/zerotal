import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MakePageCommand, _componentName, _pageStub } from "./MakePageCommand.ts";

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

  it("says so when the layout it was asked for is not there", async () => {
    await starter("tsx");
    const out = await run({ name: "about" }, { layout: "PublicLayout", framework: "react" });
    expect(out).toContain("No PublicLayout.tsx");
  });
});
