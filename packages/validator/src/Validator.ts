import type {
  Schema,
  ValidationOutcome,
  ValidationErrors,
  FieldRuleDefinition,
  CustomFn,
} from "./types.ts";
import { runDbRule } from "./dbRules.ts";
import type { UniqueOptions } from "./dbRules.ts";
import { RULES } from "./stringRules.ts";

/** Resolve whether a field is effectively required given its conditional modifiers. */
function resolveRequired(def: FieldRuleDefinition, input: Record<string, unknown>): boolean {
  if (def.requiredIf !== undefined) {
    const cond = def.requiredIf;
    if ("fn" in cond) return cond.fn(input);
    return input[cond.field] === cond.value;
  }
  if (def.requiredUnless !== undefined) {
    const cond = def.requiredUnless;
    if ("fn" in cond) return !cond.fn(input);
    return input[cond.field] !== cond.value;
  }
  return def.required;
}

export function runValidation<S extends Schema>(
  schema: S,
  input: Record<string, unknown>,
): ValidationOutcome<unknown> {
  const errors: ValidationErrors = {};
  const output: Record<string, unknown> = {};

  for (const [field, def] of Object.entries(schema)) {
    let value = input[field];

    // prohibited(): field must NOT be present at all
    const isProhibited = def.rules.some((r) => r.name === "prohibited");
    if (isProhibited && field in input) {
      const rule = def.rules.find((r) => r.name === "prohibited")!;
      errors[field] ??= rule.message ?? `The ${field} field must not be present.`;
      continue;
    }
    if (isProhibited) continue; // absent — OK

    // prohibitedIf(): prohibited when another field equals a value
    if (def.prohibitedIf !== undefined) {
      const { field: f, value: v } = def.prohibitedIf;
      if (input[f] === v && field in input) {
        errors[field] ??= `The ${field} field must not be present when ${f} is ${String(v)}.`;
        continue;
      }
      if (input[f] === v) continue; // condition met but field absent — OK
    }

    // prohibitedUnless(): prohibited unless another field equals a value
    if (def.prohibitedUnless !== undefined) {
      const { field: f, value: v } = def.prohibitedUnless;
      if (input[f] !== v && field in input) {
        errors[field] ??= `The ${field} field must not be present unless ${f} is ${String(v)}.`;
        continue;
      }
      if (input[f] !== v) continue; // condition met but field absent — OK
    }

    // present(): field must exist (key must be in input), value may be empty
    const isPresent = def.rules.some((r) => r.name === "present");
    if (isPresent && !(field in input)) {
      const rule = def.rules.find((r) => r.name === "present")!;
      errors[field] ??= rule.message ?? `The ${field} field must be present.`;
      continue;
    }

    // requiredWith(): required if ANY of the listed fields are present
    if (def.requiredWith !== undefined) {
      const anyPresent = def.requiredWith.some(
        (f) => f in input && input[f] !== undefined && input[f] !== null,
      );
      if (anyPresent && (value === undefined || value === null || value === "")) {
        errors[field] ??=
          `The ${field} field is required when ${def.requiredWith.join(", ")} is present.`;
        continue;
      }
    }

    // requiredWithout(): required if ANY of the listed fields are absent
    if (def.requiredWithout !== undefined) {
      const anyAbsent = def.requiredWithout.some(
        (f) => !(f in input) || input[f] === undefined || input[f] === null,
      );
      if (anyAbsent && (value === undefined || value === null || value === "")) {
        errors[field] ??=
          `The ${field} field is required when ${def.requiredWithout.join(", ")} is not present.`;
        continue;
      }
    }

    // requiredWithAll(): required when ALL listed fields are present
    if (def.requiredWithAll !== undefined) {
      const allPresent = def.requiredWithAll.every(
        (f) => f in input && input[f] !== undefined && input[f] !== null,
      );
      if (allPresent && (value === undefined || value === null || value === "")) {
        errors[field] ??=
          `The ${field} field is required when ${def.requiredWithAll.join(", ")} are all present.`;
        continue;
      }
    }

    // requiredWithoutAll(): required when ALL listed fields are absent
    if (def.requiredWithoutAll !== undefined) {
      const allAbsent = def.requiredWithoutAll.every(
        (f) => !(f in input) || input[f] === undefined || input[f] === null,
      );
      if (allAbsent && (value === undefined || value === null || value === "")) {
        errors[field] ??=
          `The ${field} field is required when none of ${def.requiredWithoutAll.join(", ")} are present.`;
        continue;
      }
    }

    // sometimes(): skip entirely when field is absent from input
    if (def.sometimes && !(field in input)) {
      continue;
    }

    if ((value === undefined || value === null) && def.defaultVal !== undefined) {
      value = def.defaultVal;
    }

    const isRequired = resolveRequired(def, input);

    if (isRequired && (value === undefined || value === null || value === "")) {
      errors[field] ??= def.requiredMessage ?? `The ${field} field is required.`;
      continue;
    }

    // Absent → skipped, which is what `optional()` means. An explicit `null` on
    // a field that also declared `nullable()` is *not* absence: it is someone
    // saying "clear this", and it falls through to the branch below so it
    // reaches the output. Without this, `optional().nullable()` silently drops
    // the null, `fill()` sees `undefined`, and "unassign" saves nothing while
    // reporting success.
    //
    // `null` on a field that is optional but *not* nullable keeps the old
    // behaviour — skipped rather than an error — so this widens what survives
    // validation without newly rejecting anything.
    if (!isRequired && (value === undefined || (value === null && !def.nullable))) {
      continue;
    }

    if (value === null) {
      if (!def.nullable) {
        errors[field] ??= `The ${field} field cannot be null.`;
        continue;
      }
      output[field] = null;
      continue;
    }

    const result = validateField(field, value, def, input);
    if (result.error !== undefined) {
      // bail() is per-field: validateField already stopped at this field's first
      // failing rule — the remaining fields are still validated as usual.
      errors[field] = result.error;
    } else {
      output[field] = result.value;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, data: undefined, errors };
  }

  return { success: true, data: output, errors: undefined };
}

