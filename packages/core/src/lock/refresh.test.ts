/**
 * Refreshable locks.
 *
 * The driver-level `extend` suite is written once and run against every driver,
 * because the whole point of the contract is that they agree — and the one time
 * they did not agree (the memory driver silently declining to refresh) the
 * failure surfaced somewhere else entirely, hours later, as a lock that expired
 * under a caller who had been told it was extended.
 *
 * Redis runs against an injected fake rather than a live server, and neither
 * skips nor probes. Probing cost 31 seconds per run before failing, and
 * skipping would have repeated the mistake the queue package already made and
 * documented: its Redis suite reached for a server that was not there and timed
 * out fifteen times, so the production backend had no working coverage while
 * appearing to have plenty. The fake below models Redis's actual semantics —
 * `SET NX`, TTL expiry, and the two Lua scripts — so the logic under test is
 * the real logic.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LockManager, ManagedLock } from "./LockManager.ts";
import { LockLostError, LockNotAcquiredError } from "./errors.ts";
import type { LockDriver } from "./drivers/LockDriver.ts";
import { MemoryLockDriver } from "./drivers/MemoryLockDriver.ts";
import { SqliteLockDriver } from "./drivers/SqliteLockDriver.ts";
import { RedisLockDriver } from "./drivers/RedisLockDriver.ts";
import type { RedisLockClient } from "./drivers/RedisLockDriver.ts";

/**
 * Enough of Redis to run this driver honestly: string values with millisecond
 * deadlines, `SET … NX EX`, and an `EVAL` that understands the driver's two
 * scripts by what they do rather than by interpreting Lua.
 */
function fakeRedis(): RedisLockClient {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const live = (key: string): { value: string; expiresAt: number } | undefined => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async set(key, value, ...args): Promise<string | null> {
      const nx = args.includes("NX");
      if (nx && live(key)) return null;
      const exIndex = args.indexOf("EX");
      const ttl = exIndex === -1 ? 3600 : Number(args[exIndex + 1]);
      store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
      return "OK";
    },
    async get(key): Promise<string | null> {
      return live(key)?.value ?? null;
    },
    async expire(key, seconds): Promise<unknown> {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    async del(key): Promise<unknown> {
      return store.delete(key) ? 1 : 0;
    },
    async exists(key): Promise<boolean> {
      return live(key) !== undefined;
    },
    async send(command, args): Promise<unknown> {
      if (command !== "EVAL") throw new Error(`fakeRedis: unsupported command ${command}`);
      const [script, , key, owner, millis] = args as [string, string, string, string, string?];
      // Both scripts are a compare-and-set on the owner; they differ only in
      // what they do once the comparison holds.
      const entry = live(key!);
      if (!entry || entry.value !== owner) return 0;
      if (script!.includes("pexpire")) {
        entry.expiresAt = Date.now() + Number(millis);
        return 1;
      }
      store.delete(key!);
      return 1;
    },
  };
}

interface DriverCase {
  name: string;
  make(): LockDriver;
  dispose?(driver: LockDriver): void;
}

const DRIVERS: DriverCase[] = [
  { name: "MemoryLockDriver", make: () => new MemoryLockDriver() },
  {
    name: "SqliteLockDriver",
    make: () => new SqliteLockDriver(":memory:"),
    dispose: (driver) => driver.dispose?.(),
  },
  {
    name: "RedisLockDriver",
    make: () => new RedisLockDriver("zerotal_lock_test:", fakeRedis()),
  },
];

// ── The shared driver contract ────────────────────────────────────────────────

for (const testCase of DRIVERS) {
  describe(`${testCase.name} — extend()`, () => {
    let driver: LockDriver;

    beforeEach(() => {
      driver = testCase.make();
    });
    afterEach(() => {
      testCase.dispose?.(driver);
    });

    it("extends a lock the caller still holds", async () => {
      await driver.acquire("key", "owner-1", 10);
      expect(await driver.extend!("key", "owner-1", 20)).toBe(true);
    });

    it("actually moves the deadline, not just the return value", async () => {
      await driver.acquire("key", "owner-1", 0.05);
      expect(await driver.extend!("key", "owner-1", 10)).toBe(true);
      await Bun.sleep(80);

      expect(await driver.exists("key")).toBe(true);
      expect(await driver.acquire("key", "owner-2", 10)).toBe(false);
    });

    it("refuses to extend a lock that already expired", async () => {
      // The key is free by now and anyone may have taken it. Reviving it would
      // hand the original owner a lock the world has moved on from.
      await driver.acquire("key", "owner-1", 0.02);
      await Bun.sleep(50);
      expect(await driver.extend!("key", "owner-1", 10)).toBe(false);
    });

    it("refuses to extend a lock owned by someone else", async () => {
      await driver.acquire("key", "owner-1", 10);
      expect(await driver.extend!("key", "owner-2", 60)).toBe(false);
    });

    it("leaves the real holder's deadline alone when a stranger tries", async () => {
      await driver.acquire("key", "owner-1", 0.15);
      await driver.extend!("key", "owner-2", 600);
      await Bun.sleep(200);

      // If the stranger's extend had landed, the key would still be held.
      expect(await driver.exists("key")).toBe(false);
    });

    it("refuses to extend a key nobody holds", async () => {
      expect(await driver.extend!("never-held", "owner-1", 10)).toBe(false);
    });
  });
}

