/**
 * Setting definitions: a typed default in code, plus what may override it.
 *
 *   setting.number({ default: 30, min: 0, max: 120, label: "Payment terms (days)" })
 *
 * A definition is data. It parses whatever comes back from storage or from an
 * admin form into its type, or throws {@link InvalidSettingValueError}, and the
 * type it parses to is what `settings.get()` returns.
 */
import { InvalidSettingValueError } from "./errors.ts";

/**
 * The levels a setting can be overridden at, most specific first when read:
 *
 * - `user` — one user, inside the current tenant (or app-wide outside tenancy);
 * - `tenant` — one tenant (company);
 * - `global` — the whole app, replacing the default in code without a deploy.
 */
export type SettingScopeKind = "global" | "tenant" | "user";

/** The kinds of value a setting holds; the admin screen picks its input from this. */
export type SettingType = "string" | "number" | "boolean" | "enum" | "json";

/** One declared setting. Build it with {@link setting}. */
export interface SettingDefinition<T = unknown> {
  readonly type: SettingType;
  /** The value when nothing overrides it. */
  readonly default: T;
  /** Levels this setting may be overridden at. */
  readonly scopes: readonly SettingScopeKind[];
  /** The name on the settings screen. Defaults to the key. */
  readonly label: string | undefined;
  /** A line of help under the label. */
  readonly description: string | undefined;
  /** The heading the setting is listed under. Defaults to the key's first segment. */
  readonly group: string | undefined;
  /** The allowed values, for an `enum` setting. */
  readonly options: readonly string[] | undefined;
  /**
   * Turn a candidate value into this setting's type, or throw
   * {@link InvalidSettingValueError}. `fromText` is true for text typed into a
   * form, where `"42"` means the number and `"true"` the boolean.
   */
  parse(value: unknown, key: string, fromText?: boolean): T;
}

/** What every kind of setting accepts. */
export interface BaseSettingOptions<T> {
  /** The value when nothing overrides it. */
  default: T;
  /** Levels this setting may be overridden at. Default: `["global", "tenant"]`. */
  scopes?: readonly SettingScopeKind[] | undefined;
  /** The name on the settings screen. Defaults to the key. */
  label?: string | undefined;
  /** A line of help under the label. */
  description?: string | undefined;
  /** The heading the setting is listed under. Defaults to the key's first segment. */
  group?: string | undefined;
  /** A last check of your own: return a reason to refuse the value, or nothing. */
  validate?: ((value: T) => string | undefined | void) | undefined;
}

/** Options for {@link setting.string}. */
export interface StringSettingOptions extends BaseSettingOptions<string> {
  /** The longest value accepted, in characters. */
  maxLength?: number | undefined;
  /** A pattern the whole value must match. */
  pattern?: RegExp | undefined;
}

/** Options for {@link setting.number}. */
export interface NumberSettingOptions extends BaseSettingOptions<number> {
  min?: number | undefined;
  max?: number | undefined;
  /** Accept whole numbers only. */
  integer?: boolean | undefined;
}

/** Options for {@link setting.boolean}. */
export type BooleanSettingOptions = BaseSettingOptions<boolean>;

/** Options for {@link setting.enum}. */
export type EnumSettingOptions<T extends string> = BaseSettingOptions<T>;

/** Options for {@link setting.json}. */
export type JsonSettingOptions<T> = BaseSettingOptions<T>;

const DEFAULT_SCOPES: readonly SettingScopeKind[] = ["global", "tenant"];

/** Marks a refusal, so a JSON setting whose value has an `invalid` key is not one. */
const INVALID: unique symbol = Symbol("invalid");
type Refusal = { [INVALID]: string };
const invalid = (reason: string): Refusal => ({ [INVALID]: reason });

function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && INVALID in value;
}

function build<T>(
  type: SettingType,
  options: BaseSettingOptions<T>,
  check: (value: unknown, fromText: boolean) => T | Refusal,
  choices?: readonly string[],
): SettingDefinition<T> {
  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const definition: SettingDefinition<T> = {
    type,
    default: options.default,
    scopes,
    label: options.label,
    description: options.description,
    group: options.group,
    options: choices,
    parse(value, key, fromText = false) {
      const result = check(value, fromText);
      if (isRefusal(result)) throw new InvalidSettingValueError(key, result[INVALID]);
      const reason = options.validate?.(result);
      if (reason) throw new InvalidSettingValueError(key, reason);
      return result;
    },
  };
  // The default has to pass its own definition, or a reader can be handed a value
  // the screen would refuse to save.
  definition.parse(options.default, "(default)");
  return definition;
}

/** Builders for setting definitions, one per kind of value. */
export const setting = {
  /** Text. */
  string(options: StringSettingOptions): SettingDefinition<string> {
    return build("string", options, (value) => {
      if (typeof value !== "string") return invalid("expected text");
      if (options.maxLength !== undefined && value.length > options.maxLength) {
        return invalid(`longer than ${options.maxLength} characters`);
      }
      if (options.pattern && !options.pattern.test(value)) {
        return invalid(`does not match ${String(options.pattern)}`);
      }
      return value;
    });
  },

  /** A number, optionally bounded or whole. */
  number(options: NumberSettingOptions): SettingDefinition<number> {
    return build("number", options, (value, fromText) => {
      const n =
        fromText && typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return invalid("expected a number");
      if (options.integer && !Number.isInteger(n)) return invalid("expected a whole number");
      if (options.min !== undefined && n < options.min) return invalid(`less than ${options.min}`);
      if (options.max !== undefined && n > options.max) return invalid(`more than ${options.max}`);
      return n;
    });
  },

  /** On or off. */
  boolean(options: BooleanSettingOptions): SettingDefinition<boolean> {
    return build("boolean", options, (value, fromText) => {
      if (typeof value === "boolean") return value;
      if (fromText && (value === "true" || value === "1" || value === "on")) return true;
      if (fromText && (value === "false" || value === "0" || value === "off")) return false;
      return invalid("expected true or false");
    });
  },

  /** One of a fixed list of strings. */
  enum<const T extends string>(
    values: readonly T[],
    options: EnumSettingOptions<NoInfer<T>>,
  ): SettingDefinition<T> {
    return build(
      "enum",
      options,
      (value) =>
        typeof value === "string" && (values as readonly string[]).includes(value)
          ? (value as T)
          : invalid(`expected one of ${values.join(", ")}`),
      values,
    );
  },

  /**
   * Any JSON value. The type parameter is a promise you make about its shape;
   * pass `validate` to hold stored values to it.
   */
  json<T>(options: JsonSettingOptions<T>): SettingDefinition<T> {
    return build("json", options, (value, fromText) => {
      if (fromText && typeof value === "string") {
        try {
          return JSON.parse(value) as T;
        } catch {
          return invalid("expected JSON");
        }
      }
      return value === undefined ? invalid("expected a value") : (value as T);
    });
  },
};
