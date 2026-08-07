import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "@zerotal/core";
import { LockManager, ManagedLock } from "./LockManager.ts";
import { LockNotAcquiredError } from "./errors.ts";
import { MemoryLockDriver } from "./drivers/MemoryLockDriver.ts";
import { SqliteLockDriver } from "./drivers/SqliteLockDriver.ts";
import { Lock } from "./facades/Lock.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function memoryManager(): LockManager {
  return new LockManager(new MemoryLockDriver());
}

function sqliteManager(): LockManager {
  return new LockManager(new SqliteLockDriver(":memory:"));
}

// ── LockNotAcquiredError ──────────────────────────────────────────────────

describe("LockNotAcquiredError", () => {
  it("is an Error subclass", () => {
    const err = new LockNotAcquiredError("my-key");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LockNotAcquiredError);
  });

  it("carries the lock key", () => {
    const err = new LockNotAcquiredError("invoice:42");
    expect(err.key).toBe("invoice:42");
  });

  it("has a descriptive message", () => {
    const err = new LockNotAcquiredError("payment:7");
    expect(err.message).toContain("payment:7");
  });

  it("has the correct name", () => {
    expect(new LockNotAcquiredError("x").name).toBe("LockNotAcquiredError");
  });
});

// ── MemoryLockDriver ──────────────────────────────────────────────────────────

describe("MemoryLockDriver", () => {
  let driver: MemoryLockDriver;

  beforeEach(() => {
    driver = new MemoryLockDriver();
  });

  it("acquire returns true when lock is free", async () => {
    expect(await driver.acquire("key", "owner-1", 10)).toBe(true);
  });

  it("acquire returns false when lock is held by another owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.acquire("key", "owner-2", 10)).toBe(false);
  });

  it("acquire is re-entrant for the same owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.acquire("key", "owner-1", 10)).toBe(true);
  });

  it("expired locks can be re-acquired by a new owner", async () => {
    await driver.acquire("key", "owner-1", 0.001); // 1ms TTL
    await Bun.sleep(5);
    expect(await driver.acquire("key", "owner-2", 10)).toBe(true);
  });

  it("release returns true and removes the lock for the correct owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.release("key", "owner-1")).toBe(true);
    expect(await driver.exists("key")).toBe(false);
  });

  it("release returns false for a non-owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.release("key", "owner-2")).toBe(false);
    expect(await driver.exists("key")).toBe(true);
  });

  it("forceRelease removes the lock regardless of owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    await driver.forceRelease("key");
    expect(await driver.exists("key")).toBe(false);
  });

  it("exists returns false for non-existent key", async () => {
    expect(await driver.exists("missing")).toBe(false);
  });

  it("exists returns false for an expired key", async () => {
    await driver.acquire("key", "owner-1", 0.001); // 1ms
    await Bun.sleep(5);
    expect(await driver.exists("key")).toBe(false);
  });

  it("different keys do not interfere", async () => {
    await driver.acquire("key-a", "owner-1", 10);
    expect(await driver.acquire("key-b", "owner-2", 10)).toBe(true);
  });

  it("flush() clears all locks", async () => {
    await driver.acquire("a", "owner", 10);
    await driver.acquire("b", "owner", 10);
    driver.flush();
    expect(await driver.exists("a")).toBe(false);
    expect(await driver.exists("b")).toBe(false);
  });
});

// ── SqliteLockDriver ──────────────────────────────────────────────────────────

describe("SqliteLockDriver", () => {
  let driver: SqliteLockDriver;

  beforeEach(() => {
    driver = new SqliteLockDriver(":memory:");
  });
  afterEach(() => {
    driver.dispose();
  });

  it("acquire returns true when lock is free", async () => {
    expect(await driver.acquire("key", "owner-1", 10)).toBe(true);
  });

  it("acquire returns false when lock is held by another owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.acquire("key", "owner-2", 10)).toBe(false);
  });

  it("acquire is re-entrant for the same owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.acquire("key", "owner-1", 10)).toBe(true);
  });

  it("expired locks can be re-acquired", async () => {
    await driver.acquire("key", "owner-1", 0.001); // 1ms
    await Bun.sleep(5);
    expect(await driver.acquire("key", "owner-2", 10)).toBe(true);
  });

  it("release returns true for the owning caller", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.release("key", "owner-1")).toBe(true);
    expect(await driver.exists("key")).toBe(false);
  });

  it("release returns false for a non-owner", async () => {
    await driver.acquire("key", "owner-1", 10);
    expect(await driver.release("key", "owner-2")).toBe(false);
    expect(await driver.exists("key")).toBe(true);
  });

  it("forceRelease removes any lock", async () => {
    await driver.acquire("key", "owner-1", 10);
    await driver.forceRelease("key");
    expect(await driver.exists("key")).toBe(false);
  });

  it("different keys are independent", async () => {
    await driver.acquire("a", "owner-1", 10);
    expect(await driver.acquire("b", "owner-2", 10)).toBe(true);
  });
});

