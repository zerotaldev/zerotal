import type { FieldRuleDefinition, Schema, CustomFn } from "./types.ts";
import type { UniqueOptions } from "./dbRules.ts";

// Narrow definition types — each class's _def has a literal 'type' field so
// that Infer<> can resolve the correct TypeScript type per field class.
type StringDef = Omit<FieldRuleDefinition, "type"> & { type: "string" };
type NumberDef = Omit<FieldRuleDefinition, "type"> & { type: "number" };
type BooleanDef = Omit<FieldRuleDefinition, "type"> & { type: "boolean" };
type ArrayDef = Omit<FieldRuleDefinition, "type"> & { type: "array" };
type ObjectDef = Omit<FieldRuleDefinition, "type"> & { type: "object" };

type RuleEntry = { name: string; args: unknown[]; message?: string; fn?: CustomFn };

function addRule(
  rules: Array<RuleEntry>,
  name: string,
  args: unknown[],
  message: string | undefined,
): void {
  if (message !== undefined) {
    rules.push({ name, args, message });
  } else {
    rules.push({ name, args });
  }
}

export abstract class FieldRule {
  abstract readonly _def: FieldRuleDefinition;

  /**
   * Mark this field as required (the default). Useful for readability, for re-asserting
   * after `.optional()`, or to attach a custom "is required" message:
   *
   *   rule.string().required("Please enter your name").min(2)
   */
  required(message?: string): this {
    this._def.required = true;
    if (message !== undefined) this._def.requiredMessage = message;
    return this;
  }

  optional(): this {
    this._def.required = false;
    return this;
  }

  nullable(): this {
    this._def.nullable = true;
    return this;
  }

  default(value: unknown): this {
    this._def.defaultVal = value;
    this._def.required = false;
    return this;
  }

  /**
   * Only run this field's rules if the field is present in the input.
   * Absent fields are silently skipped and excluded from the output.
   * Use for optional PATCH fields that should only be validated when provided.
   *
   * @example
   * bio: rules.string().sometimes().max(500)
   */
  sometimes(): this {
    this._def.sometimes = true;
    this._def.required = false;
    return this;
  }

  /**
   * Make this field required only when another field equals a specific value.
   *
   * @example
   * address: rules.string().requiredIf('hasShipping', true)
   * address: rules.string().requiredIf(input => input.method === 'pickup')
   */
  requiredIf(
    fieldOrFn: string | ((input: Record<string, unknown>) => boolean),
    value?: unknown,
  ): this {
    if (typeof fieldOrFn === "function") {
      this._def.requiredIf = { fn: fieldOrFn };
    } else {
      this._def.requiredIf = { field: fieldOrFn, value };
    }
    this._def.required = false;
    return this;
  }

  /**
   * Make this field required unless another field equals a specific value.
   *
   * @example
   * phone: rules.string().requiredUnless('contactMethod', 'email')
   */
  requiredUnless(
    fieldOrFn: string | ((input: Record<string, unknown>) => boolean),
    value?: unknown,
  ): this {
    if (typeof fieldOrFn === "function") {
      this._def.requiredUnless = { fn: fieldOrFn };
    } else {
      this._def.requiredUnless = { field: fieldOrFn, value };
    }
    this._def.required = false;
    return this;
  }

  /**
   * The value must be truthy: `true`, `1`, `'1'`, `'yes'`, `'on'`, `'true'`.
   * Use for "agree to terms" checkboxes.
   *
   * @example
   * terms: rules.boolean().accepted()
   */
  accepted(message?: string): this {
    addRule(this._def.rules, "accepted", [], message);
    return this;
  }

  /**
   * The value must be falsy: `false`, `0`, `'0'`, `'no'`, `'off'`, `'false'`.
   *
   * @example
   * newsletter: rules.boolean().declined()
   */
  declined(message?: string): this {
    addRule(this._def.rules, "declined", [], message);
    return this;
  }

