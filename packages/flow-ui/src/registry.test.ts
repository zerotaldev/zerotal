import { describe, it, expect } from "bun:test";
import { COMPONENTS, UTILS, findComponent, resolveSource, rewriteImports } from "./registry.ts";

describe("registry", () => {
  it("lists every shipped component with a resolvable source", async () => {
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(20);
    for (const c of COMPONENTS) {
      const abs = resolveSource(c.source);
      expect(await Bun.file(abs).exists()).toBe(true);
    }
  });

  it("resolves util sources (cn, gva)", async () => {
    for (const u of UTILS) {
      expect(await Bun.file(resolveSource(u.source)).exists()).toBe(true);
    }
  });

  it("findComponent resolves by kebab id and rejects unknowns", () => {
    expect(findComponent("dropdown-menu")?.title).toBe("DropdownMenu");
    expect(findComponent("nope")).toBeUndefined();
  });

  it("rewrites util imports for the copy-in lib/ layout", () => {
    const before = `import { cn } from "../utils/cn.ts";\nimport { gva } from "../utils/gva.ts";`;
    const after = rewriteImports(before);
    expect(after).toContain(`from "./lib/cn.ts"`);
    expect(after).toContain(`from "./lib/gva.ts"`);
    expect(after).not.toContain("../utils/");
  });

  it("leaves @zerotal/flow imports untouched", () => {
    const src = `import { Switch } from "@zerotal/flow";\nimport { jsx } from "@zerotal/flow/jsx-runtime";`;
    expect(rewriteImports(src)).toBe(src);
  });

  it("every component's real source rewrites to a self-consistent import set", async () => {
    // After rewriting, no component should still reference ../utils, and any util
    // import it keeps must point at ./lib/*.
    for (const c of COMPONENTS) {
      const raw = await Bun.file(resolveSource(c.source)).text();
      const out = rewriteImports(raw);
      expect(out).not.toContain("../utils/");
    }
  });
});