// ── ManagedLock ───────────────────────────────────────────────────────────────

describe("ManagedLock", () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = memoryManager();
  });

  it("acquire() returns true when lock is free", async () => {
    const lock = manager.lock("key", 10);
    expect(await lock.acquire()).toBe(true);
    expect(lock.isAcquired).toBe(true);
  });

  it("acquire() returns false when lock is held", async () => {
    const lock1 = manager.lock("key", 10);
    const lock2 = manager.lock("key", 10);
    await lock1.acquire();
    expect(await lock2.acquire()).toBe(false);
    expect(lock2.isAcquired).toBe(false);
  });

  it("release() frees the lock", async () => {
    const lock = manager.lock("key", 10);
    await lock.acquire();
    await lock.release();
    expect(lock.isAcquired).toBe(false);

    const other = manager.lock("key", 10);
    expect(await other.acquire()).toBe(true);
  });

  it("release() is a no-op when not acquired", async () => {
    const lock = manager.lock("key", 10);
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("release() does not release a lock held by a different ManagedLock", async () => {
    const lock1 = manager.lock("key", 10);
    const lock2 = manager.lock("key", 10);
    await lock1.acquire();
    await lock2.release(); // lock2 never acquired, should be no-op
    expect(await lock1.isAcquired).toBe(true);
  });

  it("forceRelease() removes any lock for the key", async () => {
    const lock1 = manager.lock("key", 10);
    const lock2 = manager.lock("key", 10);
    await lock1.acquire();
    await lock2.forceRelease();
    const lock3 = manager.lock("key", 10);
    expect(await lock3.acquire()).toBe(true);
  });

  it("block() acquires immediately when lock is free", async () => {
    const lock = manager.lock("key", 10);
    await lock.block(5);
    expect(lock.isAcquired).toBe(true);
  });

  it("block() throws LockNotAcquiredError when timeout elapses", async () => {
    const lock1 = manager.lock("key", 10);
    await lock1.acquire();

    const lock2 = manager.lock("key", 10);
    await expect(lock2.block(0.05, 20)).rejects.toBeInstanceOf(LockNotAcquiredError);
  });

  it("block() waits and succeeds when lock is released in time", async () => {
    const lock1 = manager.lock("key", 10);
    await lock1.acquire();

    const lock2 = manager.lock("key", 10);
    let resolved = false;

    const blockPromise = (async () => {
      await lock2.block(2, 30);
      resolved = true;
    })();

    await Bun.sleep(80);
    await lock1.release();
    await blockPromise;
    expect(resolved).toBe(true);
  });

  it("key getter returns the lock key", () => {
    expect(manager.lock("my-key", 10).key).toBe("my-key");
  });
});

// ── LockManager.try() ─────────────────────────────────────────────────────────

describe("LockManager.try()", () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = memoryManager();
  });

  it("executes callback and returns its value", async () => {
    const result = await manager.try("key", 10, () => 42);
    expect(result).toBe(42);
  });

  it("releases the lock after callback completes", async () => {
    await manager.try("key", 10, async () => {});
    const lock = manager.lock("key", 10);
    expect(await lock.acquire()).toBe(true);
  });

  it("releases the lock even when callback throws", async () => {
    await expect(
      manager.try("key", 10, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const lock = manager.lock("key", 10);
    expect(await lock.acquire()).toBe(true);
  });

  it("throws LockNotAcquiredError when lock is already held", async () => {
    const existing = manager.lock("key", 10);
    await existing.acquire();

    await expect(manager.try("key", 10, () => {})).rejects.toBeInstanceOf(LockNotAcquiredError);
  });

  it("LockNotAcquiredError contains the key", async () => {
    const existing = manager.lock("invoice:99", 10);
    await existing.acquire();

    try {
      await manager.try("invoice:99", 10, () => {});
    } catch (err) {
      expect(err).toBeInstanceOf(LockNotAcquiredError);
      expect((err as LockNotAcquiredError).key).toBe("invoice:99");
    }
  });

  it("different keys do not block each other", async () => {
    const lock = manager.lock("key-a", 10);
    await lock.acquire();
    const result = await manager.try("key-b", 10, () => "ok");
    expect(result).toBe("ok");
  });
});

