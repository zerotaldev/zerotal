import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import { CacheManager } from "./CacheManager.ts";
import { MemoryDriver } from "./drivers/MemoryDriver.ts";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import type { CacheDriver } from "./drivers/CacheDriver.ts";

/**
 * A counter shared by several processes has to be added to in one step. Reading, adding and
 * writing back loses an update whenever two processes interleave, and for a spend ceiling or a
 * rate counter the lost update is always an under-count.
 */
const drivers: Array<[string, () => CacheDriver]> = [
  ["memory", () => new MemoryDriver(0)],
  ["sqlite", () => new SqliteDriver(new SQL(":memory:") as never)],
];

describe.each(drivers)("Cache.increment on the %s driver", (_name, make) => {
  const cache = () => new CacheManager(make(), "t:", 3600);

  it("starts a missing key at the amount and returns the new total", async () => {
    const c = cache();

    expect(await c.increment("hits")).toBe(1);
    expect(await c.increment("hits")).toBe(2);
    expect(await c.increment("hits", 5)).toBe(7);
  });

  it("is readable with get() as a plain number", async () => {
    const c = cache();
    await c.increment("n", 3);

    expect(await c.get<number>("n")).toBe(3);
  });

  it("adds fractions and negatives, and decrement subtracts", async () => {
    const c = cache();

    expect(await c.increment("f", 0.5)).toBe(0.5);
    expect(await c.increment("f", 0.25)).toBe(0.75);
    expect(await c.decrement("f", 2)).toBe(-1.25);
  });

  it("loses nothing when many are added at once", async () => {
    const c = cache();

    await Promise.all(Array.from({ length: 200 }, () => c.increment("race")));

    expect(await c.get<number>("race")).toBe(200);
  });

  it("starts again from zero once an entry has expired", async () => {
    const c = cache();
    await c.set("old", 40, -1); // already expired

    expect(await c.increment("old")).toBe(1);
  });

  it("treats a key that holds something else as zero", async () => {
    const c = cache();
    await c.set("word", "hello");

    expect(await c.increment("word", 2)).toBe(2);
  });

  it("keeps the expiry it started with, rather than extending it on every addition", async () => {
    const c = cache();

    await c.increment("ttl", 1, 1);
    // A later addition with a much longer ttl must not push the expiry out.
    expect(await c.increment("ttl", 1, 100_000)).toBe(2);
    await Bun.sleep(1100);

    expect(await c.get("ttl")).toBeNull();
  });

  it("keeps separate keys separate", async () => {
    const c = cache();
    await c.increment("a", 1);
    await c.increment("b", 10);

    expect([await c.get("a"), await c.get("b")]).toEqual([1, 10]);
  });
});

describe("a driver without increment", () => {
  class Plain implements CacheDriver {
    private store = new Map<string, string>();
    async get(key: string) {
      return this.store.get(key) ?? null;
    }
    async set(key: string, value: string) {
      this.store.set(key, value);
    }
    async forget(key: string) {
      this.store.delete(key);
    }
    async has(key: string) {
      return this.store.has(key);
    }
    async flush() {
      this.store.clear();
    }
  }

  it("still counts, by reading and writing back", async () => {
    const c = new CacheManager(new Plain(), "", 3600);

    expect(await c.increment("n")).toBe(1);
    expect(await c.increment("n", 4)).toBe(5);
    expect(await c.get<number>("n")).toBe(5);
  });
});
