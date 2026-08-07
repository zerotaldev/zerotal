import { currentApp } from "../../application/currentApp.ts";
import { ZerotalError } from "../../errors/index.ts";
import type { LockManager, ManagedLock, BlockOptions } from "../LockManager.ts";
import { LockNotAcquiredError } from "../errors.ts";

/**
 * Resolve the live LockManager from the application container on every call.
 * The container is the single source of truth — the facade caches nothing and
 * holds no module-level state.
 */
function _manager(): LockManager {
  try {
    return currentApp().container.makeSync("lock");
  } catch {
    throw new ZerotalError(
      "[Zerotal Lock] Lock facade unavailable — register LockProvider in your application.",
      "E_LOCK_FACADE_UNAVAILABLE",
      500,
    );
  }
}

/**
 * Static facade over the container-bound {@link LockManager}.
 *
 * Resolves the live `lock` singleton on every call and forwards to the
 * manager, so it exposes the same three usage styles: {@link Lock.try | try}
 * (fail fast), {@link Lock.block | block} (wait for the lock), and
 * {@link Lock.make | make} (a manual {@link ManagedLock} handle). Requires
 * {@link LockProvider} to be registered.
 *
 * @category Acquiring
 *
 * @example
 * ```ts
 * // Fail-fast — throws immediately if the lock is busy
 * await Lock.try('invoice:123', 10, async () => {
 *   await processInvoice(123);
 * });
 *
 * // Blocking — waits up to 30s for the lock
 * await Lock.block('invoice:123', 10, async () => {
 *   await processInvoice(123);
 * }, { timeout: 30 });
 *
 * // Manual handle for complex flows
 * const handle = Lock.make('payment:456', 15);
 * if (await handle.acquire()) {
 *   try {
 *     await capturePayment(456);
 *   } finally {
 *     await handle.release();
 *   }
 * }
 * ```
 */
export class Lock {
  /**
   * Create a named lock handle for manual acquire/release flows.
   * Does NOT acquire the lock — call `.acquire()` or `.block()` explicitly.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Lock time-to-live in seconds.
   * @throws {ZerotalError} (code `E_LOCK_FACADE_UNAVAILABLE`) if {@link LockProvider} is not registered.
   * @category Acquiring
   */
  static make(key: string, ttlSeconds: number): ManagedLock {
    return _manager().lock(key, ttlSeconds);
  }

  /**
   * Acquire the lock exactly once, run `callback`, then release — always,
   * even if `callback` throws.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Lock time-to-live in seconds.
   * @param callback - Critical section to run while the lock is held.
   * @returns The value returned by `callback`.
   * @throws {LockNotAcquiredError} Immediately, if the lock is busy.
   * @category Acquiring
   */
  static async try<T>(key: string, ttlSeconds: number, callback: () => Promise<T> | T): Promise<T> {
    return _manager().try(key, ttlSeconds, callback);
  }

  /**
   * Wait until the lock is free (up to `options.timeout` seconds), run
   * `callback`, then release — always, even if `callback` throws.
   *
   * @param key - Logical lock name.
   * @param ttlSeconds - Lock time-to-live in seconds.
   * @param callback - Critical section to run while the lock is held.
   * @param options - Wait {@link BlockOptions.timeout | timeout} and poll interval.
   * @returns The value returned by `callback`.
   * @throws {LockNotAcquiredError} If the timeout elapses before the lock is acquired.
   * @category Acquiring
   */
  static async block<T>(
    key: string,
    ttlSeconds: number,
    callback: () => Promise<T> | T,
    options?: BlockOptions,
  ): Promise<T> {
    return _manager().block(key, ttlSeconds, callback, options);
  }

  /**
   * The {@link LockNotAcquiredError} class, re-exported for convenience in
   * `catch` blocks (`err instanceof Lock.NotAcquired`).
   *
   * @category Acquiring
   */
  static readonly NotAcquired = LockNotAcquiredError;
}
