import path from "node:path";
import type { ColumnOptions } from "../model/decorators/column.ts";
import { columnRegistry, columnsFor } from "../model/decorators/_metadata.ts";
import { ctorChain } from "../support/identifiers.ts";
import { isEncryptedCast } from "../casts/encrypted.ts";
import type { ClassRef } from "../support/classRef.ts";

// ── Model schema descriptor ───────────────────────────────────────────────────

export interface ModelColumn {
  name: string;
  type: ColumnOptions["type"]; // 'string' | 'text' | 'number' | 'boolean' | 'datetime' | 'json'
  nullable: boolean;
  primary: boolean;
  default: unknown;
  /** `@column({ unique: true })` — emit a unique index for this column. */
  unique?: boolean;
  /** `@column({ index: true })` — emit a plain index for this column. */
  index?: boolean;
}

export interface ModelSchema {
  table: string;
  primaryKey: string;
  timestamps: boolean;
  softDeletes: boolean;
  columns: ModelColumn[];
}

/**
 * Map a model property name to its database column name. Models declare columns in camelCase
 * (`twoFactorSecret`) but the ORM reads/writes snake_case (`two_factor_secret`) — see
 * BaseModel's `toSnake`. Schema generation (synchronize, migrate:generate) and schema diffing
 * MUST use this so generated/compared column names match the runtime convention. Idempotent for
 * names that are already snake_case.
 */
export function columnDbName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// ── Prototype-chain column collection ─────────────────────────────────────────

/**
 * Walk up the prototype chain of `ctor`, collecting `@column()` definitions
 * from every ancestor that has an entry in `columnRegistry`.
 *
 * Child-class columns win over parent-class columns when names collide —
 * the walk stops at `Function.prototype` (the top of the JS class hierarchy).
 *
 * This handles `AdminUser extends User extends BaseModel` correctly: columns
 * declared on `User` appear in `AdminUser`'s schema without needing to be
 * re-declared.
 */
function collectColumns(ctor: ClassRef): Map<string, ColumnOptions> | null {
  // columnsFor walks the prototype chain (child overrides parent) and mirrors each
  // class's metadata into columnRegistry on first read.
  return columnsFor(ctor);
}

function toModelColumns(
  fields: Map<string, ColumnOptions>,
  encrypted: ReadonlySet<string>,
): ModelColumn[] {
  const columns: ModelColumn[] = [];
  for (const [name, opts] of fields.entries()) {
    columns.push({
      name,
      // An encrypted column is generated as TEXT whatever it was declared as. The
      // stored payload is the plaintext plus 28 bytes of IV and auth tag, base64'd —
      // about 1.4× longer — so a VARCHAR(255) that comfortably held the value no
      // longer holds its ciphertext. MySQL outside strict mode truncates rather than
      // failing, and a truncated payload will not decrypt: the row is lost, quietly,
      // at write time. The generated migration says `table.text(...)`, so the
      // widening is visible in review rather than only here.
      type: encrypted.has(name) ? "text" : opts.type,
      nullable: opts.nullable ?? false,
      primary: opts.primary ?? false,
      default: opts.default,
      unique: opts.unique ?? false,
      index: opts.index ?? false,
    });
  }
  return columns;
}

/** Columns encrypted by either route — `cast: "encrypted…"` or `static encryptable`. */
function encryptedColumns(
  chain: readonly object[],
  fields: Map<string, ColumnOptions>,
): Set<string> {
  const names = new Set<string>();
  for (const [name, opts] of fields.entries()) {
    if (isEncryptedCast(opts.cast)) names.add(name);
  }
  for (const entry of chain) {
    for (const key of (entry as { encryptable?: string[] }).encryptable ?? []) names.add(key);
  }
  return names;
}

// ── ModelInspector ────────────────────────────────────────────────────────────

/**
 * Reads model class metadata from `columnRegistry` (populated when a model's `@table`
 * decorator drains its queued `@column` registrations at class-definition time) and
 * returns a structured schema description for each registered model.
 *
 * Prototype-chain walking: columns declared on a parent class are inherited
 * by child classes, matching normal TypeScript class semantics.
 *
 * Used by `migrate:generate` to compare model intent against the live DB.
 */
export const ModelInspector = {
  /**
   * Dynamically import all files matching `pattern` (relative to `cwd`).
   * Importing a model file runs its `@table` decorator, which registers the class's
   * columns into `columnRegistry` at definition time — so `all()` can enumerate them.
   */
  async load(pattern: string, cwd = process.cwd()): Promise<void> {
    const glob = new Bun.Glob(pattern);
    const files = await Array.fromAsync(glob.scan({ cwd }));
    for (const file of files) {
      await import(path.resolve(cwd, file));
    }
  },

  /**
   * Return a `ModelSchema` for every class registered in `columnRegistry`
   * that has a non-empty `static table` property.
   *
   * Skips anonymous classes, the `BaseModel` base class, and any class that
   * hasn't set `static table`. Walks the prototype chain so that inherited
   * columns are included automatically.
   */
  all(): ModelSchema[] {
    const schemas: ModelSchema[] = [];

    for (const [ctor] of columnRegistry.entries()) {
      const schema = ModelInspector.fromClass(ctor);
      if (schema) schemas.push(schema);
    }

    return schemas;
  },

  /**
   * Read the schema for a single model class.
   * Returns null if the class has no `static table` or no `@column()` fields
   * anywhere in its prototype chain.
   */
  fromClass(ctor: ClassRef): ModelSchema | null {
    const M = ctor as unknown as Record<string, unknown>;
    const table = M["table"] as string | undefined;
    if (!table) return null;

    const fields = collectColumns(ctor);
    if (!fields) return null;

    return {
      table,
      primaryKey: (M["primaryKey"] as string | undefined) ?? "id",
      timestamps: (M["timestamps"] as boolean | undefined) ?? true,
      softDeletes: (M["softDeletes"] as boolean | undefined) ?? false,
      columns: toModelColumns(fields, encryptedColumns(ctorChain(ctor), fields)),
    };
  },
};
