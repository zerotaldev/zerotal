import { makeReactive } from "../ReactiveProxy.ts";
import type { CastContract } from "../../casts/Cast.ts";
import {
  enqueueMember,
  registerColumn,
  columnRegistry,
  columnsFor,
  reactiveColumnsFor,
} from "./_metadata.ts";

// Re-exported here for the public API — populated at class-definition time via @table.
export { columnRegistry };

// ── Column type definitions ───────────────────────────────────────────────────

/**
 * String shorthand accepted by `@column("...")`.
 * Each value maps to a fully-resolved `ColumnOptions` object.
 *
 * | Shorthand   | Equivalent options                              |
 * |-------------|--------------------------------------------------|
 * | `"string"`  | `{ type: "string" }`                            |
 * | `"text"`    | `{ type: "string" }` (large text, alias)        |
 * | `"integer"` | `{ type: "number", cast: "integer" }`           |
 * | `"number"`  | `{ type: "number" }`                            |
 * | `"float"`   | `{ type: "number", cast: "float" }`             |
 * | `"boolean"` | `{ type: "boolean", cast: "boolean" }`          |
 * | `"datetime"`| `{ type: "datetime", cast: "datetime" }`        |
 * | `"date"`    | `{ type: "datetime", cast: "date" }`            |
 * | `"json"`    | `{ type: "json", cast: "json" }`                |
 * | `"array"`   | `{ type: "json", cast: "array" }`               |
 */
export type ColumnShorthand =
  | "string"
  | "text"
  | "integer"
  | "number"
  | "float"
  | "boolean"
  | "datetime"
  | "date"
  | "json"
  | "array";

/**
 * Full option object accepted by `@column({ ... })`.
 *
 * Every string shorthand ({@link ColumnShorthand}) resolves to one of these; use
 * the object form directly when you need `nullable`, `default`, a custom `cast`,
 * or to mark a `primary` key.
 *
 * @remarks
 * The registered `type` drives schema generation / auto-migration, while `cast`
 * drives runtime serialization of the attribute value (see the field docs below).
 * A `cast` is also mirrored onto the model class's `static casts` map at
 * registration time.
 *
 * @example
 * ```ts
 * @column({ type: "string", nullable: true, default: "guest" })
 * nickname?: string | null;
 *
 * @column({ type: "json", cast: "array", default: [] })
 * tags!: string[];
 *
 * @column({ cast: new MoneyCast() })
 * price!: number;
 * ```
 */
export interface ColumnOptions {
  /** Logical storage type; drives schema generation and auto-migration. @default "string" */
  type?: "string" | "number" | "boolean" | "datetime" | "json";
  /** Mark this column as the table's primary key. */
  primary?: boolean;
  /** Allow SQL `NULL` for this column. */
  nullable?: boolean;
  /** Default value applied when none is provided. */
  default?: unknown;
  /**
   * Shorthand cast types automatically serialize/deserialize the column value.
   * Can also be a custom object with `get`/`set` functions for full control.
   *
   * - 'datetime'       — Carbon on read, ISO string on write (recommended for dates)
   * - 'date'           — native Date on read, ISO string on write
   * - 'array' / 'json' — JSON.parse on read, JSON.stringify on write
   * - 'boolean'        — coerces 0/1 integers; writes 0 or 1
   * - 'integer'        — parseInt on both read and write
   * - 'float'          — parseFloat on both read and write
   * - 'enum'           — pass-through; pairs with `enumValues` for TS enum columns
   */
  cast?:
    | "datetime"
    | "array"
    | "json"
    | "date"
    | "boolean"
    | "integer"
    | "float"
    | "enum"
    | "immutable_datetime"
    | `decimal:${number}`
    | {
        get?: (dbValue: unknown) => unknown;
        set?: (jsValue: unknown) => unknown;
      }
    | CastContract<unknown>;
  /** Enum object (e.g. the imported TS enum) used alongside cast: 'enum'. */
  enumValues?: Record<string, string | number>;
}

/**
 * Map each ColumnShorthand to its resolved ColumnOptions.
 */
const SHORTHAND_MAP: Record<ColumnShorthand, ColumnOptions> = {
  string: { type: "string" },
  text: { type: "string" },
  integer: { type: "number", cast: "integer" },
  number: { type: "number" },
  float: { type: "number", cast: "float" },
  boolean: { type: "boolean", cast: "boolean" },
  datetime: { type: "datetime", cast: "datetime" },
  date: { type: "datetime", cast: "date" },
  json: { type: "json", cast: "json" },
  array: { type: "json", cast: "array" },
};

function resolveOptions(arg?: ColumnShorthand | ColumnOptions): ColumnOptions {
  if (arg === undefined) return { type: "string" };
  if (typeof arg === "string") {
    const a = arg as string;
    if (a.startsWith("decimal:"))
      return { type: "number", cast: a as ColumnOptions["cast"] } as ColumnOptions;
    if (a === "immutable_datetime")
      return {
        type: "datetime",
        cast: "immutable_datetime" as ColumnOptions["cast"],
      } as ColumnOptions;
    return SHORTHAND_MAP[a as ColumnShorthand] ?? { type: "string" };
  }
  return arg;
}

// ── Reactivity ────────────────────────────────────────────────────────────────

