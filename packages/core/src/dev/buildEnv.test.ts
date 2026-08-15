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
    expect(Object.keys(defines)).toEqual(["import.meta.env"]);
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
