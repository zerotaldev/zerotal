import type { CacheDriver } from "./drivers/CacheDriver.ts";
import { CacheSerializationError, CacheDeserializationError } from "./errors.ts";
import { FrameworkEvents, sha256Hex } from "@zerotal/core";
import { CacheQueried } from "./events.ts";
import type { LockManager } from "@zerotal/core/lock";
import { LockNotAcquiredError } from "@zerotal/core/lock";

// Cross-process recompute lock for remember(): how long the lock is held while the
// factory runs, and how long a waiter blocks for the holder before recomputing anyway.
const STAMPEDE_LOCK_TTL = 30; // seconds
const STAMPEDE_LOCK_WAIT = 30; // seconds

// ── CacheManager ──────────────────────────────────────────────────────────────

export class CacheManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _inFlight = new Map<string, Promise<any>>();

  constructor(
    private _driver: CacheDriver,
    private _prefix: string = "",
    private _defaultTtl?: number,
    private _lock: LockManager | null = null,
    private _stampedeProtection: boolean = true,
  ) {}

  private _key(key: string): string {
    return this._prefix + key;
  }

  /** JSON-encode a value for storage, surfacing a typed CacheSerializationError. */
  private _encode(key: string, value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch (err) {
      throw new CacheSerializationError(key, err);
    }
  }

  /** JSON-decode a cached value, surfacing a typed CacheDeserializationError. */
  private _decode<T>(key: string, raw: string): T {
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new CacheDeserializationError(key, err);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const t0 = Date.now();
    const raw = await this._driver.get(this._key(key));
    FrameworkEvents.emit(
      new CacheQueried(raw === null ? "miss" : "hit", key, undefined, Date.now() - t0),
    );
    if (raw === null) return null;
    return this._decode<T>(key, raw);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const t0 = Date.now();
    const effectiveTtl = ttl ?? this._defaultTtl;
    await this._driver.set(this._key(key), this._encode(key, value), effectiveTtl);
    FrameworkEvents.emit(new CacheQueried("write", key, effectiveTtl, Date.now() - t0));
  }

  async forget(key: string): Promise<void> {
    const t0 = Date.now();
    await this._driver.forget(this._key(key));
    FrameworkEvents.emit(new CacheQueried("forget", key, undefined, Date.now() - t0));
  }

  async has(key: string): Promise<boolean> {
    const t0 = Date.now();
    const result = await this._driver.has(this._key(key));
    FrameworkEvents.emit(new CacheQueried("has", key, undefined, Date.now() - t0));
    return result;
  }

  async flush(): Promise<void> {
    const t0 = Date.now();
    await this._driver.flush(this._prefix);
    FrameworkEvents.emit(new CacheQueried("flush", "*", undefined, Date.now() - t0));
  }

  async remember<T>(key: string, ttl: number, fn: () => Promise<T> | T): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const prefixedKey = this._key(key);

    // Coalesce concurrent misses: await existing in-flight factory
    const existing = this._inFlight.get(prefixedKey);
    if (existing !== undefined) return existing as Promise<T>;

    const promise = (async () => {
      try {
        return await this._computeAndStore(key, prefixedKey, ttl, fn);
      } finally {
        this._inFlight.delete(prefixedKey);
      }
    })();

    this._inFlight.set(prefixedKey, promise);
    return promise;
  }

  /**
   * Run the factory and store its value. When stampede protection is on and a lock
   * driver is configured, a cross-process lock ensures only one node recomputes a
   * cold key; waiters re-check the cache after the holder finishes. A waiter that
   * can't get the lock in time recomputes rather than failing — caching stays
   * best-effort. Without a lock driver, only the in-process coalescing above applies.
   */
  private async _computeAndStore<T>(
    key: string,
    prefixedKey: string,
    ttl: number,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const compute = async (): Promise<T> => {
      const value = await fn();
      await this.set(key, value, ttl);
      return value;
    };

    if (!this._stampedeProtection || !this._lock) return compute();

    const lockKey = `cache:stampede:${prefixedKey}`;
    const recheckThenCompute = async (): Promise<T> => {
      // Another holder may have populated the key while we waited for the lock.
      const fresh = await this.get<T>(key);
      if (fresh !== null) return fresh;
      return compute();
    };

    try {
      return await this._lock.block(lockKey, STAMPEDE_LOCK_TTL, recheckThenCompute, {
        timeout: STAMPEDE_LOCK_WAIT,
        retryDelay: 50,
      });
    } catch (err) {
      if (err instanceof LockNotAcquiredError) return recheckThenCompute();
      throw err;
    }
  }

  async forever(key: string, value: unknown): Promise<void> {
    const t0 = Date.now();
    await this._driver.set(this._key(key), this._encode(key, value), undefined);
    FrameworkEvents.emit(new CacheQueried("write", key, undefined, Date.now() - t0));
  }

  /**
   * Scope reads/writes to a **tag namespace**. Tags are a deterministic, ordered
   * namespace: `tags([...])` sorts and joins the names into a key prefix, so
   * `tags(['a','b'])` and `tags(['b','a'])` address the same entries (the order
   * no longer matters), and `tags([...]).flush()` clears exactly that namespace.
   *
   * Note: this is namespacing, not a per-tag index — flushing `tags(['b'])` does
   * NOT invalidate entries written under `tags(['a','b'])`. Flush with the same
   * tag set you wrote with. (A true multi-tag index — where any one tag can
   * invalidate every entry carrying it — is intentionally out of scope for v1.)
   *
   * The namespace is a fixed-length digest of the sorted tag list rather than the names
   * joined together, because `flush()` is a prefix delete and a joined prefix contains its
   * own sub-namespaces: `tags(['a'])` produced `a:`, which matches `a:b:key`, so flushing
   * `['a']` wiped the `['a','b']` namespace this docblock promises it will not. A digest
   * also stops a tag that happens to contain the separator from colliding —
   * `tags(['a:b'])` and `tags(['a','b'])` are different namespaces.
   */
  tags(tagNames: string[]): TaggedCache {
    // Sorted so the namespace is order-independent: tags(['b','a']) === tags(['a','b']).
    // NUL-joined so the digest input is unambiguous for any tag content.
    const canonical = [...tagNames].sort().join(String.fromCharCode(0));
    const tagPrefix = `t${sha256Hex(canonical).slice(0, 16)}:`;
    return new TaggedCache(
      this._driver,
      this._prefix + tagPrefix,
      undefined,
      this._lock,
      this._stampedeProtection,
    );
  }

  dispose(): void {
    this._driver.dispose?.();
  }
}

export class TaggedCache extends CacheManager {}
