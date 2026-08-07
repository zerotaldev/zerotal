import { deepMerge } from "../support/deepMerge.ts";

/**
 * Full shape of the `lock` config namespace, as produced by {@link LockConfig}.
 * Selects the storage backend and driver-specific options.
 *
 * @category Configuration
 */
export interface LockConfigShape {
  /** Storage backend. Default: `'memory'` */
  driver: "memory" | "sqlite" | "redis";

  /** Key prefix prepended to every lock key. Default: `'zerotal_lock:'` */
  prefix: string;

  /** SQLite-specific options. */
  sqlite: {
    /** Path to the SQLite file. Use `':memory:'` for in-process storage. */
    path: string;
  };
}

const defaults: LockConfigShape = {
  driver: "memory",
  prefix: "zerotal_lock:",
  sqlite: { path: ":memory:" },
};

/**
 * Create a typed {@link LockConfigShape} with defaults applied (memory driver,
 * `zerotal_lock:` prefix, in-memory SQLite path).
 *
 * @param options - Partial overrides deep-merged over the defaults.
 * @returns The resolved lock config.
 * @category Configuration
 *
 * @example
 * ```ts
 * // config/lock.ts
 * import { LockConfig } from '@zerotal/core/lock';
 * export default LockConfig({ driver: 'redis' });
 * ```
 */
export function LockConfig(options: Partial<LockConfigShape> = {}): LockConfigShape {
  return deepMerge(defaults, options);
}

// The `lock` config namespace is registered directly on core's ConfigRegistry
// (see src/config/registry.ts) since lock ships as part of core.
