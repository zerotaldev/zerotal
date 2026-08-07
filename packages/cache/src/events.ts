/**
 * The cache package's framework events, emitted on core's {@link FrameworkEvents}
 * bus. Observability packages subscribe to them by kind (their class name).
 */

/**
 * Emitted after a cache read, write, delete, flush, or existence check. `op`
 * records which operation ran (a read is either `hit` or `miss`).
 *
 * @category Cache
 */
export class CacheQueried {
  constructor(
    readonly op: "hit" | "miss" | "write" | "forget" | "flush" | "has",
    readonly key: string,
    readonly ttl: number | undefined,
    readonly durationMs: number,
  ) {}
}

/**
 * Emitted when a cache entry is removed by the driver — `reason` distinguishes
 * TTL expiry, capacity eviction, and manual removal.
 *
 * @category Cache
 */
export class CacheEvicted {
  constructor(
    readonly key: string,
    readonly reason: "ttl" | "capacity" | "manual",
  ) {}
}
