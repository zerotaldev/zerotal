/**
 * Distributed mutual-exclusion locks for Zerotal applications.
 *
 * A named lock guarantees that at most one holder runs a critical section at a
 * time — across processes and servers when backed by the Redis or SQLite
 * driver, or in-process with the default memory driver. Every lock carries a
 * TTL so a crashed holder cannot deadlock the key, and release is owner-guarded
 * so a holder whose lock already expired can never release a newer holder's
 * lock. Reach the container-bound manager through the {@link Lock} facade;
 * configure the backend with {@link LockConfig}.
 *
 * @example
 * ```ts
 * import { Lock } from "@zerotal/core/lock";
 *
 * // Fail fast: throw LockNotAcquiredError immediately if the key is busy.
 * await Lock.try("invoice:123", 10, async () => {
 *   await processInvoice(123);
 * });
 *
 * // Blocking: wait up to 30s for the key to free, holding it for 10s (TTL).
 * await Lock.block("invoice:123", 10, async () => {
 *   await processInvoice(123);
 * }, { timeout: 30 });
 *
 * // Manual handle for flows that span multiple steps.
 * const handle = Lock.make("payment:456", 15);
 * if (await handle.acquire()) {
 *   try {
 *     await capturePayment(456);
 *   } finally {
 *     await handle.release();
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

export { LockManager, ManagedLock } from "./LockManager.ts";
export type { BlockOptions, TryOptions, RefreshOptions, LockedCallback } from "./LockManager.ts";

export { Lock } from "./facades/Lock.ts";
export { LockProvider } from "../provider/LockProvider.ts";
export { LockConfig } from "./config.ts";
export type { LockConfigShape } from "./config.ts";
export { LockNotAcquiredError, LockLostError } from "./errors.ts";

// Drivers — exported for custom driver registration and direct instantiation
export type { LockDriver } from "./drivers/LockDriver.ts";
export { MemoryLockDriver } from "./drivers/MemoryLockDriver.ts";
export { SqliteLockDriver } from "./drivers/SqliteLockDriver.ts";
export { RedisLockDriver } from "./drivers/RedisLockDriver.ts";