function shouldReactive(options: ColumnOptions): boolean {
  return options.cast === "json" || options.cast === "array" || options.type === "json";
}

function wrapReactive(
  instance: unknown,
  key: string,
  options: ColumnOptions,
  value: unknown,
): unknown {
  if (!shouldReactive(options)) return value;
  const ctor = (instance as { constructor?: { reactiveCasts?: boolean } }).constructor;
  if (!ctor || !ctor.reactiveCasts) return value;
  return makeReactive(instance as any, key, value);
}

function defineReactiveProperty(
  instance: unknown,
  key: string,
  options: ColumnOptions,
  initialValue?: unknown,
): void {
  if (!shouldReactive(options)) return;

  const privateKey = `_zerotal_${key}`;
  const self = instance as Record<string, unknown>;
  const seed = initialValue !== undefined ? initialValue : self[key];
  self[privateKey] = wrapReactive(instance, key, options, seed);

  Object.defineProperty(instance, key, {
    get() {
      return (this as Record<string, unknown>)[privateKey];
    },
    set(value: unknown) {
      const next = wrapReactive(this, key, options, value);
      (this as Record<string, unknown>)[privateKey] = next;
      if ((this as { _exists?: boolean })._exists) {
        (this as { markDirty: (k: string) => void }).markDirty(key);
      }
    },
    enumerable: true,
    configurable: true,
  });
}

// ── @column() overloads ───────────────────────────────────────────────────────

/** Standard TC39 class-field decorator returned by {@link column}. */
type ColumnDecorator = (value: undefined, context: ClassFieldDecoratorContext) => void;

/**
 * Map a model property to a database column.
 *
 * @remarks
 * Applied to a field of a `BaseModel` subclass, `@column` registers that property
 * in the ORM's column metadata (`columnRegistry`), so it participates in
 * hydration, dirty-tracking, persistence, and schema generation / auto-migration.
 *
 * The argument may be omitted (defaults to a `"string"` column), given as a
 * {@link ColumnShorthand} string, or given as a full {@link ColumnOptions} object.
 * Options control the storage `type`, `primary` key, `nullable`, `default`, and —
 * most importantly — the `cast` that serializes the value between DB and model
 * (`json`/`array`, `datetime`/`date`, `boolean`, `integer`/`float`, `decimal:n`,
 * `enum`, or a custom `{ get, set }` / {@link CastContract}). A declared `cast` is
 * also mirrored onto the class's `static casts` map.
 *
 * Timestamp and primary-key conventions themselves are configured on the class via
 * `@table` (see {@link table}); `@column` only maps individual fields.
 *
 * Registration is anchored at class-definition time by the `@table` decorator (a
 * Bun 1.3.x standard-decorator workaround), so a model that declares columns must
 * also carry `@table` — or be auto-discovered from `app/models/`.
 *
 * @param arg - A {@link ColumnShorthand} string, a {@link ColumnOptions} object, or nothing (defaults to `"string"`).
 * @returns A class-field decorator that registers the property as a column.
 *
 * @example
 * ```ts
 * @table("users")
 * export class User extends BaseModel {
 *   @column({ primary: true }) id!: number;
 *
 *   // No args — defaults to a string column
 *   @column() name!: string;
 *
 *   // String shorthand
 *   @column("integer") age!: number;
 *   @column("datetime") createdAt!: Carbon;
 *
 *   // Cast a JSON column to/from an array (reactive when `static reactiveCasts`)
 *   @column({ type: "json", cast: "array", default: [] }) roles!: string[];
 *
 *   // Nullable with a custom cast object
 *   @column({ nullable: true, cast: { get: (v) => v && new URL(String(v)), set: (u) => u?.href } })
 *   website?: URL | null;
 * }
 * ```
 */
export function column(): ColumnDecorator;
export function column(type: ColumnShorthand): ColumnDecorator;
export function column(options: ColumnOptions): ColumnDecorator;
export function column(arg?: ColumnShorthand | ColumnOptions): ColumnDecorator {
  const options = resolveOptions(arg);
  // The decorator BODY runs synchronously at definition time with the correct
  // `context.name` (the only thing Bun 1.3.x compiles reliably for field decorators).
  // We can't defer to a field initializer or addInitializer — Bun cross-wires those
  // across classes. Instead capture name+options here and enqueue the registration; the
  // `@table` class decorator drains the queue into the concrete class (see _metadata.ts).
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const name = String(context.name);
    enqueueMember(name, (ctor) => registerColumn(ctor, name, options));
  };
}

/**
 * Install reactive accessors (json/array `reactiveCasts` columns) on a fresh instance.
 * Called from the model's fill()/hydrate paths — registration now happens at decoration
 * time, so the per-instance reactive setup is done here rather than in a field initializer.
 * Idempotent.
 *
 * @param instance - The freshly constructed / hydrated model instance to wire.
 * @internal
 */
export function installReactiveAccessors(instance: object): void {
  const reactive = reactiveColumnsFor(instance.constructor as Function);
  if (!reactive.length) return;
  const cols = columnsFor(instance.constructor as Function);
  for (const name of reactive) {
    const desc = Object.getOwnPropertyDescriptor(instance, name);
    if (desc && typeof desc.get === "function") continue; // already installed
    const opts = cols?.get(name);
    if (opts) defineReactiveProperty(instance, name, opts);
  }
}