  /**
   * Run a custom synchronous or asynchronous validation function.
   * Return `true` to pass, `false` for a generic error, or a `string` as the error message.
   *
   * @example
   * username: rules.string().custom(async (value) => {
   *   const taken = await Username.isTaken(value as string);
   *   return taken ? 'This username is already taken.' : true;
   * })
   */
  custom(fn: CustomFn, message?: string): this {
    const entry: RuleEntry = { name: "custom", args: [], fn };
    if (message !== undefined) entry.message = message;
    this._def.rules.push(entry);
    return this;
  }

  /**
   * This field is required when ANY of the listed fields are present in input.
   *
   * @example
   * cardCvv: rules.string().requiredWith(['cardNumber', 'cardExpiry'])
   */
  requiredWith(fields: string[]): this {
    this._def.requiredWith = fields;
    this._def.required = false;
    return this;
  }

  /**
   * This field is required when ANY of the listed fields are absent from input.
   *
   * @example
   * email: rules.string().requiredWithout(['phone'])
   */
  requiredWithout(fields: string[]): this {
    this._def.requiredWithout = fields;
    this._def.required = false;
    return this;
  }

  /**
   * This field is required when ALL of the listed fields are present.
   */
  requiredWithAll(fields: string[]): this {
    this._def.requiredWithAll = fields;
    this._def.required = false;
    return this;
  }

  /**
   * This field is required when ALL of the listed fields are absent.
   */
  requiredWithoutAll(fields: string[]): this {
    this._def.requiredWithoutAll = fields;
    this._def.required = false;
    return this;
  }

  /**
   * This field must be absent when another field equals the given value.
   *
   * @example
   * adminCode: rules.string().prohibitedIf('role', 'guest')
   */
  prohibitedIf(field: string, value: unknown): this {
    this._def.prohibitedIf = { field, value };
    return this;
  }

  /**
   * This field must be absent unless another field equals the given value.
   *
   * @example
   * discount: rules.number().prohibitedUnless('role', 'admin')
   */
  prohibitedUnless(field: string, value: unknown): this {
    this._def.prohibitedUnless = { field, value };
    return this;
  }

  /**
   * Stop validating this field after the first failing rule.
   * Without `bail()`, all rules are checked and all errors collected.
   *
   * @example
   * email: rules.string().email().unique('users', 'email').bail()
   */
  bail(): this {
    this._def.bail = true;
    return this;
  }
}

export class StringRule extends FieldRule {
  readonly _def: StringDef = {
    type: "string",
    required: true,
    nullable: false,
    defaultVal: undefined,
    rules: [],
  };

  min(length: number, message?: string): this {
    addRule(this._def.rules, "min", [length], message);
    return this;
  }

  max(length: number, message?: string): this {
    addRule(this._def.rules, "max", [length], message);
    return this;
  }

  email(message?: string): this {
    addRule(this._def.rules, "email", [], message);
    return this;
  }

  url(message?: string): this {
    addRule(this._def.rules, "url", [], message);
    return this;
  }

  regex(pattern: RegExp, message?: string): this {
    addRule(this._def.rules, "regex", [pattern.source, pattern.flags], message);
    return this;
  }