// ── ManagedLock.refresh() ─────────────────────────────────────────────────────

describe("ManagedLock.refresh()", () => {
  let driver: MemoryLockDriver;

  beforeEach(() => {
    driver = new MemoryLockDriver();
  });

  it("extends a held lock", async () => {
    const lock = new ManagedLock("key", 10, driver);
    await lock.acquire();
    expect(await lock.refresh()).toBe(true);
    expect(lock.isAcquired).toBe(true);
  });

  it("accepts a TTL different from the lock's own", async () => {
    const lock = new ManagedLock("key", 0.05, driver);
    await lock.acquire();
    expect(await lock.refresh(10)).toBe(true);
    await Bun.sleep(80);
    expect(await driver.exists("key")).toBe(true);
  });

  it("returns false without touching the driver when never acquired", async () => {
    let calls = 0;
    const spy: LockDriver = {
      ...driver,
      acquire: driver.acquire.bind(driver),
      release: driver.release.bind(driver),
      forceRelease: driver.forceRelease.bind(driver),
      exists: driver.exists.bind(driver),
      extend: async () => {
        calls++;
        return true;
      },
    };

    expect(await new ManagedLock("key", 10, spy).refresh()).toBe(false);
    expect(calls).toBe(0);
  });

  it("stops claiming the lock once it has been lost", async () => {
    // isAcquired lying is the dangerous failure: the caller carries on believing
    // it is exclusive, and only the driver's owner guard stops it doing damage.
    const lock = new ManagedLock("key", 0.02, driver);
    await lock.acquire();
    await Bun.sleep(50);
    await driver.acquire("key", "someone-else", 10);

    expect(await lock.refresh()).toBe(false);
    expect(lock.isAcquired).toBe(false);
    expect(lock.expiresAt).toBeUndefined();
  });

  it("falls back to acquire on a driver with no extend", async () => {
    // A driver written against 1.x satisfies the contract without `extend`, and
    // acquire() is an owner-guarded refresh on every built-in.
    const base = new MemoryLockDriver();
    const legacy: LockDriver = {
      acquire: (key, owner, ttl) => base.acquire(key, owner, ttl),
      release: (key, owner) => base.release(key, owner),
      forceRelease: (key) => base.forceRelease(key),
      exists: (key) => base.exists(key),
    };

    const lock = new ManagedLock("key", 0.05, legacy);
    await lock.acquire();
    expect(await lock.refresh(10)).toBe(true);
    await Bun.sleep(80);
    expect(await base.exists("key")).toBe(true);
  });

  it("reports expiresAt as an estimate that moves with each refresh", async () => {
    const lock = new ManagedLock("key", 10, driver);
    expect(lock.expiresAt).toBeUndefined();

    await lock.acquire();
    const first = lock.expiresAt!.getTime();
    await Bun.sleep(20);
    await lock.refresh();

    expect(lock.expiresAt!.getTime()).toBeGreaterThan(first);
  });

  it("clears expiresAt on release", async () => {
    const lock = new ManagedLock("key", 10, driver);
    await lock.acquire();
    await lock.release();
    expect(lock.expiresAt).toBeUndefined();
  });
});

// ── Auto-refresh in try() / block() ───────────────────────────────────────────

