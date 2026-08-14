/**
 * Contract for lock storage backends.
 *
 * Every method must be atomic at the driver level. The `owner` parameter
 * prevents a process from releasing a lock it no longer holds (e.g. if the
 * TTL expired and another process re-acquired).
 *
 * @category Configuration
 */
export interface LockDriver {
  /**
   * Try to acquire the lock. Returns `true` when acquired, `false` if already
   * held by another owner and not yet expired.
   */
  acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Release the lock only if the caller is still the owner.
   * Returns `true` when released, `false` if the lock was held by someone else
   * (e.g. TTL expired and another process re-acquired).
   */
  release(key: string, owner: string): Promise<boolean>;

  /** Unconditionally delete the lock regardless of owner. */
  forceRelease(key: string): Promise<void>;

  /** Returns `true` if the lock is currently held (not expired). */
  exists(key: string): Promise<boolean>;

  /**
   * Push a held lock's deadline out to `ttlSeconds` from now. Owner-guarded:
   * returns `false` when the key is free or held by someone else, so a holder
   * that lost the lock learns about it rather than extending a stranger's.
   *
   * **Optional** so a driver written against 1.x still satisfies this interface.
   * {@link ManagedLock.refresh} falls back to `acquire(key, owner, ttl)`, which
   * is an owner-guarded refresh on all three built-in drivers.
   */
  extend?(key: string, owner: string, ttlSeconds: number): Promise<boolean>;

  /** Release background resources (timers, DB connections). */
  dispose?(): void;
}
