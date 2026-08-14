import { redis } from "bun";
import type { LockDriver } from "./LockDriver.ts";

/**
 * The slice of Bun's Redis client this driver uses.
 *
 * Narrow on purpose: it is the seam a test substitutes, and every method on it
 * is one this driver actually calls.
 *
 * @category Configuration
 */
export interface RedisLockClient {
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<boolean>;
  send(command: string, args: string[]): Promise<unknown>;
}

// Lua script: delete the key only if the caller is still the owner.
// Evaluated atomically by Redis — no race between GET and DEL.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

// The same compare-and-set shape as RELEASE_SCRIPT, for the deadline instead of
// the key. It has to be one script for the same reason: between a GET and a
// separate PEXPIRE the lock can lapse and be taken, and the PEXPIRE would then
// extend a lock belonging to someone else. `pexpire` on a missing key returns 0,
// so an expired lock reports failure without a second round trip.
const EXTEND_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * Redis-backed distributed lock driver.
 *
 * Uses `SET key owner NX EX ttl` for atomic acquisition and a Lua script
 * for owner-guarded release. Safe across multiple server instances.
 *
 * Requires Bun's built-in Redis client (available when the REDIS_URL
 * environment variable is set or via the global `redis` export from `bun`).
 *
 * @category Configuration
 */
export class RedisLockDriver implements LockDriver {
  private readonly _redis: RedisLockClient;

  /**
   * @param _prefix - Key namespace.
   * @param client - The Redis client. Defaults to Bun's built-in one; passing a
   *   fake is the only way to test this driver, because `mock.module` cannot
   *   intercept a Bun builtin. The queue's Redis driver learned that the
   *   expensive way — its suite reached a real Redis, found none, and timed out
   *   fifteen times while appearing to be thorough.
   */
  constructor(
    private readonly _prefix: string = "zerotal_lock:",
    client: RedisLockClient = redis,
  ) {
    this._redis = client;
  }

  private _key(key: string): string {
    return this._prefix + key;
  }

  async acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const result = await this._redis.set(this._key(key), owner, "NX", "EX", String(ttlSeconds));
    if (result !== null) return true;

    // Re-entrant: allow the same owner to refresh its own lock
    const current = await this._redis.get(this._key(key));
    if (current === owner) {
      await this._redis.expire(this._key(key), ttlSeconds);
      return true;
    }

    return false;
  }

  async extend(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const extended = await this._redis.send("EVAL", [
      EXTEND_SCRIPT,
      "1",
      this._key(key),
      owner,
      String(Math.max(1, Math.round(ttlSeconds * 1000))),
    ]);
    return extended === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const deleted = await this._redis.send("EVAL", [RELEASE_SCRIPT, "1", this._key(key), owner]);
    return deleted === 1;
  }

  async forceRelease(key: string): Promise<void> {
    await this._redis.del(this._key(key));
  }

  async exists(key: string): Promise<boolean> {
    return this._redis.exists(this._key(key));
  }
}
