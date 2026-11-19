/**
 * The `dist/` a package's `prepack` writes, and the index that lets a compiled app
 * carry it. The packages' own tests pack and compile for real; these pin the two
 * properties that are this helper's alone.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource, writeBrowserBundles } from "./browser-bundles.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "zt-browser-bundles-"));
  dirs.push(dir);
  return dir;
}

describe("the index", () => {
  it("imports each bundle as a file and maps its name to the path", async () => {
    const dist = join(scratch(), "dist");
    writeBrowserBundles(dist, { runtime: "window.a = 1;", "runtime.csp": "window.b = 2;" });
    const source = indexSource(["runtime", "runtime.csp"]);
    expect(source).toContain(`import bundle1 from "./runtime.csp.js" with { type: "file" };`);

    // Loaded the way a package loads it: a path per bundle, each reading back the code.
    const index = (await import(join(dist, "assets.js"))) as { default: Record<string, string> };
    expect(await Bun.file(index.default["runtime"]!).text()).toBe("window.a = 1;");
    expect(await Bun.file(index.default["runtime.csp"]!).text()).toBe("window.b = 2;");
  });
});

describe("writeBrowserBundles", () => {
  it("replaces dist/, so a bundle no longer built cannot ship again", () => {
    const dist = join(scratch(), "dist");
    writeBrowserBundles(dist, { old: "1" });
    writeFileSync(join(dist, "stray.js"), "left behind");
    const written = writeBrowserBundles(dist, { runtime: "2" });
    expect(written).toEqual(["runtime.js", "assets.js"]);
    expect(readdirSync(dist).sort()).toEqual(["assets.js", "runtime.js"]);
    expect(existsSync(join(dist, "old.js"))).toBe(false);
  });
});
