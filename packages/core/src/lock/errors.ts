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
