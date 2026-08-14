import type { LockDriver } from "./LockDriver.ts";

interface LockRecord {
  owner: string;
  expiresAt: number; // Date.now() ms
}

/**
 * In-process lock driver backed by a plain Map.
 *
 * Suitable for single-instance servers and tests. Not safe across
 * processes or server restarts — use the Redis or SQLite driver for
 * distributed / persistent locks.
 *
 * @category Configuration
 */
export class MemoryLockDriver implements LockDriver {
  private readonly _store = new Map<string, LockRecord>();

  async acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const existing = this._store.get(key);

    if (existing && now < existing.expiresAt) {
      if (existing.owner !== owner) return false;
      // Re-acquiring by the same owner pushes the deadline out. This used to
      // return `true` without touching `expiresAt`, so the default driver — the
      // one every app gets until it configures another — was the only one of the
      // three that did not honour what `ManagedLock.acquire()` documents. Redis
      // re-`expire`s and SQLite `UPDATE`s; a caller re-acquiring to stay alive
      // was silently refused an extension here, and found out when the lock
      // expired underneath them.
      existing.expiresAt = now + ttlSeconds * 1000;
      return true;
    }

    this._store.set(key, { owner, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  async extend(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const existing = this._store.get(key);
    // An expired record is not extendable even by its own owner: the lock is
    // free, and anyone may have taken it in between. Re-acquiring is the honest
    // way back, and it is what the caller does when this returns false.
    if (!existing || existing.owner !== owner || now >= existing.expiresAt) return false;
    existing.expiresAt = now + ttlSeconds * 1000;
    return true;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const existing = this._store.get(key);
    if (!existing || existing.owner !== owner) return false;
    this._store.delete(key);
    return true;
  }

  async forceRelease(key: string): Promise<void> {
    this._store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const existing = this._store.get(key);
    return !!existing && Date.now() < existing.expiresAt;
  }

  /** Flush all locks — useful in tests. */
  flush(): void {
    this._store.clear();
  }
}
