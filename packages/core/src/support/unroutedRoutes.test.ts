import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unroutedRoutesWarning } from "./unroutedRoutes.ts";

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `zt-unrouted-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("unroutedRoutesWarning", () => {
  it("is silent when there is no routes/ directory", () => {
    expect(unroutedRoutesWarning(root, [])).toBeNull();
  });

  it("is silent when routes/ holds no route files", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "README.md"), "docs, not routes");
    writeFileSync(join(root, "routes", "index.test.ts"), "");
    expect(unroutedRoutesWarning(root, [])).toBeNull();
  });

  it("warns when routes/ holds a file no routing() group loads", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    const warning = unroutedRoutesWarning(root, []);
    expect(warning).toContain("index.ts");
    expect(warning).toContain('.routing("./routes/index.ts")');
  });

  it("suggests the actual file when index.ts is absent", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "web.ts"), "");
    expect(unroutedRoutesWarning(root, [])).toContain('.routing("./routes/web.ts")');
  });

  it("is silent when a routing() group covers a file inside routes/", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    expect(unroutedRoutesWarning(root, [join(root, "routes", "index.ts")])).toBeNull();
  });

  it("still warns when the routed file lives elsewhere", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    const elsewhere = join(root, "app", "http", "routes.ts");
    expect(unroutedRoutesWarning(root, [elsewhere])).not.toBeNull();
  });

  it("does not treat a sibling like routes-extra/ as covered", () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    expect(unroutedRoutesWarning(root, [join(root, "routes-extra", "index.ts")])).not.toBeNull();
  });
});
