import { redis } from "bun";
import type { CacheDriver } from "./CacheDriver.ts";

export class RedisDriver implements CacheDriver {
  private _prefix: string;

  constructor(prefix = "") {
    this._prefix = prefix;
  }

  private _key(key: string): string {
    return this._prefix + key;
  }

  async get(key: string): Promise<string | null> {
    return redis.get(this._key(key));
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const namespaced = this._key(key);
    if (ttl === undefined) {
      await redis.set(namespaced, value);
      return;
    }
    await redis.set(namespaced, value, "EX", ttl);
  }

  async forget(key: string): Promise<void> {
    await redis.del(this._key(key));
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async flush(prefix?: string): Promise<void> {
    const pattern = this._key(prefix ?? "") + "*";
    // Iterate with SCAN rather than the blocking KEYS: KEYS walks the whole
    // keyspace in one shot and stalls the server on large DBs. SCAN is cursored
    // and non-blocking. The cache prefix (`zerotal:cache:`) is disjoint from the
    // queue's `zerotal:jobs:`, so this never touches queued jobs.
    let cursor = "0";
    do {
      const reply = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "100"])) as
        [string, string[]] | null;
      if (!reply) break;
      cursor = reply[0];
      const batch = reply[1] ?? [];
      for (let i = 0; i < batch.length; i += 100) {
        const slice = batch.slice(i, i + 100);
        if (slice.length > 0) await redis.del(...slice);
      }
    } while (cursor !== "0");
  }
}