function validateField(
  field: string,
  value: unknown,
  def: FieldRuleDefinition,
  input: Record<string, unknown>,
): { value: unknown; error?: undefined } | { error: string; value?: undefined } {
  let coerced = value;

  switch (def.type) {
    case "string":
      if (typeof coerced !== "string") {
        coerced = String(coerced);
      }
      break;

    case "number":
      if (typeof coerced === "string" && coerced.trim() !== "") {
        const n = Number(coerced);
        if (!isNaN(n)) coerced = n;
      }
      if (typeof coerced !== "number") {
        return { error: `The ${field} field must be a number.` };
      }
      break;

    case "boolean":
      if (typeof coerced === "string") {
        const s = coerced.toLowerCase();
        if (["true", "1", "on", "yes"].includes(s)) coerced = true;
        else if (["false", "0", "off", "no"].includes(s)) coerced = false;
      } else if (typeof coerced === "number") {
        coerced = coerced !== 0;
      }
      if (typeof coerced !== "boolean") {
        return { error: `The ${field} field must be a boolean.` };
      }
      break;

    case "array":
      if (!Array.isArray(coerced)) {
        return { error: `The ${field} field must be an array.` };
      }
      break;

    case "object":
      if (typeof coerced !== "object" || Array.isArray(coerced) || coerced === null) {
        return { error: `The ${field} field must be an object.` };
      }
      break;

    case "date": {
      if (coerced instanceof Date) break;
      const d = new Date(coerced as string);
      if (isNaN(d.getTime())) {
        return { error: `The ${field} field must be a valid date.` };
      }
      coerced = d;
      break;
    }

    case "file": {
      const isFile =
        coerced !== null &&
        typeof coerced === "object" &&
        "name" in (coerced as object) &&
        "size" in (coerced as object);
      if (!isFile) {
        return { error: `The ${field} field must be a file.` };
      }
      break;
    }
  }

  const ruleErrors: string[] = [];
  for (const ruleEntry of def.rules) {
    const err = applyRule(field, coerced, ruleEntry, input);
    if (err !== undefined) {
      ruleErrors.push(err);
      // bail(): skip this field's remaining rules after the first failure.
      // Without bail(), every rule runs and all messages are collected.
      if (def.bail === true) break;
      continue;
    }
    if (ruleEntry.name === "trim" && typeof coerced === "string") {
      coerced = coerced.trim();
    }
    if (ruleEntry.name === "lowercase" && typeof coerced === "string") {
      coerced = coerced.toLowerCase();
    }
    if (ruleEntry.name === "uppercase" && typeof coerced === "string") {
      coerced = coerced.toUpperCase();
    }
  }
  if (ruleErrors.length > 0) {
    return { error: ruleErrors.join(" ") };
  }

  if (def.type === "object" && def.shape !== undefined) {
    const nested = runValidation(def.shape, coerced as Record<string, unknown>);
    if (!nested.success) {
      const entry = Object.entries(nested.errors)[0];
      if (entry !== undefined) {
        const [nestedField, nestedError] = entry;
        return { error: `${field}.${nestedField}: ${nestedError}` };
      }
    } else {
      coerced = nested.data;
    }
  }

  if (def.type === "array" && def.children !== undefined && Array.isArray(coerced)) {
    const children = def.children;
    const validated: unknown[] = [];
    for (let i = 0; i < coerced.length; i++) {
      const item = coerced[i];
      const itemResult = validateField(`${field}[${i}]`, item, children, {});
      if (itemResult.error !== undefined) return { error: itemResult.error };
      validated.push(itemResult.value);
    }
    coerced = validated;
  }

  return { value: coerced };
}

