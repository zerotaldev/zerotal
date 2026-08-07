/**
 * The global `config()` helper — a typed accessor over the application's
 * `ConfigManager`, with `.set`, `.require`, `.all`, and `.safe` attached for
 * reading and writing configuration from anywhere in a booted app.
 */
import { currentApp } from "../application/currentApp.ts";
import type { ConfigManager } from "../config/ConfigManager.ts";
import type { ConfigPath, ConfigValue } from "../config/registry.ts";

function _manager(): ConfigManager {
  return currentApp().container.makeSync("config") as ConfigManager;
}

/**
 * Read a configuration value by dot-path, with an optional fallback.
 *
 * Known paths (those declared on the augmented `ConfigRegistry`) are resolved by
 * the typed overloads first, so `config('app.name')` is inferred as `string`; a
 * plain `string` path falls through to the untyped escape-hatch overloads.
 */
function config<P extends ConfigPath>(path: P): ConfigValue<P>;
function config<P extends ConfigPath>(path: P, fallback: ConfigValue<P>): ConfigValue<P>;
function config(path: string): unknown;
function config<T>(path: string, fallback: T): T;
function config(path: string, fallback?: unknown): unknown {
  return _manager().get(path, fallback);
}

// Typed setter — value is checked against the path's declared shape.
function _set<P extends ConfigPath>(path: P, value: ConfigValue<P>): void;
function _set(path: string, value: unknown): void;
function _set(path: string, value: unknown): void {
  _manager().set(path, value);
}
config.set = _set;

// Typed require — throws when the path is absent.
function _require<P extends ConfigPath>(path: P): ConfigValue<P>;
function _require<T = unknown>(path: string): T;
function _require(path: string): unknown {
  return _manager().require(path);
}
config.require = _require;

config.all = (): Record<string, unknown> => _manager().all();

/** Read config without throwing when no app is booted (returns the fallback). */
function _safe<P extends ConfigPath>(path: P, fallback: ConfigValue<P>): ConfigValue<P>;
function _safe<T>(path: string, fallback: T): T;
function _safe(path: string, fallback: unknown): unknown {
  try {
    return _manager().get(path, fallback);
  } catch {
    return fallback;
  }
}
config.safe = _safe;

export { config };
