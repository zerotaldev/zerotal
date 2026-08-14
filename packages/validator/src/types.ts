export type CustomFn = (
  value: unknown,
  input: Record<string, unknown>,
) => boolean | string | Promise<boolean | string>;

export interface FieldRuleDefinition {
  type: "string" | "number" | "boolean" | "array" | "object" | "date" | "file";
  required: boolean;
  /** Custom message for the basic "is required" failure (set via `.required(message)`). */
  requiredMessage?: string;
  nullable: boolean;
  defaultVal: unknown;
  /** Skip this field entirely when it is absent from input (no presence in output either). */
  sometimes?: boolean;
  /** Make this field required only when `field === value` in the current input. */
  requiredIf?:
    { field: string; value: unknown } | { fn: (input: Record<string, unknown>) => boolean };
  /** Make this field required unless `field === value` in the current input. */
  requiredUnless?:
    { field: string; value: unknown } | { fn: (input: Record<string, unknown>) => boolean };
  /** Required when ANY of the listed fields are present in input. */
  requiredWith?: string[];
  /** Required when ANY of the listed fields are absent from input. */
  requiredWithout?: string[];
  /** Required when ALL of the listed fields are present. */
  requiredWithAll?: string[];
  /** Required when ALL of the listed fields are absent. */
  requiredWithoutAll?: string[];
  /** Field must be absent when `field === value`. */
  prohibitedIf?: { field: string; value: unknown };
  /** Field must be absent unless `field === value`. */
  prohibitedUnless?: { field: string; value: unknown };
  /** Stop validation on the first failing rule for this field. */
  bail?: boolean;
  rules: Array<{ name: string; args: unknown[]; message?: string; fn?: CustomFn }>;
  children?: FieldRuleDefinition;
  shape?: Record<string, FieldRuleDefinition>;
}

export type Schema = Record<string, FieldRuleDefinition>;

export type InferFieldType<F extends FieldRuleDefinition> = F["type"] extends "string"
  ? string
  : F["type"] extends "number"
    ? number
    : F["type"] extends "boolean"
      ? boolean
      : F["type"] extends "date"
        ? Date
        : F["type"] extends "array"
          ? InferArrayType<F>
          : F["type"] extends "object"
            ? InferObjectType<F>
            : unknown;

/**
 * `array` and `object` carry their contents on `children` / `shape`, so unlike the
 * scalar rules their inferred type is not decided by `type` alone. `ArrayRule` and
 * `ObjectRule` thread the item/shape definitions through those two fields (see
 * `ArrayDef` / `ObjectDef`), which is what these two read back out.
 *
 * Both degrade rather than fail: a definition widened to bare `FieldRuleDefinition`
 * has an optional `children`/`shape` that infers nothing, and falls back to the
 * loosest honest type instead of `never`.
 */
type InferArrayType<F extends FieldRuleDefinition> = F extends {
  children: infer C extends FieldRuleDefinition;
}
  ? InferField<C>[]
  : unknown[];

type InferObjectType<F extends FieldRuleDefinition> = F extends {
  shape: infer Sh extends Record<string, FieldRuleDefinition>;
}
  ? { [K in keyof Sh]: InferField<Sh[K]> }
  : Record<string, unknown>;

/** One field's type, including its `nullable` widening. Shared by `Infer` and the nested inferers. */
type InferField<F extends FieldRuleDefinition> = F["nullable"] extends true
  ? InferFieldType<F> | null
  : InferFieldType<F>;

/**
 * Infer the validated TypeScript type from a Schema.
 * All fields are treated as required at the type level — the required/optional
 * distinction is enforced at runtime only. Trade-off acknowledged in the plan.
 */
export type Infer<S extends Schema> = {
  [K in keyof S]: InferField<S[K]>;
};

export type ValidationErrors = Record<string, string>;

export interface ValidationResult<T> {
  success: true;
  data: T;
  errors: undefined;
}

export interface ValidationFailure {
  success: false;
  data: undefined;
  errors: ValidationErrors;
}

export type ValidationOutcome<T> = ValidationResult<T> | ValidationFailure;
