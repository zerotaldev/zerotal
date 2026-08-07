import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { SQL } from "bun";
import { CacheManager } from "./CacheManager.ts";
import { FrameworkEvents } from "@zerotal/core";
import { CacheQueried } from "./events.ts";
import { MemoryDriver } from "./drivers/MemoryDriver.ts";
import { SqliteDriver } from "./drivers/SqliteDriver.ts";
import { LockManager, MemoryLockDriver } from "@zerotal/core/lock";
import type { CacheDriver } from "./drivers/CacheDriver.ts";
import { CacheConfig } from "./config.ts";
import { CacheClearCommand } from "./commands/CacheClearCommand.ts";

// ── Shared test suite ─────────────────────────────────────────────────────────
// Runs the same assertions against any CacheDriver implementation.
// This proves driver interchangeability — the contract is identical.

function runDriverSuite(
  name: string,
  makeDriver: () => { driver: CacheDriver; cleanup?: () => Promise<void> },
) {
  describe(`CacheManager — ${name} driver`, () => {
    let cache: CacheManager;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const result = makeDriver();
      cleanup = result.cleanup;
      cache = new CacheManager(result.driver, "test:", 60);
      await cache.flush();
    });

    it("returns null for missing key", async () => {
      expect(await cache.get("missing")).toBeNull();
    });

    it("stores and retrieves a string", async () => {
      await cache.set("name", "Siphesihle");
      expect(await cache.get<string>("name")).toBe("Siphesihle");
    });

    it("stores and retrieves an object (JSON round-trip)", async () => {
      const obj = { id: 1, name: "Alice", active: true };
      await cache.set("user", obj);
      expect(await cache.get<{ id: number; name: string; active: boolean }>("user")).toEqual(obj);
    });

    it("stores and retrieves a number", async () => {
      await cache.set("count", 42);
      expect(await cache.get<number>("count")).toBe(42);
    });

    it("stores and retrieves an array", async () => {
      await cache.set("list", [1, 2, 3]);
      expect(await cache.get<number[]>("list")).toEqual([1, 2, 3]);
    });

    it("has() returns true for existing key", async () => {
      await cache.set("x", "y");
      expect(await cache.has("x")).toBe(true);
    });

    it("has() returns false for missing key", async () => {
      expect(await cache.has("missing")).toBe(false);
    });

    it("forget() removes a key", async () => {
      await cache.set("todelete", "value");
      await cache.forget("todelete");
      expect(await cache.get("todelete")).toBeNull();
      expect(await cache.has("todelete")).toBe(false);
    });

    it("flush() removes all keys under the prefix", async () => {
      await cache.set("a", 1);
      await cache.set("b", 2);
      await cache.flush();
      expect(await cache.get("a")).toBeNull();
      expect(await cache.get("b")).toBeNull();
    });

    it("flush() does not remove keys with a different prefix", async () => {
      const { driver } = makeDriver();
      const other = new CacheManager(driver, "other:");
      await other.set("key", "should-survive");
      await cache.set("key", "should-be-deleted");
      await cache.flush();
      expect(await cache.get("key")).toBeNull();
      expect(await other.get<string>("key")).toBe("should-survive");
    });

    it("returns null for an expired key", async () => {
      const { driver } = makeDriver();
      const shortCache = new CacheManager(driver, "ttl-test:");
      await shortCache.set("expiring", "value", 0);
      await new Promise((r) => setTimeout(r, 2));
      expect(await shortCache.get("expiring")).toBeNull();
    });

    it("remember() returns cached value on second call", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "computed";
      };

      const first = await cache.remember("key", 60, fn);
      const second = await cache.remember("key", 60, fn);

      expect(first).toBe("computed");
      expect(second).toBe("computed");
      expect(callCount).toBe(1);
    });

    it("forever() stores a value with no TTL", async () => {
      await cache.forever("permanent", { x: 1 });
      expect(await cache.get<{ x: number }>("permanent")).toEqual({ x: 1 });
    });

    it("tags().flush() only removes tagged keys", async () => {
      await cache.set("global", "untouched");
      const tagged = cache.tags(["users"]);
      await tagged.set("profile:1", "data");
      await tagged.flush();
      expect(await tagged.get("profile:1")).toBeNull();
      expect(await cache.get<string>("global")).toBe("untouched");
    });

    afterAll(async () => {
      await cleanup?.();
    });
  });
}

