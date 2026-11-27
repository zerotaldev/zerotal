import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runConventions,
  _isDevCommand,
  importConventionModules,
  _bootImportFailures,
  _resetBootImportFailures,
  type ConcernDescriptor,
  type ConcernContext,
} from "./ConventionLoader.ts";

const ctx: ConcernContext = {
  app: {} as never,
  env: "test",
  resolve: () => undefined,
};

describe("runConventions", () => {
  it("scans a dir, imports files, skips _-prefixed, and registers exports", async () => {
    const collected: string[] = [];
    const concern: ConcernDescriptor = {
      name: "widgets",
      order: 10,
      dir: "widgets",
      register(mod) {
        for (const v of Object.values(mod)) {
          const marker = (v as { marker?: string }).marker;
          if (marker) collected.push(marker);
        }
      },
    };

    await runConventions([concern], {
      root: `${import.meta.dir}/__fixtures__`,
      env: "test",
      ctx,
    });

    expect(collected.sort()).toEqual(["alpha", "beta"]); // _helper.ts skipped
  });

  it("runs concerns in ascending order and supports one-shot run()", async () => {
    const order: string[] = [];
    const a: ConcernDescriptor = { name: "a", order: 30, run: () => void order.push("a") };
    const b: ConcernDescriptor = { name: "b", order: 10, run: () => void order.push("b") };
    const c: ConcernDescriptor = { name: "c", order: 20, run: () => void order.push("c") };

    await runConventions([a, b, c], { root: import.meta.dir, env: "test", ctx });
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("skips concerns whose envs exclude the current env", async () => {
    let ran = false;
    const concern: ConcernDescriptor = {
      name: "console-only",
      order: 1,
      envs: ["console"],
      run: () => void (ran = true),
    };
    await runConventions([concern], { root: import.meta.dir, env: "test", ctx });
    expect(ran).toBe(false);
  });

  it("says so when it skips a directory the app has files in", async () => {
    // Skipping by not looking is correct and completely silent, which is how an app
    // ran for weeks in production with app/schedules full and no worker process.
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const concern: ConcernDescriptor = {
        name: "conventions",
        order: 1,
        // This test file's own directory: guaranteed non-empty, no fixture needed.
        dir: ".",
        envs: ["worker"],
        register: () => {},
      };
      await runConventions([concern], { root: import.meta.dir, env: "web", ctx });
      // The console channel writes through a promise; let it land.
      await Promise.resolve();
    } finally {
      process.stdout.write = original;
    }

    const announced = lines.join(" | ");
    expect(announced).toContain("conventions");
    expect(announced).toContain("env=web");
    expect(announced).toContain("worker");
  });

  it("stays quiet under zt dev, where the convention's own process runs it", async () => {
    // From the 1.18.1 walk: every server restart under `zt dev` said app/schedules was skipped,
    // while the scheduler tab beside it was running them.
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const before = Bun.env["ZT_DEV"];
    Bun.env["ZT_DEV"] = "1";

    try {
      const concern: ConcernDescriptor = {
        name: "conventions",
        order: 1,
        dir: ".",
        envs: ["worker"],
        register: () => {},
      };
      await runConventions([concern], { root: import.meta.dir, env: "web", ctx });
      await Promise.resolve();
    } finally {
      process.stdout.write = original;
      if (before === undefined) delete Bun.env["ZT_DEV"];
      else Bun.env["ZT_DEV"] = before;
    }

    expect(lines.join(" | ")).not.toContain("Skipping");
  });

  it("knows the zt dev process itself, which boots the app only to ask what to run", () => {
    expect(_isDevCommand(["dev"])).toBe(true);
    expect(_isDevCommand(["d", "--only=queue"])).toBe(true);
    expect(_isDevCommand(["serve", "--dev"])).toBe(true);
    expect(_isDevCommand(["serve", "--port=3000"])).toBe(false);
    expect(_isDevCommand(["worker"])).toBe(false);
    expect(_isDevCommand([])).toBe(false);
  });

  it("stays quiet about a skipped directory with nothing in it", async () => {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const concern: ConcernDescriptor = {
        name: "empty-thing",
        order: 1,
        dir: "does-not-exist",
        envs: ["worker"],
        register: () => {},
      };
      await runConventions([concern], { root: import.meta.dir, env: "web", ctx });
      await Promise.resolve();
    } finally {
      process.stdout.write = original;
    }

    expect(lines.join(" | ")).not.toContain("empty-thing");
  });

  it("ignores a missing directory without throwing", async () => {
    let called = false;
    const concern: ConcernDescriptor = {
      name: "nope",
      order: 1,
      dir: "does-not-exist",
      register: () => void (called = true),
    };
    await runConventions([concern], { root: import.meta.dir, env: "test", ctx });
    expect(called).toBe(false);
  });
});

describe("importConventionModules", () => {
  it("imports each non-skipped file and yields its module (used by provider/middleware discovery)", async () => {
    const markers: string[] = [];
    await importConventionModules(`${import.meta.dir}/__fixtures__/widgets`, "test", (mod) => {
      for (const v of Object.values(mod)) {
        const m = (v as { marker?: string }).marker;
        if (m) markers.push(m);
      }
    });
    expect(markers.sort()).toEqual(["alpha", "beta"]); // _helper.ts skipped
  });

  it("is a no-op for a missing directory", async () => {
    let called = false;
    await importConventionModules(`${import.meta.dir}/missing`, "test", () => void (called = true));
    expect(called).toBe(false);
  });

  describe("a file that will not import", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "zt-convention-import-"));
      await Bun.write(join(dir, "Good.ts"), 'export const Good = { marker: "good" };');
      await Bun.write(join(dir, "Broken.ts"), 'throw new Error("model import failure");');
      _resetBootImportFailures();
    });
    afterEach(async () => {
      _resetBootImportFailures();
      await rm(dir, { recursive: true, force: true });
    });

    it("is skipped and recorded outside the dev worker", async () => {
      const markers: string[] = [];
      await importConventionModules(dir, "models", (mod) => {
        for (const v of Object.values(mod)) markers.push(String((v as { marker?: string }).marker));
      });
      expect(markers).toEqual(["good"]);
      expect(_bootImportFailures()).toEqual([`${dir}/Broken.ts`]);
    });

    it("fails the boot under the dev worker", async () => {
      const before = Bun.env["ZT_DEV"];
      Bun.env["ZT_DEV"] = "1";
      try {
        await expect(importConventionModules(dir, "models", () => {})).rejects.toThrow(
          /model import failure/,
        );
      } finally {
        if (before === undefined) delete Bun.env["ZT_DEV"];
        else Bun.env["ZT_DEV"] = before;
      }
    });

    it("still only logs a handler that throws, under the dev worker too", async () => {
      await rm(join(dir, "Broken.ts"));
      const before = Bun.env["ZT_DEV"];
      Bun.env["ZT_DEV"] = "1";
      try {
        await importConventionModules(dir, "models", () => {
          throw new Error("register failed");
        });
      } finally {
        if (before === undefined) delete Bun.env["ZT_DEV"];
        else Bun.env["ZT_DEV"] = before;
      }
      expect(_bootImportFailures()).toEqual([]);
    });
  });
});
