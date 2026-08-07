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

  /** Release background resources (timers, DB connections). */
  dispose?(): void;
}
