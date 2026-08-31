import type { LockDriver } from "./drivers/LockDriver.ts";
import { LockNotAcquiredError, LockLostError } from "./errors.ts";

/**
 * Keeping a lock alive across work that outlives its TTL.
 *
 * Shared by {@link TryOptions} and {@link BlockOptions} because the choice is
 * about the critical section, not about how you got into it.
 *
 * @category Acquiring
 */
export interface RefreshOptions {
  /**
   * Extend the lock in the background for as long as the callback runs.
   *
   * With this on, the TTL stops being "how long the job might take" — a
   * question nobody can answer — and becomes "how long after a crash before
   * someone else may take over", which is a decision rather than a guess.
   */
  refresh?: boolean | undefined;

  /**
   * Seconds between refreshes. Defaults to a third of the TTL, so two
   * consecutive failures still leave a full attempt before the lock lapses.
   */
  refreshEvery?: number | undefined;
}

/**
 * Options for {@link LockManager.try | try}.
 *
 * @category Acquiring
 */
export type TryOptions = RefreshOptions;

/**
 * Options controlling how {@link LockManager.block} and {@link Lock.block} wait
 * for a busy lock.
 *
 * @category Acquiring
 */
export interface BlockOptions extends RefreshOptions {
  /**
   * Maximum seconds to wait for the lock before throwing.
   * Defaults to the lock TTL.
   */
  timeout?: number | undefined;

  /**
   * Milliseconds between polling attempts while waiting.
   * Default: 100 ms.
   */
  retryDelay?: number | undefined;
}

/**
 * The critical section run by {@link LockManager.try} and
 * {@link LockManager.block}.
 *
 * Both arguments are additive — an existing zero-argument callback is still a
 * valid one, and every call site written before refreshing existed keeps
 * working untouched.
 *
 * @param lock - The held lock, for a manual {@link ManagedLock.refresh}.
 * @param signal - Aborted if the lock is lost mid-run. Long work should watch it.
 * @category Acquiring
 */
export type LockedCallback<T> = (lock: ManagedLock, signal: AbortSignal) => Promise<T> | T;

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
  private _expiresAt: number | undefined = undefined;

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
    if (this._acquired) this._expiresAt = Date.now() + this._ttl * 1000;
    return this._acquired;
  }

  /**
   * Push this lock's deadline out, so work that outlives its TTL can keep it.
   *
   * Without this a TTL has to be sized for the worst case: too short and the
   * lock evaporates mid-job, too long and a crashed holder blocks the key for
   * however long you guessed. Refreshing lets the TTL describe *how quickly a
   * crash is noticed* instead, which is a much easier number to pick.
   *
   * Returns `false` when the lock is gone — expired, or now held by someone
   * else — and clears {@link isAcquired} so it stops claiming otherwise. A
   * caller that ignores the return value at least will not go on to release
   * another holder's lock, because release is owner-guarded too.
   *
   * @param ttlSeconds - Seconds from now. Defaults to the lock's own TTL.
   * @category Acquiring
   *
   * @example
   * ```ts
   * if (!(await lock.refresh())) throw new LockLostError(lock.key);
   * ```
   */
  async refresh(ttlSeconds?: number): Promise<boolean> {
    if (!this._acquired) return false;
    const ttl = ttlSeconds ?? this._ttl;

    // `extend` is required on the contract since 1.13.0, so there is no fallback
    // here any more. The one it replaced — `acquire(key, owner, ttl)` — worked only
    // because every built-in driver happens to make `acquire` an owner-guarded
    // refresh, which the interface never required and a third-party driver had no
    // reason to know.
    const extended = await this._driver.extend(this._key, this._owner, ttl);

    if (!extended) {
      this._acquired = false;
      this._expiresAt = undefined;
      return false;
    }

    this._expiresAt = Date.now() + ttl * 1000;
    return true;
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
    this._expiresAt = undefined;
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
    this._expiresAt = undefined;
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
  /** The lock's TTL in seconds, as configured. */
  get ttl(): number {
    return this._ttl;
  }
  /**
   * When this lock is expected to expire, or `undefined` when not held.
   *
   * A **client-side estimate**, computed from the last successful acquire or
   * refresh — not read back from the driver. It is for deciding when to refresh
   * next, not for deciding whether you still hold the lock; clock skew between
   * this process and the lock store makes it approximate, and only the driver
   * knows the truth. Ask {@link refresh} if you need an answer you can act on.
   */
  get expiresAt(): Date | undefined {
    return this._expiresAt === undefined ? undefined : new Date(this._expiresAt);
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
  async try<T>(
    key: string,
    ttlSeconds: number,
    callback: LockedCallback<T>,
    options: TryOptions = {},
  ): Promise<T> {
    const lock = this.lock(key, ttlSeconds);
    const acquired = await lock.acquire();
    if (!acquired) throw new LockNotAcquiredError(key);
    return _runHeld(lock, callback, options);
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
    callback: LockedCallback<T>,
    options: BlockOptions = {},
  ): Promise<T> {
    const lock = this.lock(key, ttlSeconds);
    await lock.block(options.timeout ?? ttlSeconds, options.retryDelay);
    return _runHeld(lock, callback, options);
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

/**
 * Run the critical section with the lock held, optionally heartbeating it, and
 * release on the way out whatever happened.
 *
 * Shared by `try` and `block`, which differ only in how they got the lock.
 */
async function _runHeld<T>(
  lock: ManagedLock,
  callback: LockedCallback<T>,
  options: RefreshOptions,
): Promise<T> {
  const controller = new AbortController();

  if (!options.refresh) {
    try {
      return await callback(lock, controller.signal);
    } finally {
      await lock.release();
    }
  }

  const everySeconds = options.refreshEvery ?? lock.ttl / 3;
  const everyMs = Math.max(1, Math.round(everySeconds * 1000));

  // Assigned once, further down, but read by the `beat()` and `stop()` closures
  // declared above that assignment — so it cannot be a `const` initialiser.
  // eslint-disable-next-line prefer-const -- see above
  let timer: ReturnType<typeof setInterval> | undefined;
  let rejectLost: ((error: Error) => void) | undefined;
  // Never resolves — it exists only to lose the race below, and only when the
  // lock is gone. Its rejection is always handled, by that race.
  const lost = new Promise<never>((_, reject) => {
    rejectLost = reject;
  });

  const beat = async (): Promise<void> => {
    if (await lock.refresh().catch(() => false)) return;

    // Stop beating first: a lost lock stays lost, and retrying would only add
    // driver round trips to a job that now has to stop.
    if (timer) clearInterval(timer);
    const error = new LockLostError(lock.key);
    // The signal comes first so cooperative work sees the abort before the
    // caller sees the throw — the callback may still be mid-await, and telling
    // it to stop is the only leverage we have. It cannot be forced: work that
    // ignores its signal runs on, outside the lock it believes it holds.
    controller.abort(error);
    rejectLost?.(error);
  };

  timer = setInterval(() => void beat(), everyMs);
  // Without this the interval alone keeps the event loop alive, and a CLI or a
  // dev-mode process quietly refuses to exit — a symptom with nothing pointing
  // back to a lock helper.
  timer.unref?.();

  try {
    const work = Promise.resolve().then(() => callback(lock, controller.signal));
    // Losing the race leaves `work` rejecting with nobody listening; this marks
    // it handled so a lost lock cannot also produce an unhandled rejection.
    work.catch(() => {});
    return await Promise.race([work, lost]);
  } finally {
    // Both exits, always: the success path, the throw path, and the lost-lock
    // path that is a throw arriving from somewhere other than the callback.
    clearInterval(timer);
    await lock.release();
  }
}
