/**
 * The typed config registry and the dot-path types built from it. `ConfigRegistry`
 * is the config analogue of `ContainerBindings`: every config-owning package
 * augments it via declaration merging so `config("app.name")` is type-checked and
 * auto-completed by namespace. Core owns the `app` and `health` namespaces.
 */

// Augmenting packages extend the registry like so:
//
//   declare module "@zerotal/core" {
//     interface ConfigRegistry { cache: CacheConfigShape }
//   }

import type { AppConfigShape } from "./AppConfig.ts";
import type { HealthConfigShape } from "../health/Health.ts";

/**
 * Maps each config namespace to its shape. Augment it from any package that owns a
 * `config/<namespace>.ts` file. Unaugmented namespaces fall back to the untyped
 * `config(path: string)` overload, so dynamic access still compiles.
 */
export interface ConfigRegistry {
  app: AppConfigShape;
  health: HealthConfigShape;
  lock: import("../lock/config.ts").LockConfigShape;
  logging: import("../logger/config.ts").LoggingConfigShape;
}

// ── Dot-path machinery ────────────────────────────────────────────────────────

/** True only for plain nested objects — not arrays or functions (which shouldn't expand). */
type IsNested<T> = T extends readonly unknown[]
  ? false
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends (...args: any[]) => unknown
    ? false
    : T extends object
      ? true
      : false;

/** Union of every dot-path through `T` (e.g. `'app' | 'app.name' | 'cache.ttl'`). */
type Leaves<T> = {
  [K in keyof T & string]: IsNested<T[K]> extends true ? `${K}` | `${K}.${Leaves<T[K]>}` : `${K}`;
}[keyof T & string];

/** The value type at dot-path `P` within `T`. Unknown paths resolve to `unknown`. */
type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : unknown
  : P extends keyof T
    ? T[P]
    : unknown;

/** Every valid dot-path string across the registered config namespaces. */
export type ConfigPath = Leaves<ConfigRegistry>;

/** The value type stored at a given config dot-path. */
export type ConfigValue<P extends string> = ValueAt<ConfigRegistry, P>;