// ── Run suite for all three drivers ─────────────────────────────────────────-

let _sqliteDb: SQLInstance | undefined;

runDriverSuite("Memory", () => {
  const driver = new MemoryDriver(0); // 0 = disable auto-sweep in tests
  return {
    driver,
    cleanup: async () => driver.dispose(),
  };
});

runDriverSuite("SQLite (:memory:)", () => {
  if (!_sqliteDb) _sqliteDb = new SQL(":memory:");
  return {
    driver: new SqliteDriver(_sqliteDb),
    cleanup: async () => {
      /* SQLite :memory: auto-cleaned */
    },
  };
});

// ── Stampede prevention (promise coalescing) ──────────────────────────────────

describe("CacheManager — promise coalescing (stampede prevention)", () => {
  it("calls factory only once when concurrent remember() calls arrive on a cold key", async () => {
    let callCount = 0;
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "coalesce:", 60);

    const factory = async () => {
      callCount++;
      // Simulate async work so the event loop can schedule other continuations
      await new Promise((r) => setTimeout(r, 5));
      return "computed";
    };

    // Five concurrent calls — all miss the cache at the same tick
    const results = await Promise.all([
      cache.remember("heavy", 60, factory),
      cache.remember("heavy", 60, factory),
      cache.remember("heavy", 60, factory),
      cache.remember("heavy", 60, factory),
      cache.remember("heavy", 60, factory),
    ]);

    expect(callCount).toBe(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("computed");

    driver.dispose();
  });

  it("releases the in-flight entry after factory resolves (next call re-enters cold path)", async () => {
    let callCount = 0;
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "coalesce2:", 60);

    const factory = async () => {
      callCount++;
      return `call-${callCount}`;
    };

    const first = await cache.remember("key", 60, factory);
    expect(first).toBe("call-1");
    expect(callCount).toBe(1);

    // Evict the cached value then call again — factory must run exactly once more
    await cache.forget("key");
    const second = await cache.remember("key", 60, factory);
    expect(second).toBe("call-2");
    expect(callCount).toBe(2);

    driver.dispose();
  });

  it("releases the in-flight entry after factory throws (next caller retries)", async () => {
    let callCount = 0;
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "coalesce3:", 60);

    const failingFactory = async (): Promise<string> => {
      callCount++;
      throw new Error("factory error");
    };

    await expect(cache.remember("key", 60, failingFactory)).rejects.toThrow("factory error");
    expect(callCount).toBe(1);

    // Lock must be cleared — a subsequent call should retry, not hang
    const goodFactory = async () => {
      callCount++;
      return "recovered";
    };
    const result = await cache.remember("key", 60, goodFactory);
    expect(result).toBe("recovered");
    expect(callCount).toBe(2);

    driver.dispose();
  });
});

describe("CacheManager — cross-process stampede protection (lock)", () => {
  it("runs the factory once across separate managers sharing a lock + driver", async () => {
    let callCount = 0;
    const driver = new MemoryDriver(0);
    const lock = new LockManager(new MemoryLockDriver());

    // Two managers = two processes: separate in-flight maps, so only the shared
    // cross-process lock can serialize the cold-key recompute.
    const a = new CacheManager(driver, "xp:", 60, lock, true);
    const b = new CacheManager(driver, "xp:", 60, lock, true);

    const factory = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return "computed";
    };

    const [ra, rb] = await Promise.all([
      a.remember("heavy", 60, factory),
      b.remember("heavy", 60, factory),
    ]);

    expect(callCount).toBe(1);
    expect(ra).toBe("computed");
    expect(rb).toBe("computed");

    driver.dispose();
  });

  it("degrades to per-manager recompute when no lock driver is configured", async () => {
    let callCount = 0;
    const driver = new MemoryDriver(0);

    // No lock manager → cross-manager coalescing isn't possible; each computes once.
    const a = new CacheManager(driver, "nolock:", 60, null, true);
    const b = new CacheManager(driver, "nolock:", 60, null, true);

    const factory = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return "v";
    };

    await Promise.all([a.remember("k", 60, factory), b.remember("k", 60, factory)]);

    expect(callCount).toBe(2);

    driver.dispose();
  });
});

