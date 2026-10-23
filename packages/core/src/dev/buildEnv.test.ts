import { describe, it, expect } from "bun:test";
import { browserEnvDefines } from "./buildEnv.ts";

describe("browserEnvDefines", () => {
  it("defines the whole import.meta.env object, not its members", () => {
    // The bug this exists for: `define` keyed on `import.meta.env.DEV` does NOT
    // match `import.meta.env?.DEV`, which is exactly how the Inertia adapter reads
    // it — so a member-keyed define compiles to a no-op and the DevTools panel goes
    // on reporting that the app is not in dev mode. Replacing the object satisfies
    // the optional-chained and plain spellings alike.
    const defines = browserEnvDefines(false);
    expect(Object.keys(defines)).toContain("import.meta.env");
    expect(Object.keys(defines)).not.toContain("import.meta.env.DEV");
  });

  it("states NODE_ENV, the switch React and most of npm read", () => {
    expect(browserEnvDefines(true)["process.env.NODE_ENV"]).toBe('"production"');
    expect(browserEnvDefines(false)["process.env.NODE_ENV"]).toBe('"development"');
  });

  it("drops development-only code from a production bundle, whatever the shell's NODE_ENV", async () => {
    // The failure this pins: a production build run without NODE_ENV in the
    // environment kept every `process.env.NODE_ENV !== "production"` branch —
    // which is how React's development build reached a live site.
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "zt-buildenv-"));
    const was = process.env["NODE_ENV"];
    try {
      delete process.env["NODE_ENV"];
      const entry = join(dir, "entry.js");
      await writeFile(
        entry,
        [
          'if (process.env.NODE_ENV !== "production") console.log("DEV-ONLY-BRANCH");',
          'console.log("always");',
        ].join("\n"),
      );
      const build = async (production: boolean) => {
        const result = await Bun.build({
          entrypoints: [entry],
          target: "browser",
          minify: production,
          define: browserEnvDefines(production),
        });
        expect(result.success).toBe(true);
        return result.outputs[0]!.text();
      };

      expect(await build(true)).not.toContain("DEV-ONLY-BRANCH");
      expect(await build(false)).toContain("DEV-ONLY-BRANCH");
    } finally {
      if (was === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = was;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says development for a non-production build", () => {
    const env = JSON.parse(browserEnvDefines(false)["import.meta.env"]!);
    expect(env).toEqual({ DEV: true, PROD: false, MODE: "development" });
  });

  it("says production for a production build", () => {
    const env = JSON.parse(browserEnvDefines(true)["import.meta.env"]!);
    expect(env).toEqual({ DEV: false, PROD: true, MODE: "production" });
  });

  it("emits valid JS source, because a define is substituted as text", () => {
    // Bun splices the value in as source, so anything unparseable is a build error
    // rather than a wrong value — worth pinning since it is written by hand.
    const source = browserEnvDefines(true)["import.meta.env"]!;
    expect(() => JSON.parse(source)).not.toThrow();
    expect(source.startsWith("{")).toBe(true);
  });
});