  uuid(message?: string): this {
    return this.regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      message ?? "Must be a valid UUID",
    );
  }

  trim(): this {
    addRule(this._def.rules, "trim", [], undefined);
    return this;
  }

  lowercase(): this {
    addRule(this._def.rules, "lowercase", [], undefined);
    return this;
  }

  uppercase(): this {
    addRule(this._def.rules, "uppercase", [], undefined);
    return this;
  }

  in(values: string[], message?: string): this {
    addRule(this._def.rules, "in", [values], message);
    return this;
  }

  confirmed(message?: string): this {
    addRule(this._def.rules, "confirmed", [], message);
    return this;
  }

  /** Value must NOT be in the given list. */
  notIn(values: string[], message?: string): this {
    addRule(this._def.rules, "notIn", [values], message);
    return this;
  }

  /** Value must equal another field in the input (e.g. password confirmation). */
  sameAs(field: string, message?: string): this {
    addRule(this._def.rules, "sameAs", [field], message);
    return this;
  }

  /** Only letters (a–z, A–Z). */
  alpha(message?: string): this {
    addRule(this._def.rules, "alpha", [], message);
    return this;
  }

  /** Letters and digits only. */
  alphaNum(message?: string): this {
    addRule(this._def.rules, "alphaNum", [], message);
    return this;
  }

  /** Letters, digits, hyphens, and underscores. */
  alphaDash(message?: string): this {
    addRule(this._def.rules, "alphaDash", [], message);
    return this;
  }

  /** String must start with the given prefix. */
  startsWith(prefix: string, message?: string): this {
    addRule(this._def.rules, "startsWith", [prefix], message);
    return this;
  }

  /** String must end with the given suffix. */
  endsWith(suffix: string, message?: string): this {
    addRule(this._def.rules, "endsWith", [suffix], message);
    return this;
  }

  /** Exact character count. */
  size(n: number, message?: string): this {
    addRule(this._def.rules, "size", [n], message);
    return this;
  }

  /**
   * Assert the value does not already exist in `table.column`.
   * Requires DatabaseProvider to be registered.
   *
   * Pass the current record's ID as the third argument to ignore it on update
   * (accepts a plain ID or a full `UniqueOptions` object for advanced cases).
   *
   * @example
   * email: rules.string().email().unique('users', 'email')
   * email: rules.string().email().unique('users', 'email', user.id)   // ignore on update
   * email: rules.string().email().unique('users', 'email', { ignoreId: user.id })
   */
  unique(
    table: string,
    column: string,
    ignoreOrOpts?: string | number | UniqueOptions,
    message?: string,
  ): this {
    const options: UniqueOptions =
      typeof ignoreOrOpts === "string" || typeof ignoreOrOpts === "number"
        ? { ignoreId: ignoreOrOpts }
        : (ignoreOrOpts ?? {});
    const entry: RuleEntry = { name: "unique", args: [table, column, options] };
    if (message !== undefined) entry.message = message;
    this._def.rules.push(entry);
    return this;
  }

  /**
   * Assert the value already exists in `table.column`.
   * Requires DatabaseProvider to be registered.
   *
   * @example
   * role: rules.string().exists('roles', 'name')
   */
  exists(table: string, column: string, message?: string): this {
    const entry: RuleEntry = { name: "exists", args: [table, column, {}] };
    if (message !== undefined) entry.message = message;
    this._def.rules.push(entry);
    return this;
  }

  /**
   * Alias for regex() — matches the given pattern.
   *
   * @example
   * rules.string().matches(/^[A-Z]{2}\d{4}$/, 'Invalid format')
   */
  matches(pattern: RegExp, message?: string): this {
    return this.regex(pattern, message);
  }

  /**
   * Mark this field as a password.
   * A semantic signal — use it as the starting point then chain your
   * specific constraints (min, max, matches, etc.).
   *
   * @example
   * password: rules.string().password().min(8).max(128)
   *   .matches(/^(?=.*[A-Z])(?=.*\d).+$/, 'Must contain uppercase and digit')
   */
  password(): this {
    return this;
  }

  /** Must be a valid IPv4 or IPv6 address. */
  ip(message?: string): this {
    addRule(this._def.rules, "ip", [], message);
    return this;
  }

  /** Must be a valid JSON string (parseable). */
  json(message?: string): this {
    addRule(this._def.rules, "json", [], message);
    return this;
  }

  /** Must consist of exactly `n` digits. */
  digits(n: number, message?: string): this {
    addRule(this._def.rules, "digits", [n], message);
    return this;
  }

  /** Digit count must be between `min` and `max` (inclusive). */
  digitsBetween(min: number, max: number, message?: string): this {
    addRule(this._def.rules, "digitsBetween", [min, max], message);
    return this;
  }

  /** Must be numeric (digits only, optional leading minus). */
  numeric(message?: string): this {
    addRule(this._def.rules, "numeric", [], message);
    return this;
  }

  /** Field must be absent from the input (the key must not be present). */
  prohibited(message?: string): this {
    addRule(this._def.rules, "prohibited", [], message);
    return this;
  }

  /** Field must be present in the input (but may be empty). */
  present(message?: string): this {
    addRule(this._def.rules, "present", [], message);
    return this;
  }
}

