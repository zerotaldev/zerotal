import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { MakeFlowCommand } from "./MakeFlowCommand.ts";

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

const tmpDirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "makeflow-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

function mk(
  args: Record<string, string>,
  flags: Record<string, unknown>,
): { c: MakeFlowCommand; col: Collector } {
  const c = new MakeFlowCommand();
  const col = new Collector();
  (c as unknown as { _writer: unknown })._writer = col;
  (c as unknown as { args: Record<string, string> }).args = args;
  (c as unknown as { flags: Record<string, unknown> }).flags = flags;
  return { c, col };
}

describe("make:flow — page", () => {
  it("scaffolds a Component page with an exposed field + action", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "Dashboard" }, { dir });
    await c.run();

    const path = join(dir, "Dashboard.tsx");
    expect(await Bun.file(path).exists()).toBe(true);
    const src = await Bun.file(path).text();
    expect(src).toContain("/** @jsxImportSource @zerotal/flow */");
    expect(src).toContain("export class Dashboard extends Component");
    expect(src).toContain("@expose count = 0");
    expect(src).toContain("increment(): void");
    expect(src).not.toContain("static layout"); // no layout by default
    // Route hint uses the kebab-cased class name.
    expect(col.out).toContain('Router.flow("/dashboard", Dashboard)');
  });

  it("refuses to overwrite an existing file", async () => {
    const dir = await freshDir();
    await c_run(dir, { name: "Dashboard" }, { dir });
    const { c, col } = mk({ name: "Dashboard" }, { dir });
    await c.run();
    expect(col.out).toContain("File already exists");
  });
});

describe("make:flow — layout + nesting", () => {
  it("writes a nested page and computes the layout import depth", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "Users/Index" }, { dir, layout: "AppLayout" });
    await c.run();

    const path = join(dir, "Users", "Index.tsx");
    expect(await Bun.file(path).exists()).toBe(true);
    const src = await Bun.file(path).text();
    // Two segments deep → two `../` up to the layouts folder.
    expect(src).toContain('import { AppLayout } from "../../layouts/AppLayout.tsx"');
    expect(src).toContain("static layout = AppLayout;");
    expect(col.out).toContain('Router.flow("/users/index", Index)');
  });
});

describe("make:flow — child", () => {
  it("scaffolds a child component whose props land on  fields", async () => {
    const dir = await freshDir();
    const { c, col } = mk({ name: "StarRating" }, { dir, child: true, layout: "AppLayout" });
    await c.run();

    const src = await Bun.file(join(dir, "StarRating.tsx")).text();
    expect(src).not.toContain("setup("); // props are assigned by the parent, no hook needed
    expect(src).toContain("@locked label");
    expect(src).not.toContain("static layout"); // layout ignored for a child
    expect(col.out).toContain("ignored for a child component");
    // A child is not a route.
    expect(col.out).not.toContain("Router.flow(");
  });
});

describe("make:flow — crud", () => {
  it("scaffolds a resourceful page with validation + list/create/edit/delete", async () => {
    const dir = await freshDir();
    const { c } = mk({ name: "Posts" }, { dir, crud: true });
    await c.run();

    const src = await Bun.file(join(dir, "Posts.tsx")).text();
    expect(src).toContain("@validate((rule) => rule.required().min(2))");
    expect(src).toContain("async save()");
    expect(src).toContain("edit(id: number)");
    expect(src).toContain("async destroy(id: number)");
    expect(src).toContain("this.resetValidation()");
    expect(src).toContain("error={this.errors.name}");
  });
});

/** Run a command once (used to pre-create a file for the overwrite test). */
async function c_run(
  _dir: string,
  args: Record<string, string>,
  flags: Record<string, unknown>,
): Promise<void> {
  const { c } = mk(args, flags);
  await c.run();
}
