import { describe, it, expect, beforeEach } from "bun:test";
import {
  registerTypeGenerator,
  _runTypeGenerators,
  _resetTypeGenerators,
} from "./TypeGenerators.ts";

beforeEach(() => {
  _resetTypeGenerators();
});

describe("registerTypeGenerator", () => {
  it("runs a registered routine and returns what it generated", async () => {
    registerTypeGenerator("inertia", async () => ({
      file: "resources/js/pages.generated.ts",
      summary: "12 pages",
      changed: true,
    }));

    const outcomes = await _runTypeGenerators({ check: false });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.name).toBe("inertia");
    expect(outcomes[0]?.result?.file).toBe("resources/js/pages.generated.ts");
  });

  it("passes `check` through, so CI can gate without writing", async () => {
    let sawCheck: boolean | undefined;
    registerTypeGenerator("inertia", async (options) => {
      sawCheck = options.check;
      return { file: "f", summary: "0 pages", changed: false };
    });

    await _runTypeGenerators({ check: true });

    expect(sawCheck).toBe(true);
  });

  it("replaces a routine registered twice under one name", async () => {
    // A provider registers on every boot, and `route:types` boots the app.
    registerTypeGenerator("inertia", async () => ({ file: "old", summary: "", changed: false }));
    registerTypeGenerator("inertia", async () => ({ file: "new", summary: "", changed: false }));

    const outcomes = await _runTypeGenerators({ check: false });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.result?.file).toBe("new");
  });

  it("returns one routine's error without stopping the others", async () => {
    // A broken page registry should not cost you your route types, and the
    // error still has to reach the command so it can exit non-zero.
    registerTypeGenerator("broken", async () => {
      throw new Error("pages directory is missing");
    });
    registerTypeGenerator("fine", async () => ({ file: "f", summary: "3 pages", changed: true }));

    const outcomes = await _runTypeGenerators({ check: false });

    expect(outcomes).toHaveLength(2);
    expect((outcomes[0]?.error as Error).message).toContain("pages directory is missing");
    expect(outcomes[1]?.result?.summary).toBe("3 pages");
  });

  it("is empty in an app with no view package installed", async () => {
    expect(await _runTypeGenerators({ check: false })).toEqual([]);
  });
});
