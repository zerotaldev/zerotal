import type { LockDriver } from "./drivers/LockDriver.ts";
import { LockNotAcquiredError } from "./errors.ts";

/**
 * Options controlling how {@link LockManager.block} and {@link Lock.block} wait
 * for a busy lock.
 *
 * @category Acquiring
 */
export interface BlockOptions {
  /**
   * Maximum seconds to wait for the lock before throwing.
   * Defaults to the lock TTL.
   */
  timeout?: number;

  /**
   * Milliseconds between polling attempts while waiting.
   * Default: 100 ms.
   */
  retryDelay?: number;
}

/**
 * A single named lock instance.
 *
 * Each instance holds a unique `owner` token so that release is always
 * owner-guarded — a process that held a lock which expired cannot accidentally
 * release the lock of a new holder that acquired it during the gap.
 *
 * @example
 * ```ts
 * const lock = manager.lock('invoice:123', 10);
 * await lock.acquire();       // try once → returns boolean
 * await lock.block(30);       // wait up to 30s → throws on timeout
 * await lock.release();       // release (no-op if not acquired or expired)
 * await lock.forceRelease();  // unconditionally remove
 * ```
 *
 * @category Acquiring
 */
export class ManagedLock {
  private readonly _owner: string;
  private _acquired = false;

  constructor(
    private readonly _key: string,
    private readonly _ttl: number,
    private readonly _driver: LockDriver,
  ) {
    this._owner = crypto.randomUUID();
  }

  /**
   * Try to acquire exactly once. Returns `true` on success. Re-acquiring while
   * this same instance already holds the key refreshes it (returns `true`).
   *
   * @category Acquiring
   */
  async acquire(): Promise<boolean> {
    this._acquired = await this._driver.acquire(this._key, this._owner, this._ttl);
    return this._acquired;
  }

  /**
   * Block until the lock can be acquired or `timeoutSeconds` elapses, polling
   * every `retryDelayMs`.
   *
   * @param timeoutSeconds - Maximum seconds to wait before giving up.
   * @param retryDelayMs - Milliseconds between acquire attempts (default 100).
   * @throws {LockNotAcquiredError} On timeout.
   * @category Acquiring
   */
  async block(timeoutSeconds: number, retryDelayMs = 100): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (true) {
      if (await this.acquire()) return;
      if (Date.now() >= deadline) break;
      await Bun.sleep(retryDelayMs);
    }

    throw new LockNotAcquiredError(this._key);
  }

  /**
   * Release the lock. Owner-guarded at the driver level, so it only removes the
   * lock if this instance still holds it. No-op when this instance never
   * acquired it or it already expired.
   *
   * @category Releasing
   */
  async release(): Promise<void> {
    if (!this._acquired) return;
    this._acquired = false;
    await this._driver.release(this._key, this._owner);
  }

  /**
   * Unconditionally remove the lock regardless of who holds it. Use with care —
   * it can release a lock owned by another holder.
   *
   * @category Releasing
   */
  async forceRelease(): Promise<void> {
    this._acquired = false;
    await this._driver.forceRelease(this._key);
  }

  /** The logical lock name. */
  get key(): string {
    return this._key;
  }
  /** Whether this instance currently believes it holds the lock. */
  get isAcquired(): boolean {
    return this._acquired;
  }
}

/**
 * High-level entry point for distributed locking, backed by a pluggable
 * {@link LockDriver} (memory, SQLite, or Redis).
 *
 * Offers three usage styles: {@link LockManager.try | try} (fail fast),
 * {@link LockManager.block | block} (wait for the lock), and
 * {@link LockManager.lock | lock} (a manual {@link ManagedLock} handle). Both
 * `try` and `block` always release the lock, even when the callback throws.
 * Normally resolved via the {@link Lock} facade rather than constructed
 * directly.
 *
 * @category Acquiring
 *
 * @example
 * ```ts
 * // Fail fast: throw immediately if the lock is busy.
 * await manager.try("invoice:123", 10, async () => {
 *   await processInvoice(123);
 * });
 *
 * // Blocking: wait up to 30s for the lock to free.
 * await manager.block("invoice:123", 10, async () => {
 *   await processInvoice(123);
 * }, { timeout: 30 });
 *
 * // Manual, for flows that span multiple steps.
 * const lock = manager.lock("invoice:123", 10);
 * if (await lock.acquire()) {
 *   try { await processInvoice(123); } finally { await lock.release(); }
 * }
 * ```
 */
export class LockManager {
  /** @param _driver - Storage backend that performs the atomic acquire/release operations. */
  constructor(private readonly _driver: LockDriver) {}

  /**
   * Build a named {@link ManagedLock} handle for manual acquire/release flows.
   * Does not acquire the lock.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Time-to-live, in seconds, after which the lock auto-expires.
   * @category Acquiring
   */
  lock(key: string, ttlSeconds: number): ManagedLock {
    return new ManagedLock(key, ttlSeconds, this._driver);
  }

  /**
   * Try to acquire the lock exactly once, execute `callback`, then release.
   * The lock is always released — even when `callback` throws.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Lock time-to-live in seconds.
   * @param callback - Critical section to run while the lock is held.
   * @returns The value returned by `callback`.
   * @throws {LockNotAcquiredError} Immediately, if the lock is already held.
   * @category Acquiring
   */
  async try<T>(key: string, ttlSeconds: number, callback: () => Promise<T> | T): Promise<T> {
    const lock = this.lock(key, ttlSeconds);
    const acquired = await lock.acquire();
    if (!acquired) throw new LockNotAcquiredError(key);
    try {
      return await callback();
    } finally {
      await lock.release();
    }
  }

  /**
   * Block until the lock can be acquired (up to `options.timeout` seconds,
   * defaulting to `ttlSeconds`), then execute `callback` and release.
   * The lock is always released — even when `callback` throws.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Lock time-to-live in seconds.
   * @param callback - Critical section to run while the lock is held.
   * @param options - Wait {@link BlockOptions.timeout | timeout} and
   *   {@link BlockOptions.retryDelay | poll interval}.
   * @returns The value returned by `callback`.
   * @throws {LockNotAcquiredError} If the lock cannot be acquired before the timeout elapses.
   * @category Acquiring
   */
  async block<T>(
    key: string,
    ttlSeconds: number,
    callback: () => Promise<T> | T,
    options: BlockOptions = {},
  ): Promise<T> {
    const lock = this.lock(key, ttlSeconds);
    await lock.block(options.timeout ?? ttlSeconds, options.retryDelay);
    try {
      return await callback();
    } finally {
      await lock.release();
    }
  }

  /**
   * Release any background resources held by the underlying driver (timers, DB
   * connections). Called by {@link LockProvider} when the application stops.
   *
   * @category Configuration
   */
  dispose(): void {
    this._driver.dispose?.();
  }
}