export class NumberRule extends FieldRule {
  readonly _def: NumberDef = {
    type: "number",
    required: true,
    nullable: false,
    defaultVal: undefined,
    rules: [],
  };

  min(value: number, message?: string): this {
    addRule(this._def.rules, "min", [value], message);
    return this;
  }

  max(value: number, message?: string): this {
    addRule(this._def.rules, "max", [value], message);
    return this;
  }

  integer(message?: string): this {
    addRule(this._def.rules, "integer", [], message);
    return this;
  }

  positive(message?: string): this {
    return this.min(0, message ?? "Must be a positive number");
  }

  /** Value must be within [min, max] inclusive. Shorthand for min()+max(). */
  between(min: number, max: number, message?: string): this {
    addRule(this._def.rules, "between", [min, max], message);
    return this;
  }

  /** Value must NOT be in the given list. */
  notIn(values: number[], message?: string): this {
    addRule(this._def.rules, "notIn", [values], message);
    return this;
  }

  /**
   * Assert the value already exists in `table.column`.
   * Requires DatabaseProvider to be registered.
   *
   * @example
   * userId: rules.number().exists('users', 'id')
   */
  exists(table: string, column: string, message?: string): this {
    const entry: RuleEntry = { name: "exists", args: [table, column, {}] };
    if (message !== undefined) entry.message = message;
    this._def.rules.push(entry);
    return this;
  }
}

export class BooleanRule extends FieldRule {
  readonly _def: BooleanDef = {
    type: "boolean",
    required: true,
    nullable: false,
    defaultVal: undefined,
    rules: [],
  };
}

export class ArrayRule<T extends FieldRule> extends FieldRule {
  readonly _def: ArrayDef;

  constructor(item: T) {
    super();
    this._def = {
      type: "array",
      required: true,
      nullable: false,
      defaultVal: undefined,
      rules: [],
      children: item._def,
    };
  }

  min(length: number, message?: string): this {
    addRule(this._def.rules, "min", [length], message);
    return this;
  }

  max(length: number, message?: string): this {
    addRule(this._def.rules, "max", [length], message);
    return this;
  }

  /** Exact item count. */
  size(n: number, message?: string): this {
    addRule(this._def.rules, "size", [n], message);
    return this;
  }
}

export class ObjectRule<S extends Schema> extends FieldRule {
  readonly _def: ObjectDef;

  constructor(shape: { [K in keyof S]: FieldRule }) {
    super();
    const shapeRecord: Record<string, FieldRuleDefinition> = {};
    for (const [k, v] of Object.entries(shape)) {
      shapeRecord[k] = (v as FieldRule)._def;
    }
    this._def = {
      type: "object",
      required: true,
      nullable: false,
      defaultVal: undefined,
      rules: [],
      shape: shapeRecord,
    };
  }
}

// ── DateRule ──────────────────────────────────────────────────────────────────

interface DateDef extends FieldRuleDefinition {
  type: "date";
}

export class DateRule extends FieldRule {
  readonly _def: DateDef;

  constructor() {
    super();
    this._def = {
      type: "date",
      required: true,
      nullable: false,
      defaultVal: undefined,
      rules: [],
    };
  }

