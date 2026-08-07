import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { FlowAddCommand } from "./FlowAddCommand.ts";
import { FlowInitCommand } from "./FlowInitCommand.ts";
import { FlowListCommand } from "./FlowListCommand.ts";
import { missingRuntimeDeps } from "./support.ts";
import { COMPONENTS } from "../registry.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "gelui-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

function mk<
  T extends { _writer: unknown; args: Record<string, string>; flags: Record<string, unknown> },
>(
  C: new () => T,
  args: Record<string, string> = {},
  flags: Record<string, unknown> = {},
): { c: T; col: Collector } {
  const c = new C();
  const col = new Collector();
  c._writer = col;
  c.args = args;
  c.flags = flags;
  return { c, col };
}

describe("flow:add", () => {
  it("copies a component + its utils with rewritten imports", async () => {
    const dir = await freshDir();
    const { c, col } = mk(FlowAddCommand, { name: "button" }, { dir });
    await c.run();

    expect(await Bun.file(join(dir, "Button.tsx")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "lib/cn.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "lib/gva.ts")).exists()).toBe(true);

    const button = await Bun.file(join(dir, "Button.tsx")).text();
    expect(button).toContain(`from "./lib/gva.ts"`);
    expect(button).not.toContain("../utils/");
    expect(col.out).toContain("Done — 1 added");
  });

  it("copies several comma-separated components", async () => {
    const dir = await freshDir();
    const { c } = mk(FlowAddCommand, { name: "card,dialog,alert" }, { dir });
    await c.run();
    for (const f of ["Card.tsx", "Dialog.tsx", "Alert.tsx"]) {
      expect(await Bun.file(join(dir, f)).exists()).toBe(true);
    }
  });

  it("--all writes every component", async () => {
    const dir = await freshDir();
    const { c } = mk(FlowAddCommand, {}, { dir, all: true });
    await c.run();
    for (const comp of COMPONENTS) {
      expect(await Bun.file(join(dir, comp.target)).exists()).toBe(true);
    }
  });

  it("skips an existing file but overwrites with --force", async () => {
    const dir = await freshDir();
    await mk(FlowAddCommand, { name: "badge" }, { dir }).c.run();
    await Bun.write(join(dir, "Badge.tsx"), "// user edits");

    const skip = mk(FlowAddCommand, { name: "badge" }, { dir });
    await skip.c.run();
    expect(skip.col.out).toContain("already exists");
    expect(await Bun.file(join(dir, "Badge.tsx")).text()).toBe("// user edits");

    const force = mk(FlowAddCommand, { name: "badge" }, { dir, force: true });
    await force.c.run();
    expect(await Bun.file(join(dir, "Badge.tsx")).text()).toContain("export function Badge");
  });

  it("rejects unknown components without writing anything", async () => {
    const dir = await freshDir();
    const { c, col } = mk(FlowAddCommand, { name: "button,frobnicator" }, { dir });
    await c.run();
    expect(col.out).toContain("Unknown component(s): frobnicator");
    expect(await Bun.file(join(dir, "Button.tsx")).exists()).toBe(false);
  });

  it("errors with guidance when no name is given", async () => {
    const dir = await freshDir();
    const { c, col } = mk(FlowAddCommand, { name: "" }, { dir });
    await c.run();
    expect(col.out).toContain("Name a component");
  });
});

describe("flow:init", () => {
  it("drops utils and injects the theme import after tailwindcss", async () => {
    const dir = await freshDir();
    const css = join(dir, "app.css");
    await Bun.write(css, `@import "tailwindcss";\n`);

    const { c, col } = mk(FlowInitCommand, {}, { dir: join(dir, "ui"), css });
    await c.run();

    expect(await Bun.file(join(dir, "ui/lib/cn.ts")).exists()).toBe(true);
    const out = await Bun.file(css).text();
    expect(out).toContain(`@import "tailwindcss";`);
    expect(out).toContain(`@import "@zerotal/flow-ui/theme.css";`);
    // theme must come AFTER tailwindcss
    expect(out.indexOf("flow-ui/theme.css")).toBeGreaterThan(out.indexOf("tailwindcss"));
    expect(col.out).toContain("flow-ui is ready");
  });

  it("is idempotent (no duplicate theme import on re-run)", async () => {
    const dir = await freshDir();
    const css = join(dir, "app.css");
    await Bun.write(css, `@import "tailwindcss";\n`);
    const flags = { dir: join(dir, "ui"), css };
    await mk(FlowInitCommand, {}, flags).c.run();
    await mk(FlowInitCommand, {}, flags).c.run();
    const out = await Bun.file(css).text();
    expect(out.split("flow-ui/theme.css").length - 1).toBe(1);
  });
});

describe("runtime deps", () => {
  it("reports nothing missing when clsx + tailwind-merge resolve (flow-ui's own cwd)", () => {
    // flow-ui depends on both, so from its package root they always resolve.
    expect(missingRuntimeDeps(import.meta.dir)).toEqual([]);
  });
});

describe("flow:list", () => {
  it("prints every component", async () => {
    const { c, col } = mk(FlowListCommand);
    await c.run();
    expect(col.out).toContain("button");
    expect(col.out).toContain("dropdown-menu");
    expect(col.out).toContain(`${COMPONENTS.length} components`);
  });
});
