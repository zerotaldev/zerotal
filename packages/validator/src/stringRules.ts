/**
 * Pipe-delimited string-rule validation ("required|min:3|email").
 *
 * This complements the fluent `RuleBuilder` schema API with the pipe-separated string syntax
 * (and string arrays). It is the single engine for string rules across the framework — Flow's
 * `@validate("…")` decorator and `this.validate()` delegate here rather than rolling their own,
 * and the fluent schema engine (`Validator.ts`) delegates to the {@link RULES} registry for
 * every rule it covers.
 */

/** @internal */
export type StringRules = Record<string, string | string[]>;

export type RuleFn = (
  value: unknown,
  param: string,
  data: Record<string, unknown>,
) => string | null;

/**
 * The shared rule registry — one implementation per rule name.
 *
 * Both the string-rule engine ({@link runStringRules}) and the fluent schema engine
 * (`Validator.applyRule`) resolve rules from this map, so a rule like `email` behaves
 * identically no matter which entry point it is validated through. Messages use the
 * `:attr` placeholder, replaced with the field label by the caller.
 */
export const RULES: Record<string, RuleFn> = {
  required(value) {
    if (value === null || value === undefined || value === "") return ":attr is required.";
    if (Array.isArray(value) && value.length === 0) return ":attr is required.";
    return null;
  },
  nullable: () => null,
  sometimes: () => null,

  string(value) {
    return typeof value !== "string" ? ":attr must be a string." : null;
  },
  numeric(value) {
    return isNaN(Number(value)) ? ":attr must be numeric." : null;
  },
  integer(value) {
    return !Number.isInteger(Number(value)) ? ":attr must be an integer." : null;
  },
  boolean(value) {
    return ([true, false, "true", "false", "1", "0", 1, 0] as unknown[]).includes(value)
      ? null
      : ":attr must be true or false.";
  },
  array(value) {
    return Array.isArray(value) ? null : ":attr must be an array.";
  },
  email(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""))
      ? null
      : ":attr must be a valid email address.";
  },
  url(value) {
    try {
      new URL(String(value ?? ""));
      return null;
    } catch {
      return ":attr must be a valid URL.";
    }
  },
  min(value, param) {
    const n = Number(param);
    if (typeof value === "string") {
      return value.length < n ? `:attr must be at least ${n} characters.` : null;
    }
    if (Array.isArray(value)) {
      return value.length < n ? `:attr must have at least ${n} items.` : null;
    }
    const num = Number(value);
    return isNaN(num) || num < n ? `:attr must be at least ${n}.` : null;
  },
  max(value, param) {
    const n = Number(param);
    if (typeof value === "string") {
      return value.length > n ? `:attr must not exceed ${n} characters.` : null;
    }
    if (Array.isArray(value)) {
      return value.length > n ? `:attr must have no more than ${n} items.` : null;
    }
    const num = Number(value);
    return isNaN(num) || num > n ? `:attr must not exceed ${n}.` : null;
  },
  size(value, param) {
    const n = Number(param);
    if (typeof value === "string") {
      return value.length !== n ? `:attr must be exactly ${n} characters.` : null;
    }
    if (Array.isArray(value)) {
      return value.length !== n ? `:attr must contain exactly ${n} items.` : null;
    }
    return Number(value) !== n ? `:attr must be exactly ${n}.` : null;
  },
  between(value, param) {
    const [lo, hi] = param.split(",").map(Number) as [number, number];
    const n = Number(value);
    if (typeof value === "string") {
      return value.length < lo || value.length > hi
        ? `:attr must be between ${lo} and ${hi} characters.`
        : null;
    }
    return isNaN(n) || n < lo || n > hi ? `:attr must be between ${lo} and ${hi}.` : null;
  },
  in(value, param) {
    const opts = param.split(",").map((s) => s.trim());
    return opts.includes(String(value)) ? null : `:attr must be one of: ${opts.join(", ")}.`;
  },
  not_in(value, param) {
    const opts = param.split(",").map((s) => s.trim());
    return !opts.includes(String(value)) ? null : `:attr must not be one of: ${opts.join(", ")}.`;
  },
  same(value, param, data) {
    return value === data[param] ? null : `:attr must match ${param}.`;
  },
  different(value, param, data) {
    return value !== data[param] ? null : `:attr must be different from ${param}.`;
  },
  gt(value, param, data) {
    const ref = Number(data[param] ?? param);
    return Number(value) > ref ? null : `:attr must be greater than ${param}.`;
  },
  lt(value, param, data) {
    const ref = Number(data[param] ?? param);
    return Number(value) < ref ? null : `:attr must be less than ${param}.`;
  },
  gte(value, param, data) {
    const ref = Number(data[param] ?? param);
    return Number(value) >= ref ? null : `:attr must be greater than or equal to ${param}.`;
  },
  lte(value, param, data) {
    const ref = Number(data[param] ?? param);
    return Number(value) <= ref ? null : `:attr must be less than or equal to ${param}.`;
  },
  alpha(value) {
    return /^[a-zA-Z]+$/.test(String(value)) ? null : ":attr must only contain letters.";
  },
  alpha_num(value) {
    return /^[a-zA-Z0-9]+$/.test(String(value))
      ? null
      : ":attr must only contain letters and numbers.";
  },
  alpha_dash(value) {
    return /^[a-zA-Z0-9_-]+$/.test(String(value))
      ? null
      : ":attr must only contain letters, numbers, dashes, and underscores.";
  },
  starts_with(value, param) {
    const vals = param.split(",");
    return vals.some((v) => String(value).startsWith(v))
      ? null
      : `:attr must start with: ${vals.join(", ")}.`;
  },
  ends_with(value, param) {
    const vals = param.split(",");
    return vals.some((v) => String(value).endsWith(v))
      ? null
      : `:attr must end with: ${vals.join(", ")}.`;
  },
  regex(value, param) {
    try {
      const m = param.match(/^\/(.+)\/([gimsuy]*)$/);
      const re = m ? new RegExp(m[1]!, m[2]) : new RegExp(param);
      return re.test(String(value)) ? null : ":attr format is invalid.";
    } catch {
      return ":attr format is invalid.";
    }
  },
  accepted(value) {
    return (["yes", "on", "1", "true", 1, true] as unknown[]).includes(value)
      ? null
      : ":attr must be accepted.";
  },
  declined(value) {
    return (["no", "off", "0", "false", 0, false] as unknown[]).includes(value)
      ? null
      : ":attr must be declined.";
  },
  digits(value, param) {
    const s = String(value);
    return /^\d+$/.test(s) && s.length === Number(param) ? null : `:attr must be ${param} digits.`;
  },
  digits_between(value, param) {
    const [lo, hi] = param.split(",").map(Number) as [number, number];
    const s = String(value);
    return /^\d+$/.test(s) && s.length >= lo && s.length <= hi
      ? null
      : `:attr must be between ${lo} and ${hi} digits.`;
  },
  ip(value) {
    const s = String(value);
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4.test(s) || ipv6.test(s) ? null : ":attr must be a valid IP address.";
  },
  password_mixed_case(value) {
    const s = String(value);
    return /[a-z]/.test(s) && /[A-Z]/.test(s)
      ? null
      : ":attr must contain at least one uppercase and one lowercase letter.";
  },
  password_numbers(value) {
    return /\d/.test(String(value)) ? null : ":attr must contain at least one number.";
  },
  password_symbols(value) {
    return /[^a-zA-Z0-9]/.test(String(value)) ? null : ":attr must contain at least one symbol.";
  },
  password_no_spaces(value) {
    return /\s/.test(String(value)) ? ":attr must not contain spaces." : null;
  },
  date(value) {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? ":attr must be a valid date." : null;
  },
  json(value) {
    try {
      JSON.parse(String(value));
      return null;
    } catch {
      return ":attr must be valid JSON.";
    }
  },
};

