/**
 * What `make:resource` reads from a model: the fields its form edits, each with the kind of
 * input it needs. Read from the model's source, as every `make:*` generator reads it, because a
 * generator runs with no app booted.
 */
import { _readModel, type _ModelColumn } from "@zerotal/core/commands";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The input a field gets, from its `@column` type and its TypeScript type. */
export type _FieldKind = "string" | "text" | "number" | "boolean" | "date" | "datetime" | "enum";

/**
 * One field the generated form edits.
 *
 * @internal
 */
export interface _ResourceField {
  /** The model property, e.g. `dueOn`. */
  property: string;
  /** The database column, e.g. `due_on`. */
  column: string;
  kind: _FieldKind;
  nullable: boolean;
  /** `Due on`: the label the form and the list show. */
  label: string;
  /** For an enum, its values in declaration order. */
  options?: readonly string[] | undefined;
  /**
   * For an enum whose values the model exports as a constant array (`PROJECT_STATUSES`), that
   * constant's name: the request validates against it, so the two cannot drift apart.
   */
  optionsConst?: string | undefined;
  /** The `default` its `@column` declares, which a new record's form starts from. */
  defaultValue?: string | boolean | undefined;
}

/**
 * What the generator knows about the model.
 *
 * @internal
 */
export interface _ResourceModel {
  name: string;
  /** The model's file without extension, relative to the app root (`app/models/Task`). */
  file: string;
  /** Its table, from `@table("…")`. */
  table: string;
  fields: _ResourceField[];
  /** The column naming the owning user, when it has one. */
  owner: _ModelColumn | undefined;
}

/** Properties a form never edits: the key and the timestamps the model keeps itself. */
const MANAGED = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

/** `dueOn` → `Due on`. */
export function _label(property: string): string {
  const words = property
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The literal values of a union such as `"low" | "high"`, or undefined when it is not one. */
function literals(type: string): string[] | undefined {
  const parts = type.split("|").map((part) => part.trim());
  const values: string[] = [];
  for (const part of parts) {
    const m = /^(["'])([^"'\\]*)\1$/.exec(part);
    if (!m) return undefined;
    values.push(m[2]!);
  }
  return values.length > 0 ? values : undefined;
}

/**
 * An enum's values, when the property's type is a union of string literals: written inline, or
 * an alias in the model's file for one (`type Status = "a" | "b"`), or an alias over a constant
 * array (`type Status = (typeof STATUSES)[number]`, `const STATUSES = [...] as const`).
 */
function enumOf(
  type: string,
  source: string,
): { options: string[]; optionsConst?: string | undefined } | undefined {
  const inline = literals(type);
  if (inline) return { options: inline };
  if (!/^[A-Za-z_$][\w$]*$/.test(type)) return undefined;
  const alias = new RegExp(`type\\s+${type}\\s*=\\s*([^;]+);`).exec(source)?.[1]?.trim();
  if (!alias) return undefined;
  const aliased = literals(alias.replace(/\s+/g, " "));
  if (aliased) return { options: aliased };
  const constName = /^\(?\s*typeof\s+([A-Za-z_$][\w$]*)\s*\)?\s*\[\s*number\s*\]$/.exec(alias)?.[1];
  if (!constName) return undefined;
  const declared = new RegExp(
    `(export\\s+)?const\\s+${constName}\\s*=\\s*\\[([^\\]]*)\\]\\s*as\\s+const`,
  ).exec(source);
  if (!declared) return undefined;
  const values = [...declared[2]!.matchAll(/(["'])([^"'\\]*)\1/g)].map((m) => m[2]!);
  if (values.length === 0) return undefined;
  return { options: values, ...(declared[1] ? { optionsConst: constName } : {}) };
}

/** The `@column(…)` arguments for each property, which say `text` from `string` and `date` from `datetime`. */
function columnArgs(source: string): Map<string, string> {
  const args = new Map<string, string>();
  const line = /@column\s*\(([^)]*)\)\s*(?:declare\s+)?(?:public\s+)?(\w+)\s*[!?]?\s*:/g;
  for (const m of source.matchAll(line)) args.set(m[2]!, m[1] ?? "");
  return args;
}

function kindOf(column: _ModelColumn, args: string, source: string): _ResourceField | undefined {
  const base = {
    property: column.property,
    column: column.column,
    nullable: column.nullable,
    label: _label(column.property),
  };
  const type = column.type.trim();
  if (type === "string") {
    return { ...base, kind: /["']text["']/.test(args) ? "text" : "string" };
  }
  if (type === "number") return { ...base, kind: "number" };
  if (type === "boolean") {
    const declared = /default\s*:\s*(true|false)\b/.exec(args)?.[1];
    return { ...base, kind: "boolean", ...(declared ? { defaultValue: declared === "true" } : {}) };
  }
  if (type === "Date") {
    // `@column("date")` and `cast: "date"` hold a day; anything else (`datetime`) a moment.
    const day = /^\s*["']date["']\s*$/.test(args) || /cast\s*:\s*["']date["']/.test(args);
    return { ...base, kind: day ? "date" : "datetime" };
  }
  const values = enumOf(type, source);
  if (values) {
    const declared = /default\s*:\s*(["'])([^"'\\]*)\1/.exec(args)?.[2];
    const known = declared !== undefined && values.options.includes(declared);
    return { ...base, kind: "enum", ...values, ...(known ? { defaultValue: declared } : {}) };
  }
  return undefined;
}

/**
 * The model's form fields: its mass-assignable columns in declaration order, without the owner
 * (set from the signed-in user, never from a form) and without columns no input can edit (JSON,
 * a custom class). Undefined when no file in `app/models/` exports the class.
 *
 * @internal
 */
export function _readResourceModel(
  name: string,
  cwd: string = process.cwd(),
): { model: _ResourceModel; skipped: string[] } | undefined {
  const shape = _readModel(name, cwd);
  if (!shape) return undefined;
  let source = "";
  try {
    source = readFileSync(join(cwd, `${shape.file}.ts`), "utf8");
  } catch {
    source = "";
  }
  const args = columnArgs(source);
  const fields: _ResourceField[] = [];
  const skipped: string[] = [];
  for (const property of shape.fillable) {
    const column = shape.columns.find((c) => c.property === property);
    if (!column || column === shape.owner || MANAGED.has(property)) continue;
    const field = kindOf(column, args.get(property) ?? "", source);
    if (field) fields.push(field);
    else skipped.push(`${property}: ${column.type}`);
  }
  const table =
    /@table\s*\(\s*["']([^"']+)["']/.exec(source)?.[1] ??
    `${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}s`;
  return {
    model: { name, file: shape.file, table, fields, owner: shape.owner },
    skipped,
  };
}

/**
 * The field the list links and the flash messages name: the first required one-line string,
 * else the first string of any kind.
 *
 * @internal
 */
export function _primaryField(fields: readonly _ResourceField[]): _ResourceField | undefined {
  return (
    fields.find((f) => f.kind === "string" && !f.nullable) ??
    fields.find((f) => f.kind === "string" || f.kind === "text")
  );
}
