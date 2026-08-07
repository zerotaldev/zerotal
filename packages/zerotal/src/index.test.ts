import { describe, expect, it } from "bun:test";

/**
 * The meta package has no behaviour of its own — the contract is that every
 * entry point re-exports its underlying stable package. A missing dependency,
 * a typo'd specifier, or an empty re-export all surface here.
 */
describe("zerotal meta package", () => {
  it("re-exports @zerotal/core at the root", async () => {
    const root = await import("./index.ts");
    expect(root.Application).toBeDefined();
    expect(Object.keys(root).length).toBeGreaterThan(10);
  });

  it("every subpath re-exports a non-empty module", async () => {
    const subpaths = [
      // stable sibling packages
      "auth",
      "cache",
      "client",
      "orm",
      "queue",
      "scheduler",
      "session",
      "testing",
      "validator",
      // @zerotal/core subpaths, mirrored 1:1
      "assets",
      "build",
      "carbon",
      "commands",
      "config-reexport",
      "dev",
      "env",
      "facades",
      "health",
      "helpers",
      "http",
      "jsx-runtime",
      "lock",
      "logger",
      "metrics",
      "security",
      "storage",
      "view",
    ];
    for (const name of subpaths) {
      const mod = await import(`./${name}.ts`);
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
    // contracts is types-only: the import must resolve, but it exports no
    // runtime values.
    expect(await import("./contracts.ts")).toBeDefined();
  });
});