function _parseRules(raw: string | string[]): Array<{ name: string; param: string }> {
  const list = typeof raw === "string" ? raw.split("|") : raw;
  return list.map((r) => {
    const i = r.indexOf(":");
    return i === -1
      ? { name: r.trim(), param: "" }
      : { name: r.slice(0, i).trim(), param: r.slice(i + 1).trim() };
  });
}

function _label(field: string): string {
  return `The ${field.replace(/_/g, " ")} field`;
}

/**
 * Validate `data` against pipe-delimited string `rules`. Returns a map of field → error messages
 * for every field that failed (an empty object means everything passed).
 *
 * @internal
 */
export function runStringRules(
  data: Record<string, unknown>,
  rules: StringRules,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const [field, rawRules] of Object.entries(rules)) {
    const parsed = _parseRules(rawRules);
    const value = data[field];

    // `sometimes` — skip if field absent from data
    if (parsed.some((r) => r.name === "sometimes") && !(field in data)) continue;

    // `nullable` — skip remaining rules if value is empty
    const isEmpty = value === null || value === undefined || value === "";
    if (parsed.some((r) => r.name === "nullable") && isEmpty) continue;

    const msgs: string[] = [];
    for (const { name, param } of parsed) {
      if (name === "sometimes" || name === "nullable") continue;

      // `confirmed` — field must equal field_confirmation
      if (name === "confirmed") {
        if (value !== data[`${field}_confirmation`]) {
          msgs.push(`${_label(field)} confirmation does not match.`);
        }
        continue;
      }

      const fn = RULES[name];
      if (!fn) continue; // unknown string rule — skip gracefully (may be a decorator-only rule)

      const msg = fn(value, param, data);
      if (msg) msgs.push(msg.replace(":attr", _label(field)));
    }

    if (msgs.length > 0) errors[field] = msgs;
  }

  return errors;
}

/**
 * Async variant of {@link runStringRules}. Currently wraps the synchronous engine; exists so
 * callers (e.g. Flow's `await this.validate()`) have a stable async entry point as
 * database-backed string rules (`unique`/`exists`) are layered in.
 *
 * @internal
 */
export async function runStringRulesAsync(
  data: Record<string, unknown>,
  rules: StringRules,
): Promise<Record<string, string[]>> {
  return runStringRules(data, rules);
}
