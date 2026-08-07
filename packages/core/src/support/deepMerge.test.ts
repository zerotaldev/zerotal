import { describe, it, expect } from "bun:test";
import { deepMerge } from "./deepMerge.ts";

describe("deepMerge", () => {
  it("merges nested objects key-by-key (a partial override keeps sibling defaults)", () => {
    const base = { cors: { origin: "*", credentials: false }, port: 3000 };
    const merged = deepMerge(base, { cors: { credentials: true } });
    expect(merged).toEqual({ cors: { origin: "*", credentials: true }, port: 3000 });
  });

  it("merges three levels deep", () => {
    const merged = deepMerge(
      { conventions: { enabled: true, paths: { models: "app/models", policies: "app/policies" } } },
      { conventions: { paths: { models: "src/models" } } },
    );
    expect(merged.conventions.paths).toEqual({ models: "src/models", policies: "app/policies" });
    expect(merged.conventions.enabled).toBe(true);
  });

  it("replaces arrays and primitives wholesale (no concat, no element merge)", () => {
    expect(deepMerge({ a: [1, 2], b: 1 }, { a: [3], b: 2 })).toEqual({ a: [3], b: 2 });
    expect(deepMerge({ tags: ["a", "b"] }, { tags: ["c"] })).toEqual({ tags: ["c"] });
  });

  it("ignores undefined overrides and does not mutate the base", () => {
    const base = { a: 1, b: { c: 2 } };
    const merged = deepMerge(base, { a: undefined } as Partial<typeof base>);
    expect(merged).toEqual({ a: 1, b: { c: 2 } });
    expect(base.b.c).toBe(2);
  });

  it("isolates the result from the base — mutating the merge can't corrupt shared defaults", () => {
    const defaults = { sqlite: { path: ":memory:" }, tags: ["x"] };
    const merged = deepMerge(defaults, {});
    // The merged result must not alias the base's nested structures.
    expect(merged.sqlite).not.toBe(defaults.sqlite);
    expect(merged.tags).not.toBe(defaults.tags);
    merged.sqlite.path = "./real.db";
    merged.tags.push("y");
    expect(defaults.sqlite.path).toBe(":memory:");
    expect(defaults.tags).toEqual(["x"]);
  });

  it("isolates the result from the override — mutating the merge can't reach the caller's input", () => {
    const override = { sqlite: { path: "./real.db" }, tags: ["y"] };
    const merged = deepMerge({ sqlite: { path: ":memory:" }, tags: ["x"] }, override);
    expect(merged.sqlite).not.toBe(override.sqlite);
    expect(merged.tags).not.toBe(override.tags);
    merged.tags.push("z");
    expect(override.tags).toEqual(["y"]);
  });

  it("treats class instances as atomic — replaced by reference, never merged or cloned", () => {
    class Driver {
      constructor(public name: string) {}
      connect() {
        return this.name;
      }
    }
    const base = { driver: new Driver("memory") as Driver | null };
    const replacement = new Driver("redis");
    const merged = deepMerge(base, { driver: replacement });
    expect(merged.driver).toBe(replacement); // same reference — prototype preserved
    expect(merged.driver?.connect()).toBe("redis"); // methods still work
  });

  it("passes functions through by reference (e.g. predicate options)", () => {
    const auth = (u: unknown) => u != null;
    const merged = deepMerge({ auth: (() => false) as (u: unknown) => boolean }, { auth });
    expect(merged.auth).toBe(auth);
  });

  it("does not pollute Object.prototype when merging untrusted input", () => {
    const malicious = JSON.parse('{ "__proto__": { "polluted": true } }') as Record<
      string,
      unknown
    >;
    const merged = deepMerge({ safe: true }, malicious as Partial<{ safe: boolean }>);
    expect(merged).toEqual({ safe: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("fills in a key the base lacks, deep-cloning the override value", () => {
    const override = { added: { nested: 1 } };
    const merged = deepMerge({} as { added?: { nested: number } }, override);
    expect(merged.added).toEqual({ nested: 1 });
    expect(merged.added).not.toBe(override.added);
  });
});
