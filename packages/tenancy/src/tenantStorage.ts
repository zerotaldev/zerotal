/**
 * Tenant-scoped storage and cache helpers.
 *
 * These thin wrappers prefix all keys and paths with the active tenant's
 * slug so files and cache entries are automatically isolated per tenant.
 *
 * @example
 * // Storage — saves to /storage/tenants/acme/logo.png on the local disk:
 * import { tenantDisk } from '@zerotal/tenancy';
 * await tenantDisk().put('logo.png', buffer);
 * const url = await tenantDisk().url('logo.png');
 *
 * // Cache — key becomes 'tenant:acme:stats':
 * import { tenantCache } from '@zerotal/tenancy';
 * await tenantCache().set('stats', data, 300);
 * const hit = await tenantCache().get<Stats>('stats');
 */

import { TenantContext } from "./TenantContext.ts";
import { TenancyConfigError, TenantStoragePathError } from "./errors.ts";

// ── Storage ───────────────────────────────────────────────────────────────────

type StorageDriver = {
  put(path: string, data: unknown): Promise<void>;
  get(path: string): Promise<unknown>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  url(path: string): Promise<string> | string;
  [key: string]: unknown;
};

type StorageManagerLike = {
  disk(name?: string): StorageDriver;
};

/**
 * Return a proxy over the named storage disk that prefixes every path with
 * `tenants/<slug>/` for the currently active tenant.
 *
 * @param disk  The disk name passed to `Storage.disk()`. Defaults to the default disk.
 * @param storageManager  Optional — pass the `StorageManager` instance directly (useful
 *   in tests or when the facade isn't available).  When omitted the global `Storage`
 *   facade is resolved dynamically at call time.
 */
export function tenantDisk(disk?: string, storageManager?: StorageManagerLike): StorageDriver {
  const slug = TenantContext.get().slug;

  const _getDriver = (): StorageDriver => {
    const manager = storageManager ?? _resolveStorage();
    return manager.disk(disk);
  };

  const _root = `tenants/${slug}/`;

  /**
   * Confine a caller-supplied key to this tenant's directory.
   *
   * A bare template prefix was not enough. LocalDriver._fullPath confines paths to the *disk
   * root*, not to the tenant directory, so `../victim/invoice.txt` resolved to
   * `<root>/tenants/victim/invoice.txt`, passed the root check, and read another tenant's file.
   */
  const _prefix = (path: string): string => {
    if (typeof path !== "string") {
      throw new TenantStoragePathError(String(path), slug);
    }
    const normalised = path.replaceAll("\\", "/");
    if (
      normalised.startsWith("/") ||
      normalised.split("/").some((segment) => segment === ".." || segment === "~")
    ) {
      throw new TenantStoragePathError(path, slug);
    }
    return `${_root}${normalised}`;
  };

  /** Methods whose *second* argument is also a path within the same disk. */
  const _twoPathMethods = new Set(["copy", "move"]);

  return new Proxy({} as StorageDriver, {
    get(_target, prop: string) {
      const driver = _getDriver();
      const method = (driver as Record<string, unknown>)[prop];
      if (typeof method === "function") {
        return (path: string, ...rest: unknown[]) => {
          const args = [...rest];
          // copy(from, to) / move(from, to): prefixing only `from` let the destination escape
          // the tenant entirely — proxy.copy("mine.txt", "tenants/victim/pwned.txt") wrote
          // straight into another tenant's directory.
          if (_twoPathMethods.has(prop) && typeof args[0] === "string") {
            args[0] = _prefix(args[0]);
          }
          return (method as (p: string, ...a: unknown[]) => unknown).call(
            driver,
            _prefix(path),
            ...args,
          );
        };
      }
      return method;
    },
  });
}

function _resolveStorage(): StorageManagerLike {
  try {
    // Resolved lazily so tenancy works in an app that never configures a disk.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Storage } = require("@zerotal/core/storage") as { Storage: StorageManagerLike };
    return Storage;
  } catch {
    throw new TenancyConfigError(
      "tenantDisk() requires a configured storage disk (see @zerotal/core/storage).",
    );
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

type CacheManagerLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  forget(key: string): Promise<void>;
  flush(): Promise<void>;
  [key: string]: unknown;
};

type CacheResolverLike =
  | {
      store(name?: string): CacheManagerLike;
    }
  | CacheManagerLike;

/**
 * Return a proxy over the cache that prefixes every key with
 * `tenant:<slug>:` for the currently active tenant.
 *
 * @param store  Optional store name (e.g. `'redis'`).
 * @param cacheResolver  Optional — inject the Cache facade or manager directly.
 */
export function tenantCache(store?: string, cacheResolver?: CacheResolverLike): CacheManagerLike {
  const slug = TenantContext.get().slug;

  const _getManager = (): CacheManagerLike => {
    const resolver = cacheResolver ?? _resolveCache();
    return typeof (resolver as Record<string, unknown>)["store"] === "function"
      ? (resolver as { store(n?: string): CacheManagerLike }).store(store)
      : (resolver as CacheManagerLike);
  };

  const _prefix = (key: string) => `tenant:${slug}:${key}`;

  return new Proxy({} as CacheManagerLike, {
    get(_target, prop: string) {
      const manager = _getManager();
      const method = (manager as Record<string, unknown>)[prop];
      if (typeof method === "function") {
        if (prop === "flush") {
          // flush() takes no key — delegate as-is.
          return () => (method as () => unknown).call(manager);
        }
        return (key: string, ...rest: unknown[]) =>
          (method as (k: string, ...a: unknown[]) => unknown).call(manager, _prefix(key), ...rest);
      }
      return method;
    },
  });
}

function _resolveCache(): CacheResolverLike {
  try {
    // Optional peer probed synchronously — a static import would fail when the
    // package is absent, and this resolver cannot be async.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Cache } = require("@zerotal/cache") as { Cache: CacheResolverLike };
    return Cache;
  } catch {
    throw new TenancyConfigError(
      "tenantCache() requires @zerotal/cache to be installed and configured.",
    );
  }
}