type RuleEntry = { name: string; args: unknown[]; message?: string; fn?: CustomFn };

/**
 * Like runValidation() but also executes async rules (unique, exists, custom fn).
 * Use this in validate() and FormRequest.validate() instead of runValidation()
 * whenever the schema may contain DB-aware or custom async rules.
 */
export async function runValidationAsync<S extends Schema>(
  schema: S,
  input: Record<string, unknown>,
): Promise<ValidationOutcome<unknown>> {
  // 1. Run all synchronous checks first
  const syncResult = runValidation(schema, input);

  // 2. Collect async rules for fields that passed sync validation
  const asyncErrors: ValidationErrors = {};

  await Promise.all(
    Object.entries(schema).map(async ([field, def]) => {
      // Skip fields that already failed sync validation
      if (syncResult.success === false && syncResult.errors[field] !== undefined) return;

      const fieldValue = syncResult.success
        ? (syncResult.data as Record<string, unknown>)[field]
        : input[field];

      // Skip absent optional fields
      if (fieldValue === undefined) return;

      for (const rule of def.rules) {
        if (rule.name === "unique" || rule.name === "exists") {
          const [table, column, options] = rule.args as [string, string, UniqueOptions];
          const err = await runDbRule(
            rule.name,
            table,
            column,
            fieldValue,
            options,
            rule.message,
            field,
          );
          if (err !== undefined) {
            asyncErrors[field] = err;
            break;
          }
          continue;
        }

        if (rule.name === "custom" && rule.fn !== undefined) {
          const result = await rule.fn(fieldValue, input);
          if (result === false) {
            asyncErrors[field] = rule.message ?? `The ${field} field is invalid.`;
            break;
          }
          if (typeof result === "string") {
            asyncErrors[field] = result;
            break;
          }
        }
      }
    }),
  );

  if (Object.keys(asyncErrors).length > 0) {
    const mergedErrors: ValidationErrors = {
      ...(syncResult.success ? {} : syncResult.errors),
      ...asyncErrors,
    };
    return { success: false, data: undefined, errors: mergedErrors };
  }

  return syncResult;
}

/**
 * Fluent-builder rule names mapped to their key in the shared {@link RULES} registry.
 * Rules whose name is identical in both engines (min, max, email, …) need no entry.
 */
const _registryKeys: Record<string, string> = {
  notIn: "not_in",
  sameAs: "same",
  alphaNum: "alpha_num",
  alphaDash: "alpha_dash",
  startsWith: "starts_with",
  endsWith: "ends_with",
  digitsBetween: "digits_between",
  passwordMixedCase: "password_mixed_case",
  passwordNumbers: "password_numbers",
  passwordSymbols: "password_symbols",
  passwordNoSpaces: "password_no_spaces",
};

