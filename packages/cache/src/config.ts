import { deepMerge } from "@zerotal/core";

export interface CacheConfigShape {
  /** Which cache driver to use. Default: 'sqlite' */
  driver: "sqlite" | "redis" | "memory";
  /**
   * Key prefix prepended to all cache keys. Default: `'zerotal:cache:'`.
   * This MUST stay distinct from the queue driver's `zerotal:jobs:` namespace —
   * a shared `zerotal:` prefix meant `Cache.flush()` (KEYS zerotal:* + DEL) also
   * deleted every pending/failed job on the same Redis DB.
   */
  prefix: string;
  /** Default TTL in seconds. Default: 3600 (1 hour) */
  ttl: number;
  /**
   * Guard `remember()` recomputes with a cross-process lock so only one node runs the
   * factory on a cold key (cache stampede protection). Requires a lock driver to be
   * configured; degrades to in-process coalescing otherwise. Default: `true`.
   */
  stampedeProtection: boolean;
  /** SQLite-specific options */
  sqlite: {
    /** Path to the SQLite file. Use ':memory:' for in-process cache. */
    path: string;
  };
}

const defaults: CacheConfigShape = {
  driver: "sqlite",
  prefix: "zerotal:cache:",
  ttl: 3600,
  stampedeProtection: true,
  sqlite: { path: ":memory:" },
};

/**
 * Create a typed cache configuration object with defaults.
 *
 * @example
 * import { CacheConfig } from '@zerotal/cache';
 * export default CacheConfig({ driver: 'sqlite', ttl: 600 });
 */
export function CacheConfig(options: Partial<CacheConfigShape> = {}): CacheConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    cache: CacheConfigShape;
  }
}