// ── MemoryDriver active garbage collection ─────────────────────────────────────

describe("MemoryDriver — active GC (sweep)", () => {
  it("sweep() removes expired entries from the internal store", async () => {
    const driver = new MemoryDriver(0); // auto-sweep disabled

    await driver.set("perm", "stays", undefined); // no TTL — lives forever
    await driver.set("temp1", "gone", 0); // TTL 0s — already expired
    await driver.set("temp2", "gone", 0);

    await new Promise((r) => setTimeout(r, 5)); // ensure expiresAt < now

    expect(driver.size).toBe(3); // all three still physically in the map

    driver.sweep();

    expect(driver.size).toBe(1); // only the permanent key survives
    expect(await driver.get("perm")).toBe("stays");

    driver.dispose();
  });

  it("sweep() does not remove entries that have not yet expired", async () => {
    const driver = new MemoryDriver(0);

    await driver.set("long-lived", "value", 3600); // 1 hour TTL

    driver.sweep();

    expect(driver.size).toBe(1);
    expect(await driver.get("long-lived")).toBe("value");

    driver.dispose();
  });

  it("dispose() does not throw and stops further sweeps", () => {
    const driver = new MemoryDriver(100); // 100 ms sweep
    expect(() => driver.dispose()).not.toThrow();
    // Calling dispose twice is also safe
    expect(() => driver.dispose()).not.toThrow();
  });
});

// ── CacheConfig factory ────────────────────────────────────────────────────────

describe("CacheConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = CacheConfig();
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.prefix).toBe("zerotal:cache:");
    expect(cfg.ttl).toBe(3600);
    expect(cfg.sqlite.path).toBe(":memory:");
  });

  it("overrides work", () => {
    const cfg = CacheConfig({ ttl: 600 });
    expect(cfg.ttl).toBe(600);
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.prefix).toBe("zerotal:cache:");
    expect(cfg.sqlite.path).toBe(":memory:");
  });

  it("deep-merges sqlite options", () => {
    const cfg = CacheConfig({ sqlite: { path: "./prod.db" } });
    expect(cfg.sqlite.path).toBe("./prod.db");
    expect(cfg.driver).toBe("sqlite");
    expect(cfg.prefix).toBe("zerotal:cache:");
    expect(cfg.ttl).toBe(3600);
  });
});

// ── FrameworkEvents — CacheQueried ────────────────────────────────────────────

describe("FrameworkEvents — CacheQueried", () => {
  it("fires on cache operations", async () => {
    const events: CacheQueried[] = [];
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "hook:");

    const unsub = FrameworkEvents.on(CacheQueried, (e) => events.push(e));

    await cache.set("k", "v");
    await cache.get("k"); // hit
    await cache.get("missing"); // miss
    await cache.forget("k");

    expect(events.some((e) => e.op === "write")).toBe(true);
    expect(events.some((e) => e.op === "hit")).toBe(true);
    expect(events.some((e) => e.op === "miss")).toBe(true);
    expect(events.some((e) => e.op === "forget")).toBe(true);

    unsub();
    driver.dispose();
  });

  it("unsub() stops events from firing", async () => {
    const events: CacheQueried[] = [];
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "dereg:");

    const unsub = FrameworkEvents.on(CacheQueried, (e) => events.push(e));
    unsub();

    await cache.set("k", "v");
    expect(events).toHaveLength(0);
    driver.dispose();
  });

  it("subscriber exception is swallowed — cache operation still resolves", async () => {
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver, "throw:");

    const unsub = FrameworkEvents.on(CacheQueried, () => {
      throw new Error("boom");
    });

    await expect(cache.set("x", 1)).resolves.toBeUndefined();

    unsub();
    driver.dispose();
  });
});

// ── CacheManager constructor defaults ────────────────────────────────────────