// ── LockManager.block() ───────────────────────────────────────────────────────

describe("LockManager.block()", () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = memoryManager();
  });

  it("executes callback and returns its value", async () => {
    const result = await manager.block("key", 10, () => "done");
    expect(result).toBe("done");
  });

  it("releases the lock after the callback completes", async () => {
    await manager.block("key", 10, async () => {});
    expect(await manager.lock("key", 10).acquire()).toBe(true);
  });

  it("releases the lock even when callback throws", async () => {
    await expect(
      manager.block("key", 10, () => {
        throw new Error("cb-error");
      }),
    ).rejects.toThrow("cb-error");
    expect(await manager.lock("key", 10).acquire()).toBe(true);
  });

  it("throws LockNotAcquiredError when timeout elapses", async () => {
    const existing = manager.lock("key", 10);
    await existing.acquire();

    await expect(
      manager.block("key", 10, () => {}, { timeout: 0.05, retryDelay: 20 }),
    ).rejects.toBeInstanceOf(LockNotAcquiredError);
  });

  it("succeeds when the lock is released within the timeout", async () => {
    const existing = manager.lock("key", 10);
    await existing.acquire();

    let ran = false;
    const blockPromise = manager.block(
      "key",
      10,
      async () => {
        ran = true;
      },
      {
        timeout: 2,
        retryDelay: 30,
      },
    );

    await Bun.sleep(80);
    await existing.release();
    await blockPromise;
    expect(ran).toBe(true);
  });
});

// ── LockManager + SqliteLockDriver ───────────────────────────────────────────

describe("LockManager with SqliteLockDriver", () => {
  let manager: LockManager;
  let driver: SqliteLockDriver;

  beforeEach(() => {
    driver = new SqliteLockDriver(":memory:");
    manager = new LockManager(driver);
  });
  afterEach(() => driver.dispose());

  it("try() works with SQLite driver", async () => {
    const result = await manager.try("sqlite-key", 10, () => "ok");
    expect(result).toBe("ok");
  });

  it("try() throws when lock is held (SQLite)", async () => {
    const lock = manager.lock("sqlite-key", 10);
    await lock.acquire();
    await expect(manager.try("sqlite-key", 10, () => {})).rejects.toBeInstanceOf(
      LockNotAcquiredError,
    );
  });

  it("releases lock after try() (SQLite)", async () => {
    await manager.try("sqlite-key", 10, async () => {});
    expect(await manager.lock("sqlite-key", 10).acquire()).toBe(true);
  });
});

// ── Lock facade ───────────────────────────────────────────────────────────────

describe("Lock facade", () => {
  beforeEach(() => {
    Application._resetInstance();
    Application.create().container.value("lock", memoryManager());
  });
  afterEach(() => Application._resetInstance());

  it("Lock.try() runs the callback and returns its value", async () => {
    expect(await Lock.try("key", 10, () => "facade-result")).toBe("facade-result");
  });

  it("Lock.try() throws LockNotAcquiredError when busy", async () => {
    const handle = Lock.make("key", 10);
    await handle.acquire();
    await expect(Lock.try("key", 10, () => {})).rejects.toBeInstanceOf(LockNotAcquiredError);
  });

  it("Lock.block() runs the callback", async () => {
    let ran = false;
    await Lock.block("key", 10, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("Lock.block() throws when timeout elapses", async () => {
    const handle = Lock.make("key", 10);
    await handle.acquire();
    await expect(
      Lock.block("key", 10, () => {}, { timeout: 0.05, retryDelay: 20 }),
    ).rejects.toBeInstanceOf(LockNotAcquiredError);
  });

  it("Lock.make() returns a ManagedLock", () => {
    expect(Lock.make("key", 10)).toBeInstanceOf(ManagedLock);
  });

  it("Lock.NotAcquired is LockNotAcquiredError", () => {
    expect(Lock.NotAcquired).toBe(LockNotAcquiredError);
  });

  it("throws when facade is not initialised", async () => {
    Application._resetInstance();
    await expect(Lock.try("key", 10, () => {})).rejects.toThrow("LockProvider");
  });
});
