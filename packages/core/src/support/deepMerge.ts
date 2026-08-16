/**
 * Recursive object merge (lodash.merge-style): merges `override` onto `base`
 * and returns a brand-new value, used by config factories and middleware option
 * builders. See the notes below for the full merge semantics.
 */

// Semantics:
//   • Nested PLAIN objects merge key-by-key, recursively — a partial override of a
//     deep object keeps the base's other keys, at any depth.
//   • Arrays and primitives REPLACE wholesale (see "Arrays" below).
//   • Class instances, Dates, Maps, Sets, RegExps, functions, etc. are treated as
//     atomic values: replaced wholesale and passed through by reference (never
//     merged into and never cloned), so their prototype and identity survive.
//   • `undefined` values in `override` are ignored, so a partial override never
//     blanks out a default.
//   • Neither `base` nor `override` is mutated, and the result shares no mutable
//     plain structure with either: every plain object and array in the result is a
//     fresh copy. This means mutating the merged config can never corrupt the
//     module-level `defaults` object a factory merges onto, nor the options object
//     the caller passed in.
//   • Prototype-polluting keys (`__proto__`, `constructor`, `prototype`) are
//     skipped, so merging untrusted input (env files, parsed JSON) is safe.
//
// ── Arrays ────────────────────────────────────────────────────────────────────
// Arrays are REPLACED as a whole — never concatenated, de-duplicated, or merged
// element-by-element:
//
//   deepMerge({ hosts: ["a", "b"] }, { hosts: ["c"] })  →  { hosts: ["c"] }
//   // NOT ["a","b","c"], and NOT ["c","b"].
//
// This is deliberate: there is no surprise-free universal rule for merging two
// arrays (append? replace-by-index? union?), so the override is given the final
// say. Guidance when designing config/middleware option shapes:
//   • If an option is a list users should be able to EXTEND, expose it as a plain
//     array and document that providing it replaces the default outright. Tell
//     users to spread the default themselves, e.g.
//     `SomeConfig({ hosts: [...DEFAULT_HOSTS, "extra"] })`.
//   • If you need a keyed, extensible sub-config, model it as a nested OBJECT keyed
//     by name (like `cache.stores` or `storage.disks`) rather than an array.
//     Objects merge, so a user can add one key without losing the built-ins.
//   • The replacement array is deep-cloned, so mutating the merged result never
//     reaches back into the value the caller passed in.

/** Keys that must never be copied across — they can pollute `Object.prototype`. */
const _UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Values {@link deepMerge} treats as atomic: replaced wholesale, never recursed
 * into. Kept in step with `_isPlainObject` below — a type that recursed into an
 * array would ask callers for `{ 0?: string }` where the function wants
 * `string[]`.
 */
type _Atomic =
  | readonly unknown[]
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | ((...args: never[]) => unknown);

/**
 * Every key optional, all the way down — the shape {@link deepMerge} actually
 * accepts.
 *
 * `Partial<T>` only makes the *top* level optional, so
 * `{ drivers: { anthropic: { apiKey } } }` — the single most common thing anyone
 * writes in a config file — was a type error against a shape whose `anthropic`
 * has other keys, even though the merge handles it perfectly. `@zerotal/ai` hit
 * this first and defined its own copy; this is that type, promoted so nothing
 * has to define it again.
 *
 * The explicit `| undefined` is deliberate under `exactOptionalPropertyTypes`:
 * `deepMerge` documents that an `undefined` override is skipped rather than
 * blanking a default, so passing one explicitly has a defined meaning and
 * should type-check.
 */
export type DeepPartial<T> = {
  [K in keyof T]?:
    | (NonNullable<T[K]> extends _Atomic
        ? T[K]
        : NonNullable<T[K]> extends object
          ? DeepPartial<NonNullable<T[K]>>
          : T[K])
    | undefined;
};

/**
 * A *plain* object: a `{}`-style record whose prototype is `Object.prototype` or
 * `null`. Class instances, arrays, Dates, Maps, etc. are intentionally excluded so
 * deepMerge treats them as atomic values instead of recursing into them.
 */
function _isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-clone plain objects and arrays; return everything else (primitives,
 * functions, class instances, Dates, …) by reference. Keeps merged results
 * structurally isolated from their inputs without breaking non-plain values.
 */
function _clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((el) => _clone(el)) as unknown as T;
  if (_isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (_UNSAFE_KEYS.has(key)) continue;
      out[key] = _clone((value as Record<string, unknown>)[key]);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Deep-merge `override` onto `base`. Used by config factories (`AppConfig`,
 * `CacheConfig`, …) and `BaseMiddleware.with()` so user overrides change only the
 * keys they specify — at any depth — leaving every other default in place.
 *
 * Nested plain objects merge recursively; arrays, primitives, and class instances
 * replace wholesale; `undefined` overrides are ignored; and the result is a fresh
 * value that shares no mutable plain structure with `base` or `override`. See the
 * file header for full semantics, including the array-replacement rule.
 *
 * @example
 * deepMerge(
 *   { cors: { origin: "*", credentials: false }, port: 3000 },
 *   { cors: { credentials: true } },
 * );
 * // → { cors: { origin: "*", credentials: true }, port: 3000 }
 *
 * @example
 * // Arrays replace — they are not concatenated:
 * deepMerge({ tags: ["a", "b"] }, { tags: ["c"] });
 * // → { tags: ["c"] }
 */
export function deepMerge<T extends object>(base: T, override: DeepPartial<T>): T {
  const result = _clone(base) as T;
  for (const key in override) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
    if (_UNSAFE_KEYS.has(key)) continue;
    const overrideValue = override[key];
    if (overrideValue === undefined) continue;
    const baseValue = (result as Record<string, unknown>)[key];
    if (_isPlainObject(overrideValue) && _isPlainObject(baseValue)) {
      (result as Record<string, unknown>)[key] = deepMerge(
        baseValue,
        overrideValue as DeepPartial<typeof baseValue>,
      );
    } else {
      (result as Record<string, unknown>)[key] = _clone(overrideValue);
    }
  }
  return result;
}