/** Captures every interval the code under test creates. */
function trackIntervals(): {
  restore: () => void;
  live: () => number;
  unreffed: () => number;
} {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const open = new Set<unknown>();
  let unreffed = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.setInterval = ((handler: any, ms?: number, ...rest: any[]) => {
    const timer = realSet(handler, ms, ...rest);
    open.add(timer);
    const realUnref = (timer as { unref?: () => unknown }).unref?.bind(timer);
    (timer as { unref?: () => unknown }).unref = () => {
      unreffed++;
      return realUnref?.();
    };
    return timer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.clearInterval = ((timer: any) => {
    open.delete(timer);
    return realClear(timer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return {
    restore: () => {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    },
    live: () => open.size,
    unreffed: () => unreffed,
  };
}

describe("LockManager — auto-refresh", () => {
  let driver: MemoryLockDriver;
  let manager: LockManager;

  beforeEach(() => {
    driver = new MemoryLockDriver();
    manager = new LockManager(driver);
  });

  it("holds a 1s lock across a 3s job", async () => {
    // Without refreshing this is the bug: the lock lapses at 1s and a second
    // worker walks in while the first is still going.
    let intruder = false;

    await manager.block(
      "report",
      1,
      async () => {
        await Bun.sleep(1_200);
        intruder = await driver.acquire("report", "another-process", 10);
        await Bun.sleep(1_200);
      },
      { refresh: true, refreshEvery: 0.2 },
    );

    expect(intruder).toBe(false);
  }, 10_000);

  it("does not refresh when not asked to", async () => {
    let stolen = false;
    await manager.block("report", 0.3, async () => {
      await Bun.sleep(500);
      stolen = await driver.acquire("report", "another-process", 10);
    });

    expect(stolen).toBe(true);
  });

  it("passes the lock and a signal to the callback", async () => {
    let seen: { lock: ManagedLock | undefined; aborted: boolean } = {
      lock: undefined,
      aborted: true,
    };

    await manager.try("key", 10, async (lock, signal) => {
      seen = { lock, aborted: signal.aborted };
    });

    expect(seen.lock).toBeInstanceOf(ManagedLock);
    expect(seen.aborted).toBe(false);
  });

  it("still accepts a zero-argument callback", async () => {
    // The whole reason the signature could change: every existing call site.
    expect(await manager.try("key", 10, async () => "done")).toBe("done");
  });

  it("aborts the signal and throws LockLostError when the lock is taken", async () => {
    let aborted = false;

    const run = manager.block(
      "key",
      0.2,
      async (_lock, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        // Hand the key to someone else, then keep working. The next beat finds
        // the lock gone.
        await driver.forceRelease("key");
        await driver.acquire("key", "another-process", 30);
        await Bun.sleep(2_000);
        return "should not be returned";
      },
      { refresh: true, refreshEvery: 0.05 },
    );

    await expect(run).rejects.toBeInstanceOf(LockLostError);
    expect(aborted).toBe(true);
  }, 10_000);

  it("names the key in LockLostError", async () => {
    const run = manager.block(
      "invoice:9",
      0.2,
      async () => {
        await driver.forceRelease("invoice:9");
        await driver.acquire("invoice:9", "another-process", 30);
        await Bun.sleep(1_000);
      },
      { refresh: true, refreshEvery: 0.05 },
    );

    await expect(run).rejects.toThrow(/invoice:9/);
  }, 10_000);

  it("clears the refresh timer on success", async () => {
    const timers = trackIntervals();
    try {
      await manager.block("key", 1, async () => Bun.sleep(50), {
        refresh: true,
        refreshEvery: 0.02,
      });
      expect(timers.live()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it("clears the refresh timer when the callback throws", async () => {
    const timers = trackIntervals();
    try {
      const run = manager.block(
        "key",
        1,
        async () => {
          throw new Error("boom");
        },
        { refresh: true, refreshEvery: 0.02 },
      );
      await expect(run).rejects.toThrow("boom");
      expect(timers.live()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it("clears the refresh timer when the lock is lost", async () => {
    const timers = trackIntervals();
    try {
      const run = manager.block(
        "key",
        0.2,
        async () => {
          await driver.forceRelease("key");
          await driver.acquire("key", "another-process", 30);
          await Bun.sleep(1_000);
        },
        { refresh: true, refreshEvery: 0.05 },
      );
      await expect(run).rejects.toBeInstanceOf(LockLostError);
      expect(timers.live()).toBe(0);
    } finally {
      timers.restore();
    }
  }, 10_000);

  it("unrefs the timer so it cannot hold the process open", async () => {
    // An un-unref'd interval in a lock helper is the reason a CLI stops exiting,
    // and nothing about that symptom points back to here.
    const timers = trackIntervals();
    try {
      await manager.block("key", 1, async () => Bun.sleep(30), {
        refresh: true,
        refreshEvery: 0.02,
      });
      expect(timers.unreffed()).toBeGreaterThan(0);
    } finally {
      timers.restore();
    }
  });

  it("stops refreshing once the job is done", async () => {
    let extends_ = 0;
    const counting = new LockManager({
      acquire: (key, owner, ttl) => driver.acquire(key, owner, ttl),
      release: (key, owner) => driver.release(key, owner),
      forceRelease: (key) => driver.forceRelease(key),
      exists: (key) => driver.exists(key),
      extend: (key, owner, ttl) => {
        extends_++;
        return driver.extend(key, owner, ttl);
      },
    });

    await counting.block("key", 1, async () => Bun.sleep(120), {
      refresh: true,
      refreshEvery: 0.03,
    });
    const afterRun = extends_;
    await Bun.sleep(150);

    expect(extends_).toBe(afterRun);
  });

  it("releases the lock after a refreshing run, like any other", async () => {
    await manager.try("key", 1, async () => Bun.sleep(30), {
      refresh: true,
      refreshEvery: 0.02,
    });
    expect(await driver.exists("key")).toBe(false);
  });

  it("still throws LockNotAcquiredError when the key is busy", async () => {
    await driver.acquire("key", "someone", 30);
    const run = manager.try("key", 1, async () => "unreachable", { refresh: true });

    await expect(run).rejects.toBeInstanceOf(LockNotAcquiredError);
  });
});
