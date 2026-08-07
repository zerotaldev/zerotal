import { describe, it, expect } from "bun:test";
import {
  runConventions,
  importConventionModules,
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
});