/** Serialise a builder rule's args into the string `param` the RULES registry expects. */
function _registryParam(name: string, args: unknown[]): string {
  if (name === "regex") {
    const [source, flags] = args as [string, string | undefined];
    return `/${source}/${flags ?? ""}`;
  }
  const first = args[0];
  if (Array.isArray(first)) return first.map(String).join(",");
  return args.map(String).join(",");
}

function applyRule(
  field: string,
  value: unknown,
  rule: RuleEntry,
  input: Record<string, unknown>,
): string | undefined {
  const msg = (fallback: string): string => rule.message ?? fallback;

  // Single engine: delegate to the shared stringRules registry for every rule it
  // covers, so the fluent schema API and the "a|b|c" string syntax validate
  // identically (one email regex, one min/max implementation, …).
  const registryRule = RULES[_registryKeys[rule.name] ?? rule.name];
  if (registryRule !== undefined) {
    const failure = registryRule(value, _registryParam(rule.name, rule.args), input);
    if (failure === null) return undefined;
    return msg(failure.replaceAll(":attr", `The ${field} field`));
  }

  // Only rules that genuinely cannot live in the registry remain here:
  // cross-field lookups needing the field name, typed Date/File values,
  // async/DB rules, string transforms, and presence rules handled upstream.
  switch (rule.name) {
    case "confirmed": {
      const confirmation = input[`${field}_confirmation`];
      if (value !== confirmation) {
        return msg(`The ${field} field confirmation does not match.`);
      }
      break;
    }

    case "prohibited":
    case "present":
      // Handled in the main runValidation loop before validateField is called.
      break;

    // ── File rules ────────────────────────────────────────────────────────
    case "fileMimes": {
      const exts = rule.args[0] as string[];
      const file = value as { name: string; type?: string };
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = file.type ?? "";
      const allowed = exts.map((e) => e.toLowerCase());
      if (!allowed.includes(ext) && !allowed.some((e) => mimeType.includes(e))) {
        return msg(`The ${field} field must be a file of type: ${exts.join(", ")}.`);
      }
      break;
    }

    case "fileMax": {
      const maxKb = rule.args[0] as number;
      const file = value as { size: number };
      if (file.size > maxKb * 1024) {
        return msg(`The ${field} field must not be larger than ${maxKb} KB.`);
      }
      break;
    }

    case "fileMin": {
      const minKb = rule.args[0] as number;
      const file = value as { size: number };
      if (file.size < minKb * 1024) {
        return msg(`The ${field} field must be at least ${minKb} KB.`);
      }
      break;
    }

    // ── Date rules (operate on coerced Date instances) ────────────────────
    case "after": {
      const ref = new Date(rule.args[0] as string);
      const val = value instanceof Date ? value : new Date(value as string);
      if (val <= ref) {
        return msg(`The ${field} field must be a date after ${rule.args[0]}.`);
      }
      break;
    }

    case "before": {
      const ref = new Date(rule.args[0] as string);
      const val = value instanceof Date ? value : new Date(value as string);
      if (val >= ref) {
        return msg(`The ${field} field must be a date before ${rule.args[0]}.`);
      }
      break;
    }

    case "afterOrEqual": {
      const ref = new Date(rule.args[0] as string);
      const val = value instanceof Date ? value : new Date(value as string);
      if (val < ref) {
        return msg(`The ${field} field must be a date on or after ${rule.args[0]}.`);
      }
      break;
    }

    case "beforeOrEqual": {
      const ref = new Date(rule.args[0] as string);
      const val = value instanceof Date ? value : new Date(value as string);
      if (val > ref) {
        return msg(`The ${field} field must be a date on or before ${rule.args[0]}.`);
      }
      break;
    }

    case "custom":
    case "unique":
    case "exists":
      // Async rules — executed in runValidationAsync, no-op in the sync pass.
      break;

    case "trim":
    case "lowercase":
    case "uppercase":
      // Transformations — applied in validateField after the rule loop.
      break;

    default:
      throw new Error(
        `Unknown validation rule "${rule.name}" on field "${field}". ` +
          `Add it to the stringRules RULES registry or handle it in applyRule().`,
      );
  }

  return undefined;
}
