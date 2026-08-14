/**
 * `@zerotal/validator` schema → JSON Schema, for structured output and tool inputs.
 *
 * The supported JSON Schema subset is narrow — narrower than most people expect,
 * and the API rejects anything outside it at *request* time, which is the worst
 * possible place to find out. So this module makes one decision and holds it:
 *
 * > **Strip what the API cannot express, then re-check it client-side.**
 *
 * `min(2)`, `max(140)`, `regex(...)` and friends are dropped from the emitted
 * schema and re-applied by {@link recheckAgainstSchema} once the model answers.
 * We already own a validator; running it over the parsed object costs nothing and
 * keeps the constraint honest instead of decorative. The alternative — refusing
 * the schema at definition time — would make `rule.string().min(2)` unusable for
 * structured output, which is a worse deal for a constraint we can enforce
 * ourselves.
 *
 * The exception is anything with no client-side rescue: a **recursive** schema
 * cannot be expressed at all, and a **file** field has no JSON representation.
 * Those throw here, at definition time, where the stack trace points at the
 * schema rather than at a 400 from the provider.
 */
import type { FieldRule, FieldRuleDefinition, Schema } from "@zerotal/validator";
import { runValidation } from "@zerotal/validator";
import { AiSchemaError } from "./errors.ts";
import type { JsonSchema } from "./types.ts";

/** Either shape callers have on hand: the builder map, or the raw definitions. */
export type SchemaInput = Record<string, FieldRule | FieldRuleDefinition>;

/**
 * Rule names that map onto a supported JSON Schema keyword. Everything else is
 * stripped and re-checked. Kept as a map rather than a switch so the supported
 * set is one readable list.
 */
const FORMAT_RULES: Record<string, string> = {
  email: "email",
  url: "uri",
  ip: "ipv4",
};

/** Unwrap a builder rule to its definition. */
function defOf(value: FieldRule | FieldRuleDefinition): FieldRuleDefinition {
  return "_def" in value ? value._def : value;
}

/** Normalise either input shape to raw definitions. */
export function toSchema(input: SchemaInput): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(input)) out[key] = defOf(value);
  return out;
}

/**
 * Translate a validator schema into the JSON Schema the providers accept.
 *
 * Every object gets `additionalProperties: false` — required, not optional, and
 * the single most common reason a hand-written schema is rejected.
 *
 * Optional and nullable fields are emitted the same way: listed in `required`,
 * with the value type widened to `anyOf: [<type>, {type: "null"}]`. That is the
 * form both Anthropic and OpenAI's strict mode accept, and
 * {@link recheckAgainstSchema} drops a `null` that stood in for "absent" before
 * re-validating, so the round trip preserves the original meaning.
 *
 * @throws {AiSchemaError} for a recursive schema or a `file` field.
 *
 * @example
 * translateSchema({
 *   title:  rule.string().min(3),          // min stripped, re-checked after
 *   tags:   rule.array(rule.string()),
 *   author: rule.string().optional(),      // → anyOf [string, null]
 * });
 */
export function translateSchema(input: SchemaInput): JsonSchema {
  const schema = toSchema(input);
  return objectSchema(schema, new Set());
}