describe("CacheManager — constructor defaults", () => {
  it("works with no prefix and no default TTL", async () => {
    const driver = new MemoryDriver(0);
    const cache = new CacheManager(driver); // no prefix, no TTL
    await cache.set("bare", "val");
    expect(await cache.get<string>("bare")).toBe("val");
    driver.dispose();
  });

  it("dispose() calls driver.dispose when available", () => {
    let disposed = false;
    const mockDriver: CacheDriver = {
      get: async () => null,
      set: async () => {},
      forget: async () => {},
      has: async () => false,
      flush: async () => {},
      dispose: () => {
        disposed = true;
      },
    };
    const cache = new CacheManager(mockDriver);
    cache.dispose();
    expect(disposed).toBe(true);
  });

  it("dispose() is safe when driver has no dispose method", () => {
    const driver = new MemoryDriver(0);
    // MemoryDriver has dispose, so use a minimal driver without one
    const noDisposeDriver: CacheDriver = {
      get: async () => null,
      set: async () => {},
      forget: async () => {},
      has: async () => false,
      flush: async () => {},
    };
    const cache = new CacheManager(noDisposeDriver);
    expect(() => cache.dispose()).not.toThrow();
    driver.dispose();
  });
});

// NOTE: Redis driver tests are intentionally skipped here.
// Redis requires a live Redis server which is not available in CI.
// The RedisDriver implements the same CacheDriver interface,
// so the MemoryDriver and SqliteDriver tests are sufficient
// to verify the CacheManager contract.
// Integration tests against Redis live in a separate optional test file.

// ── CacheClearCommand ──────────────────────────────────────────────────────────

type SilentOutputWriter = { writeLine: () => void; writeError: () => void; write: () => void };

function makeCommand(cache?: { flush(): Promise<void> }) {
  const cmd = Object.create(CacheClearCommand.prototype) as CacheClearCommand;
  (cmd as unknown as Record<string, unknown>).flags = {};
  (cmd as unknown as Record<string, unknown>).args = {};
  // Bypass TerminalWriter (not initialized without constructor)
  (cmd as unknown as Record<string, unknown>)._writer = {
    writeLine: () => {},
    writeError: () => {},
    write: () => {},
  } satisfies SilentOutputWriter;
  if (cache) {
    (cmd as unknown as Record<string, unknown>).app = {
      container: { makeSync: () => cache },
    };
  } else {
    (cmd as unknown as Record<string, unknown>).app = undefined;
  }
  return cmd;
}

describe("CacheClearCommand", () => {
  it("calls flush() on the bound CacheManager", async () => {
    let flushed = false;
    const cmd = makeCommand({
      flush: async () => {
        flushed = true;
      },
    });
    await cmd.run();
    expect(flushed).toBe(true);
  });

  it("prints an error and returns when app is not available", async () => {
    const errors: string[] = [];
    const cmd = makeCommand();
    (cmd as unknown as Record<string, unknown>).error = (msg: string) => errors.push(msg);

    await cmd.run();

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("not available");
  });
});

describe("tag namespaces do not contain one another", () => {
  it("flushing one tag set leaves a superset's entries alone", async () => {
    const cache = new CacheManager(new MemoryDriver());

    await cache.tags(["a"]).set("k", "just-a");
    await cache.tags(["a", "b"]).set("k", "a-and-b");

    // flush() is a prefix delete, and the joined prefix `a:` matched `a:b:k` — so this
    // wiped the ['a','b'] namespace the docblock promises it will not touch.
    await cache.tags(["a"]).flush();

    expect(await cache.tags(["a"]).get("k")).toBeNull();
    expect(await cache.tags(["a", "b"]).get("k")).toBe("a-and-b");
  });

  it("stays order-independent", async () => {
    const cache = new CacheManager(new MemoryDriver());
    await cache.tags(["b", "a"]).set("k", "v");
    expect(await cache.tags(["a", "b"]).get("k")).toBe("v");
  });

  it("does not conflate a tag containing the separator with two tags", async () => {
    const cache = new CacheManager(new MemoryDriver());
    await cache.tags(["a:b"]).set("k", "one-tag");
    await cache.tags(["a", "b"]).set("k", "two-tags");
    expect(await cache.tags(["a:b"]).get("k")).toBe("one-tag");
    expect(await cache.tags(["a", "b"]).get("k")).toBe("two-tags");
  });
});
