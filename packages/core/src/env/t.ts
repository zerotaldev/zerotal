/**
 * The `t` env-field builder — the entry point that produces typed `Def<T>`
 * field definitions (`t.string()`, `t.number()`, `t.enum([...])`, …) for use
 * with `EnvSchema.define()`.
 */
import { Def, REQUIRED_MARKER } from "./Def.ts";
import type { RequiredMarker, FieldType, FieldSpec } from "./Def.ts";

function _def<T>(type: FieldType, extra?: Partial<FieldSpec>): Def<T> {
  return new Def<T>({ type, required: false, defaultValue: undefined, conditions: [], ...extra });
}

/**
 * The `t` builder — the entry point for all field type definitions.
 *
 * Every method returns a `Def<T>` which can be further configured with
 * `.required()`, `.default(val)`, or `.when(field, value, t.required())`.
 *
 * @example
 * ```ts
 * import { EnvSchema, t } from '@zerotal/core/env';
 *
 * export const env = EnvSchema.define({
 *   PORT:     t.number().default(3000),
 *   NODE_ENV: t.enum(['development', 'production', 'testing']).required(),
 *   DB_HOST:  t.string().required(),
 *   DB_PASS:  t.string().when('NODE_ENV', 'production', t.required()),
 *   DEBUG:    t.boolean().default(false),
 *   BASE_URL: t.url().required(),
 * });
 * ```
 */
export const t = {
  /**
   * A plain string environment variable.
   *
   * @example
   * ```ts
   * APP_NAME:  t.string().default('Zerotal App')  // string
   * DB_HOST:   t.string().required()            // string
   * REDIS_URL: t.string()                       // string | undefined
   * ```
   */
  string(): Def<string | undefined> {
    return _def<string | undefined>("string");
  },

  /**
   * A numeric environment variable (parsed with `Number()`).
   * Non-numeric values cause a boot-time error.
   *
   * @example
   * ```ts
   * PORT:    t.number().default(3000)  // number
   * TIMEOUT: t.number().required()     // number
   * ```
   */
  number(): Def<number | undefined> {
    return _def<number | undefined>("number");
  },

  /**
   * A boolean environment variable.
   * Accepts: `true`, `false`, `1`, `0`, `yes`, `no` (case-insensitive).
   *
   * @example
   * ```ts
   * DEBUG:     t.boolean().default(false)  // boolean
   * CACHE_HOT: t.boolean().required()      // boolean
   * ```
   */
  boolean(): Def<boolean | undefined> {
    return _def<boolean | undefined>("boolean");
  },

  /**
   * An enum-constrained string variable.
   * The value must be one of the provided literals — anything else causes a boot-time error.
   * Pass the array `as const` (or inline) for accurate literal type inference.
   *
   * @example
   * ```ts
   * NODE_ENV: t.enum(['development', 'production', 'testing']).required()
   * // output: 'development' | 'production' | 'testing'
   * ```
   */
  enum<const V extends readonly string[]>(values: V): Def<V[number] | undefined> {
    return _def<V[number] | undefined>("enum", { enumValues: values });
  },

  /**
   * A URL-validated string. Parses with `new URL()` — invalid values cause a boot-time error.
   *
   * @example
   * ```ts
   * API_BASE: t.url().required()       // string (guaranteed valid URL)
   * CDN_URL:  t.url().default('...')   // string
   * ```
   */
  url(): Def<string | undefined> {
    return _def<string | undefined>("url");
  },

  /**
   * A validated TCP port number (integer 1–65535).
   *
   * @example
   * ```ts
   * PORT: t.port().default(3000)   // number
   * ```
   */
  port(): Def<number | undefined> {
    return _def<number | undefined>("port");
  },

  /**
   * Sentinel value for use as the third argument to `.when()`.
   * Signals that the field is required under the given condition.
   *
   * @example
   * ```ts
   * STRIPE_KEY: t.string().when('NODE_ENV', 'production', t.required())
   * ```
   */
  required(): RequiredMarker {
    return REQUIRED_MARKER;
  },
} as const;
