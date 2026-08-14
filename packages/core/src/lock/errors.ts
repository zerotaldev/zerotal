import { ZerotalError } from "../errors/index.ts";

/**
 * Thrown when a lock cannot be acquired: immediately by
 * {@link LockManager.try | try}/{@link Lock.try | Lock.try} when the key is
 * busy, or by {@link LockManager.block | block}/{@link Lock.block | Lock.block}
 * when the wait timeout elapses. Carries the contended {@link key} and maps to
 * HTTP 409 (code `E_LOCK_NOT_ACQUIRED`).
 *
 * @category Acquiring
 */
export class LockNotAcquiredError extends ZerotalError {
  /** The lock key that could not be acquired. */
  readonly key: string;

  constructor(key: string) {
    super(`[Zerotal Lock] Could not acquire lock for key: "${key}"`, "E_LOCK_NOT_ACQUIRED", 409);
    this.key = key;
  }
}

/**
 * Thrown when a lock that was being auto-refreshed could not be extended —
 * the TTL lapsed and another holder took the key.
 *
 * Distinct from {@link LockNotAcquiredError} on purpose: that one means "you
 * never got in", this one means "you were in and you are not any more", and the
 * work in flight has to be treated as no longer exclusive. The callback's
 * `AbortSignal` is aborted before this is thrown, so cooperative work stops
 * rather than running on outside the lock it thinks it holds.
 *
 * @category Acquiring
 */
export class LockLostError extends ZerotalError {
  /** The lock key that was lost. */
  readonly key: string;

  constructor(key: string) {
    super(
      `[Zerotal Lock] Lost the lock for key: "${key}" — it expired and was taken by another holder.`,
      "E_LOCK_LOST",
      409,
    );
    this.key = key;
  }
}