  /** The date must be after the given date (exclusive). */
  after(date: Date | string, message?: string): this {
    const iso = date instanceof Date ? date.toISOString() : date;
    addRule(this._def.rules, "after", [iso], message);
    return this;
  }

  /** The date must be before the given date (exclusive). */
  before(date: Date | string, message?: string): this {
    const iso = date instanceof Date ? date.toISOString() : date;
    addRule(this._def.rules, "before", [iso], message);
    return this;
  }

  /** The date must be on or after the given date (inclusive). */
  afterOrEqual(date: Date | string, message?: string): this {
    const iso = date instanceof Date ? date.toISOString() : date;
    addRule(this._def.rules, "afterOrEqual", [iso], message);
    return this;
  }

  /** The date must be on or before the given date (inclusive). */
  beforeOrEqual(date: Date | string, message?: string): this {
    const iso = date instanceof Date ? date.toISOString() : date;
    addRule(this._def.rules, "beforeOrEqual", [iso], message);
    return this;
  }
}

// ── FileRule ──────────────────────────────────────────────────────────────────

interface FileDef extends FieldRuleDefinition {
  type: "file";
}

/**
 * Validates a `File` object (from multipart/form-data uploads).
 * Works with Bun's native FormData File objects.
 *
 * @example
 * avatar: rules.file().mimes(['jpg', 'png', 'webp']).max(2048)
 */
export class FileRule extends FieldRule {
  readonly _def: FileDef;

  constructor() {
    super();
    this._def = {
      type: "file",
      required: true,
      nullable: false,
      defaultVal: undefined,
      rules: [],
    };
  }

  /** Allowed MIME type extensions (without the dot). E.g. `['jpg', 'png', 'pdf']`. */
  mimes(extensions: string[], message?: string): this {
    addRule(this._def.rules, "fileMimes", [extensions], message);
    return this;
  }

  /** Maximum file size in kilobytes. */
  max(kb: number, message?: string): this {
    addRule(this._def.rules, "fileMax", [kb], message);
    return this;
  }

  /** Minimum file size in kilobytes. */
  min(kb: number, message?: string): this {
    addRule(this._def.rules, "fileMin", [kb], message);
    return this;
  }
}

// ── PasswordRule ──────────────────────────────────────────────────────────────

/**
 * Validates password strength. Chains onto StringRule.
 *
 * @example
 * password: rules.password().min(8).mixedCase().numbers().symbols()
 */
export class PasswordRule extends FieldRule {
  readonly _def: FieldRuleDefinition & { type: "string" };

  constructor() {
    super();
    this._def = {
      type: "string",
      required: true,
      nullable: false,
      defaultVal: undefined,
      rules: [],
    };
    // Default minimum length
    addRule(this._def.rules, "min", [8], undefined);
  }

  /** Minimum length (default: 8). */
  min(length: number, message?: string): this {
    // Remove existing min rule and re-add
    this._def.rules = this._def.rules.filter((r) => r.name !== "min");
    addRule(this._def.rules, "min", [length], message);
    return this;
  }

  /** Must contain at least one uppercase and one lowercase letter. */
  mixedCase(message?: string): this {
    addRule(this._def.rules, "passwordMixedCase", [], message);
    return this;
  }

  /** Must contain at least one number (0-9). */
  numbers(message?: string): this {
    addRule(this._def.rules, "passwordNumbers", [], message);
    return this;
  }

  /** Must contain at least one symbol (!@#$%^&* etc.). */
  symbols(message?: string): this {
    addRule(this._def.rules, "passwordSymbols", [], message);
    return this;
  }

  /** Must not contain spaces. */
  uncompromised(message?: string): this {
    addRule(this._def.rules, "passwordNoSpaces", [], message);
    return this;
  }

  /** Value must equal the `{field}_confirmation` input field. */
  confirmed(message?: string): this {
    addRule(this._def.rules, "confirmed", [], message);
    return this;
  }
}
