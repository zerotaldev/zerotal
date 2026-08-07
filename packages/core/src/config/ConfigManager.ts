/**
 * The runtime configuration store: holds the merged config namespaces and
 * serves dot-path reads/writes behind the `Config` facade and `config()` helper.
 */
import { ConfigError } from "../errors/ConfigError.ts";

/**
 * The runtime configuration store — holds every loaded config namespace and
 * serves dot-path reads and writes.
 *
 * Populated from the `config/*.ts` files during `onBooting()` by a
 * ServiceProvider, then bound in the container under `config`. Application code
 * rarely touches this class directly; it reads through the `Config` facade or
 * the `config()` helper, both of which delegate here.
 *
 * @example
 * ```ts
 * import { config } from "@zerotal/core";
 * import { Config } from "@zerotal/core/facades";
 *
 * // Typed dot-path access (via the config() helper):
 * const name = config("app.name");     // string
 * const port = config("app.port");     // number
 *
 * // Or through the facade:
 * const url = Config.get("app.url", "http://localhost:3000");
 * ```
 */
export class ConfigManager {
  private _data: Record<string, unknown>;
  constructor() {
    this._data = {};
  }

  // ── Loading ───────────────────────────────────────────────────────────

  /**
   * Merge a config namespace into the store, replacing any existing value under
   * the same key. Called by ConfigProvider during `onBooting()`.
   *
   * @param namespace  Top-level namespace key (the config filename, e.g. `app`).
   * @param values     The namespace's config object.
   *
   * @example
   * ```ts
   * config.load('app', { name: 'Zerotal', env: 'production' });
   * config.load('database', { url: 'postgres://localhost/mydb' });
   * ```
   */
  load(namespace: string, values: Record<string, unknown>): void {
    this._data[namespace] = values;
  }

  // ── Access ────────────────────────────────────────────────────────────

  /**
   * Get a config value by dot-notation path, returning `fallback` when the path
   * resolves to `null`/`undefined` or does not exist.
   *
   * @param path      Dot-notation path, e.g. `app.name`.
   * @param fallback  Value returned when the path is missing.
   * @returns The stored value, or `fallback` when unset.
   *
   * @example
   * ```ts
   * config.get('app.name')                      // 'Zerotal'
   * config.get('database.connections.postgres') // { url: '...' }
   * config.get('app.missing', 'default')        // 'default'
   * ```
   */
  get<T = unknown>(path: string, fallback?: T): T {
    const keys = path.split(".");
    let current: unknown = this._data;

    for (const key of keys) {
      if (current == null || typeof current !== "object") {
        return (fallback ?? undefined) as T;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return (current ?? fallback ?? undefined) as T;
  }

  /**
   * Get a config value, throwing when it is `null` or `undefined`. Use for
   * required config that the app cannot start without.
   *
   * @param path  Dot-notation path, e.g. `app.key`.
   * @returns The stored value (guaranteed present).
   * @throws {ConfigError} When the path resolves to `undefined` or `null`.
   *
   * @example
   * ```ts
   * config.require('app.key') // throws if APP_KEY is not set
   * ```
   */
  require<T = unknown>(path: string): T {
    const value = this.get<T>(path);
    if (value === undefined || value === null) {
      throw new ConfigError(
        `Required config value "${path}" is not set. ` +
          `Check your .env file and config/${path.split(".")[0]}.ts.`,
      );
    }
    return value;
  }

  /**
   * Set a config value at a dot-path at runtime, creating intermediate objects
   * as needed. Intended for tests or dynamic overrides; in production prefer
   * loading config files via {@link ConfigManager.load}.
   *
   * @param path   Dot-notation path to write, e.g. `app.debug`.
   * @param value  The value to store.
   */
  set(path: string, value: unknown): void {
    const keys = path.split(".");
    // `config.set("__proto__.isAdmin", true)` used to walk onto Object.prototype and pollute
    // every object in the process. deepMerge already guards exactly these keys
    // (support/deepMerge.ts _UNSAFE_KEYS); ConfigManager did not.
    if (keys.some((key) => _UNSAFE_CONFIG_KEYS.has(key))) {
      throw new ConfigError(
        `Refusing to set config path "${path}": it walks through a prototype key ` +
          `(__proto__, constructor, prototype), which would mutate Object.prototype.`,
      );
    }
    let current = this._data;

    for (let index = 0; index < keys.length - 1; index++) {
      const key = keys[index]!;
      if (typeof current[key] !== "object" || current[key] == null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]!] = value;
  }

  /**
   * Check whether a config path has a value set (i.e. `get(path)` is not
   * `undefined`).
   *
   * @param path  Dot-notation path to test.
   * @returns `true` when a value exists at the path.
   */
  has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /**
   * Return a shallow copy of all loaded config namespaces. Useful for
   * debugging.
   *
   * @returns A new object mapping each namespace to its config value. The copy
   * is shallow — nested namespace objects are shared, not cloned.
   */
  all(): Record<string, unknown> {
    return { ...this._data };
  }
}

/**
 * Keys that must never appear in a `set()` path. Writing through any of them reaches
 * `Object.prototype` and pollutes every object in the process. Mirrors the guard in
 * `support/deepMerge.ts`.
 */
const _UNSAFE_CONFIG_KEYS = new Set(["__proto__", "constructor", "prototype"]);
