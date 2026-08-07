import { redis } from "bun";
import type { LockDriver } from "./LockDriver.ts";

// Lua script: delete the key only if the caller is still the owner.
// Evaluated atomically by Redis — no race between GET and DEL.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
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
  constructor(private readonly _prefix: string = "zerotal_lock:") {}

  private _key(key: string): string {
    return this._prefix + key;
  }

  async acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const result = await redis.set(this._key(key), owner, "NX", "EX", String(ttlSeconds));
    if (result !== null) return true;

    // Re-entrant: allow the same owner to refresh its own lock
    const current = await redis.get(this._key(key));
    if (current === owner) {
      await redis.expire(this._key(key), ttlSeconds);
      return true;
    }

    return false;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const deleted = await redis.send("EVAL", [RELEASE_SCRIPT, "1", this._key(key), owner]);
    return deleted === 1;
  }

  async forceRelease(key: string): Promise<void> {
    await redis.del(this._key(key));
  }

  async exists(key: string): Promise<boolean> {
    return redis.exists(this._key(key));
  }
}
