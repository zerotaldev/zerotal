import { describe, it, expect } from "bun:test";
import { deepMerge, BaseMiddleware } from "./BaseMiddleware.ts";
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

// ── deepMerge ─────────────────────────────────────────────────────────────────

describe("deepMerge()", () => {
  it("merges flat properties", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it("recursively merges nested objects (line 18)", () => {
    const base = { db: { host: "localhost", port: 5432 } };
    const override = { db: { port: 5433 } };
    const result = deepMerge(base, override);
    expect(result.db.host).toBe("localhost"); // preserved
    expect(result.db.port).toBe(5433); // overridden
  });

  it("replaces non-object with object override", () => {
    const result = deepMerge({ x: 1 } as { x: unknown }, { x: { y: 2 } as unknown });
    expect((result.x as { y: number }).y).toBe(2);
  });

  it("skips undefined override values", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: undefined });
    expect(result.b).toBe(2); // unchanged — undefined is skipped
  });
});

// ── BaseMiddleware.with() ─────────────────────────────────────────────────

interface TestOpts {
  timeout: number;
  nested: { retries: number; delay: number };
}

class TestMiddleware extends BaseMiddleware<TestOpts> {
  protected options: TestOpts = { timeout: 5000, nested: { retries: 3, delay: 100 } };
  async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
    return next();
  }
}

describe("BaseMiddleware.with()", () => {
  it("merges flat options on top of defaults", () => {
    const Cls = TestMiddleware.with({ timeout: 1000 });
    const mw = new Cls();
    expect((mw as unknown as { options: TestOpts }).options.timeout).toBe(1000);
    expect((mw as unknown as { options: TestOpts }).options.nested.retries).toBe(3);
  });

  it("deep-merges nested options (exercises deepMerge recursion)", () => {
    const Cls = TestMiddleware.with({ nested: { retries: 5 } });
    const mw = new Cls();
    const opts = (mw as unknown as { options: TestOpts }).options;
    expect(opts.nested.retries).toBe(5); // overridden
    expect(opts.nested.delay).toBe(100); // preserved via deep merge
  });
});

describe("BaseMiddleware.with() — identity", () => {
  it("keeps the base class name, so a configured middleware stays identifiable", () => {
    class ThrottleFake extends BaseMiddleware<{ limit?: number }> {
      protected options: { limit?: number } = { limit: 60 };
      async handle(): Promise<void> {}
    }

    // A class expression is anonymous; without carrying the name across, a
    // configured middleware shows up as "" in the pipeline listing and in
    // `route:list`.
    expect(ThrottleFake.with({ limit: 10 }).name).toBe("ThrottleFake");
  });

  it("still applies the options it was configured with", () => {
    class Configurable extends BaseMiddleware<{ limit?: number; burst?: number }> {
      protected options: { limit?: number; burst?: number } = { limit: 60, burst: 5 };
      async handle(): Promise<void> {}
      read(): { limit?: number; burst?: number } {
        return this.options;
      }
    }

    const instance = new (Configurable.with({ limit: 10 }))();

    expect(instance.read()).toEqual({ limit: 10, burst: 5 });
  });
});