/** Build the `{type: "object", ...}` node for a map of field definitions. */
function objectSchema(schema: Schema, path: Set<FieldRuleDefinition>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [name, def] of Object.entries(schema)) {
    properties[name] = fieldSchema(def, name, path);
    // Every property is listed. Optionality lives in the null branch of anyOf,
    // because a subset `required` is rejected by strict tool use.
    required.push(name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/** Translate one field, widening to `anyOf` when it may be absent or null. */
function fieldSchema(
  def: FieldRuleDefinition,
  name: string,
  path: Set<FieldRuleDefinition>,
): JsonSchema {
  if (path.has(def)) {
    throw new AiSchemaError(
      `The schema for '${name}' is recursive. Structured output does not support recursive ` +
        `schemas — flatten the shape, or bound the depth by declaring each level explicitly.`,
      { field: name },
    );
  }

  const next = new Set(path).add(def);
  const base = baseSchema(def, name, next);

  const mayBeNull = def.nullable || !def.required || def.sometimes === true;
  if (!mayBeNull) return base;

  return { anyOf: [base, { type: "null" }] };
}

/** The un-widened schema for a field's declared type. */
function baseSchema(
  def: FieldRuleDefinition,
  name: string,
  path: Set<FieldRuleDefinition>,
): JsonSchema {
  switch (def.type) {
    case "string":
      return withStringKeywords({ type: "string" }, def);

    case "number":
      return { type: def.rules.some((r) => r.name === "integer") ? "integer" : "number" };

    case "boolean":
      return { type: "boolean" };

    case "date":
      // No native date type in JSON Schema; `date-time` is in the supported
      // format list, and the model returns an ISO-8601 string.
      return { type: "string", format: "date-time" };

    case "array": {
      if (!def.children) {
        throw new AiSchemaError(
          `The array field '${name}' has no item type. Declare one: rule.array(rule.string()).`,
          { field: name },
        );
      }
      return { type: "array", items: fieldSchema(def.children, `${name}[]`, path) };
    }

    case "object": {
      if (!def.shape) {
        throw new AiSchemaError(
          `The object field '${name}' has no shape. Declare one: rule.object({ … }).`,
          { field: name },
        );
      }
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(def.shape)) {
        properties[key] = fieldSchema(child, `${name}.${key}`, path);
        required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }

    case "file":
      throw new AiSchemaError(
        `The field '${name}' is a file. A model cannot return a file through structured output — ` +
          `ask for a filename or an identifier instead.`,
        { field: name },
      );

    default:
      throw new AiSchemaError(
        `The field '${name}' has an unsupported type '${String(def.type)}'.`,
        {
          field: name,
          type: def.type,
        },
      );
  }
}

/** Apply the string rules that survive translation: `enum` and `format`. */
function withStringKeywords(base: JsonSchema, def: FieldRuleDefinition): JsonSchema {
  const out: JsonSchema = { ...base };

  for (const rule of def.rules) {
    if (rule.name === "in" && Array.isArray(rule.args[0])) {
      // `enum` narrows harder than any format, so it wins outright.
      return { enum: (rule.args[0] as string[]).slice() };
    }
    const format = FORMAT_RULES[rule.name];
    if (format) out.format = format;
  }

  return out;
}

/**
 * Which of a schema's constraints this translation could not express.
 *
 * Useful in a test or a boot-time audit: it names exactly what
 * {@link recheckAgainstSchema} will be carrying, so a schema whose important
 * constraint is invisible to the model is a thing you can notice rather than
 * discover.
 *
 * @example
 * strippedConstraints({ title: rule.string().min(3).max(80) });
 * // → ["title: min", "title: max"]
 */
export function strippedConstraints(input: SchemaInput): string[] {
  const out: string[] = [];
  walk(toSchema(input), "", out, new Set());
  return out;
}

function walk(schema: Schema, prefix: string, out: string[], path: Set<FieldRuleDefinition>): void {
  for (const [name, def] of Object.entries(schema)) {
    if (path.has(def)) continue;
    const next = new Set(path).add(def);
    const label = prefix ? `${prefix}.${name}` : name;

    for (const rule of def.rules) {
      if (rule.name === "in" || FORMAT_RULES[rule.name] || rule.name === "integer") continue;
      out.push(`${label}: ${rule.name}`);
    }

    if (def.shape) walk(def.shape, label, out, next);
    if (def.children) walk({ [`${name}[]`]: def.children }, prefix, out, next);
  }
}

/**
 * Re-apply the constraints translation had to drop.
 *
 * Called on the model's parsed answer. A `null` standing in for an absent
 * optional field is removed first — the wire form widened it to null, and the
 * validator would otherwise reject a value the caller never asked for.
 *
 * @returns The validated object.
 * @throws {AiSchemaError} listing every field that failed.
 *
 * @internal
 */
export function recheckAgainstSchema<T>(input: SchemaInput, value: unknown): T {
  const schema = toSchema(input);

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AiSchemaError(
      `The model returned ${Array.isArray(value) ? "an array" : typeof value}, not an object.`,
      { received: value },
    );
  }

  const cleaned = dropAbsentNulls(schema, value as Record<string, unknown>);
  const result = runValidation(schema, cleaned);

  if (!result.success) {
    const detail = Object.entries(result.errors)
      .map(([field, message]) => `${field}: ${message}`)
      .join("; ");
    throw new AiSchemaError(
      `The model's answer does not satisfy the schema — ${detail}. These constraints are enforced ` +
        `here rather than by the provider, because structured output cannot express them.`,
      { errors: result.errors },
    );
  }

  return result.data as T;
}

/** Remove `null`s that stood in for "absent" on optional, non-nullable fields. */
function dropAbsentNulls(schema: Schema, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };

  for (const [name, def] of Object.entries(schema)) {
    if (out[name] === null && !def.nullable) {
      delete out[name];
      continue;
    }
    if (def.shape && out[name] && typeof out[name] === "object") {
      out[name] = dropAbsentNulls(def.shape, out[name] as Record<string, unknown>);
    }
  }

  return out;
}
