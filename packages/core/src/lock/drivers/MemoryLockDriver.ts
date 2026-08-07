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
      return existing.owner === owner; // re-entrant for same owner
    }

    this._store.set(key, { owner, expiresAt: now + ttlSeconds * 1000 });
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
