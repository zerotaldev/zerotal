/**
 * `Def<T>` — the typed field definition produced by the `t` env builder, plus
 * the field-specification and error types that back environment validation.
 */

// ── Required sentinel ─────────────────────────────────────────────────────────
// Used as the third argument to .when() so the API reads naturally:
//   STRIPE_KEY: t.string().when('NODE_ENV', 'production', t.required())

const _REQUIRED = Symbol.for("@zerotal/env:required");

/** The type of the {@link REQUIRED_MARKER} sentinel passed to `.when()`. */
export type RequiredMarker = typeof _REQUIRED;

/** Sentinel marking a field as required under a `.when()` condition. */
export const REQUIRED_MARKER: RequiredMarker = _REQUIRED;

// ── Internal field specification ──────────────────────────────────────────────

/** The set of value kinds a field can declare. */
export type FieldType = "string" | "number" | "boolean" | "enum" | "url" | "port";

/** @internal A single conditional-requirement rule attached by `.when()`. */
export interface ConditionSpec {
  field: string;
  value: string;
  thenRequired: boolean;
}

/** @internal The fully resolved specification a `Def<T>` carries into validation. */
export interface FieldSpec {
  type: FieldType;
  required: boolean;
  defaultValue: unknown; // Already typed — skip re-parsing in parse().
  enumValues?: readonly string[];
  conditions: ConditionSpec[];
}

// ── Validation error ──────────────────────────────────────────────────────────

/** A single field-level validation failure. Collected before the final throw. */
export class EnvFieldError {
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}

  format(): string {
    return `  ✗  ${this.key.padEnd(20)} ${this.message}`;
  }
}

// ── Def<T> ────────────────────────────────────────────────────────────────────

/**
 * A typed field definition produced by the `t` builder.
 * Carry it directly in `EnvSchema.define()` — the generic `T` is inferred automatically.
 *
 * @example
 * ```ts
 * PORT:     t.number().default(3000)      // Def<number>
 * DB_HOST:  t.string().required()         // Def<string>
 * NODE_ENV: t.enum([...]).required()      // Def<'development'|'production'|'testing'>
 * API_KEY:  t.string().when('NODE_ENV', 'production', t.required())  // Def<string|undefined>
 * ```
 */
export class Def<T> {
  /** @internal — phantom property for TypeScript inference only, never set at runtime */
  declare readonly _output: T;

  /** @internal */
  readonly _spec: FieldSpec;

  constructor(spec: FieldSpec) {
    this._spec = spec;
  }

  // ── Modifiers ────────────────────────────────────────────────────────────────

  /**
   * Mark the field as required.
   * The output type becomes `NonNullable<T>` — `undefined` is removed.
   *
   * @example
   * ```ts
   * DB_HOST: t.string().required()  // string (throws at boot if missing)
   * ```
   */
  required(): Def<NonNullable<T>> {
    return new Def<NonNullable<T>>({ ...this._spec, required: true });
  }

  /**
   * Provide a fallback value when the env variable is absent.
   * The output type becomes `NonNullable<T>` — `undefined` is removed.
   *
   * @example
   * ```ts
   * PORT:  t.number().default(3000)         // number — always present
   * DEBUG: t.boolean().default(false)       // boolean
   * ```
   */
  default(value: NonNullable<T>): Def<NonNullable<T>> {
    return new Def<NonNullable<T>>({
      ...this._spec,
      required: true,
      defaultValue: value,
    });
  }

  /**
   * Make the field conditionally required.
   * When `conditionField === conditionValue` at runtime, the field is validated
   * as required. Otherwise it remains optional.
   *
   * The TypeScript type stays `T` (potentially `undefined`) because the condition
   * is evaluated at runtime — access the value with a null-check or after calling
   * EnvSchema.define() in the appropriate environment.
   *
   * Pass `t.required()` as the third argument (or omit — required is the default action).
   *
   * @example
   * ```ts
   * STRIPE_SECRET: t.string().when('NODE_ENV', 'production', t.required())
   * ```
   */
  when(
    conditionField: string,
    conditionValue: string,
    rule?: RequiredMarker | Def<unknown>,
  ): Def<T> {
    const thenRequired =
      rule === undefined ||
      rule === REQUIRED_MARKER ||
      (rule instanceof Def && rule._spec.required);

    return new Def<T>({
      ...this._spec,
      conditions: [
        ...this._spec.conditions,
        { field: conditionField, value: conditionValue, thenRequired },
      ],
    });
  }

  // ── Internal parse ────────────────────────────────────────────────────────────

  /**
   * @internal
   * Parse and validate a raw env string, respecting conditions.
   * Throws `EnvFieldError` on failure (collected by EnvSchema before the final throw).
   */
  _parse(key: string, raw: string | undefined, allEnv: Record<string, string | undefined>): T {
    // Evaluate conditional requirements
    for (const condition of this._spec.conditions) {
      if (allEnv[condition.field] === condition.value && condition.thenRequired) {
        if (raw === undefined || raw === "") {
          throw new EnvFieldError(
            key,
            `required when ${condition.field}="${condition.value}" but is missing`,
          );
        }
      }
    }

    // Apply default
    if (raw === undefined || raw === "") {
      if (this._spec.defaultValue !== undefined) {
        return this._spec.defaultValue as T;
      }
      if (this._spec.required) {
        throw new EnvFieldError(key, "is required but missing or empty");
      }
      return undefined as T;
    }

    // Type coercion & validation
    switch (this._spec.type) {
      case "string":
        return raw as T;

      case "url": {
        try {
          new URL(raw);
        } catch {
          throw new EnvFieldError(key, `must be a valid URL — got: "${raw}"`);
        }
        return raw as T;
      }

      case "number":
      case "port": {
        const parsed = Number(raw);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
          throw new EnvFieldError(key, `must be a number — got: "${raw}"`);
        }
        if (
          this._spec.type === "port" &&
          (parsed < 1 || parsed > 65535 || !Number.isInteger(parsed))
        ) {
          throw new EnvFieldError(key, `must be a valid port number (1–65535) — got: ${parsed}`);
        }
        return parsed as T;
      }

      case "boolean": {
        const normalized = raw.toLowerCase();
        if (normalized === "true" || normalized === "1" || normalized === "yes") return true as T;
        if (normalized === "false" || normalized === "0" || normalized === "no") return false as T;
        throw new EnvFieldError(key, `must be a boolean (true/false/1/0/yes/no) — got: "${raw}"`);
      }

      case "enum": {
        const values = this._spec.enumValues!;
        if (!values.includes(raw)) {
          throw new EnvFieldError(key, `must be one of [${values.join(", ")}] — got: "${raw}"`);
        }
        return raw as T;
      }
    }
  }
}

// ── Infer the output type of a schema map ─────────────────────────────────────

/** Infer the concrete type of a single `Def<T>`. */
export type InferDef<D> = D extends Def<infer T> ? T : never;

/** Infer the full output object type from an `EnvSchema.define()` schema map. */
export type EnvOutput<S extends Record<string, Def<unknown>>> = {
  readonly [K in keyof S]: InferDef<S[K]>;
};
