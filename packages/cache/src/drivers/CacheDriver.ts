export interface CacheDriver {
  /**
   * Retrieve a cached value. Returns null if the key does not exist
   * or has expired.
   */
  get(key: string): Promise<string | null>;

  /**
   * Store a value. ttl is in seconds; omit for no expiry.
   */
  set(key: string, value: string, ttl?: number): Promise<void>;

  /**
   * Remove a single key.
   */
  forget(key: string): Promise<void>;

  /**
   * Check whether a key exists and has not expired.
   */
  has(key: string): Promise<boolean>;

  /**
   * Remove all keys matching the given prefix.
   * Used by TaggedCache to flush a tag group.
   */
  flush(prefix?: string): Promise<void>;

  /**
   * Add `by` to the number stored at `key` and return the result, as one atomic step.
   *
   * A key that is absent, expired, or does not hold a number counts as 0. `ttl` (seconds) is
   * applied only when the call creates the entry, so a counter keeps the expiry it started with.
   *
   * Optional: a driver without it gets a read-then-write fallback from {@link CacheManager},
   * which is not safe across processes.
   */
  increment?(key: string, by: number, ttl?: number): Promise<number>;

  /**
   * Release any background resources (timers, connections).
   * Called on graceful shutdown by CacheManager.dispose().
   */
  dispose?(): void;
}
