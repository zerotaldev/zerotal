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
   * Release any background resources (timers, connections).
   * Called on graceful shutdown by CacheManager.dispose().
   */
  dispose?(): void;
}
