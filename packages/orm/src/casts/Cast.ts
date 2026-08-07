/**
 * Column casts — convert a stored DB value to a rich model value on read, and
 * back on write. The framework already accepts any `{ get, set }` object as a
 * cast; `Cast` is the ergonomic, reusable base for custom ones (put yours in
 * `app/casts/`), plus built-in JSON/array casters.
 *
 * @example
 * // app/casts/MoneyCast.ts
 * export class MoneyCast extends Cast<number> {
 *   get(db: unknown) { return Number(db) / 100; }   // cents → dollars
 *   set(v: number)   { return Math.round(v * 100); }
 * }
 *
 * // model
 * @column({ cast: new MoneyCast() })       price!: number;
 * @column({ cast: arrayOf(Address) })       addresses!: Address[];
 * @column({ cast: json<Settings>() })       settings!: Settings;
 */

/**
 * A reusable column caster: DB value ⇄ model value.
 *
 * Any object with these two methods can be passed to `@column({ cast })`; the
 * ORM calls `get` when hydrating an attribute from the database and `set` when
 * writing it back.
 *
 * @typeParam T - The model-side (deserialized) value type.
 * @category Casts
 */
export interface CastContract<T = unknown> {
  /** DB value → model value (on read). */
  get(dbValue: unknown): T;
  /** Model value → DB value (on write). */
  set(value: T): unknown;
}

/**
 * Base class for custom casts. Extend it, implement `get`/`set`, and reference an
 * instance from a column: `@column({ cast: new MoneyCast() })`.
 *
 * @typeParam T - The model-side (deserialized) value type.
 * @category Casts
 *
 * @example
 * ```ts
 * // app/casts/MoneyCast.ts
 * export class MoneyCast extends Cast<number> {
 *   get(db: unknown) { return Number(db) / 100; } // cents → dollars
 *   set(v: number)   { return Math.round(v * 100); }
 * }
 * ```
 */
export abstract class Cast<T = unknown> implements CastContract<T> {
  abstract get(dbValue: unknown): T;
  abstract set(value: T): unknown;
}

/** A class constructor or mapper function used to hydrate a JSON value. */
export type CastMapper<T> = ((raw: unknown) => T) | (new (...args: never[]) => T);

function _parse(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function _isClass(fn: unknown): boolean {
  return typeof fn === "function" && /^class[\s{]/.test(Function.prototype.toString.call(fn));
}

function _hydrate<T>(mapper: CastMapper<T> | undefined, raw: unknown): T {
  if (mapper === undefined || raw === null || raw === undefined) return raw as T;
  if (_isClass(mapper)) {
    const C = mapper as unknown as { fromJSON?: (r: unknown) => T; prototype: object };
    if (typeof C.fromJSON === "function") return C.fromJSON(raw);
    // Hydrate without invoking the constructor (data/value objects).
    return Object.assign(Object.create(C.prototype) as object, raw) as T;
  }
  return (mapper as (raw: unknown) => T)(raw);
}

/** A sub-field discovered on a cast's mapper class — consumed by the admin UI. */
export interface CastField {
  name: string;
  label: string;
  type: string;
}

function _titleField(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function _widgetForValue(v: unknown): string {
  if (typeof v === "boolean") return "toggle";
  if (typeof v === "number") return "number";
  return "text";
}

/** Introspect a mapper class into a field list (keys + inferred types from defaults). */
function _introspectFields(mapper: unknown): CastField[] {
  if (!_isClass(mapper)) return [];
  let inst: Record<string, unknown>;
  try {
    inst = new (mapper as new () => Record<string, unknown>)();
  } catch {
    return [];
  }
  return Object.entries(inst)
    .filter(([, v]) => typeof v !== "function")
    .map(([k, v]) => ({ name: k, label: _titleField(k), type: _widgetForValue(v) }));
}

/**
 * Cast a JSON column to a typed object, optionally hydrated into a class.
 * On read the stored JSON is parsed (and mapped via the constructor's `fromJSON`
 * or prototype hydration when a class mapper is given); on write it is stringified.
 * Usually created via the {@link json} / {@link objectOf} helpers.
 * @category Casts
 */
export class JsonCast<T = unknown> extends Cast<T | null> {
  /** Structural hint for the admin UI: a single nested object. */
  readonly shape = "object" as const;
  constructor(private readonly mapper?: CastMapper<T>) {
    super();
  }
  /** Sub-fields derived from the mapper class (empty for plain JSON). */
  fields(): CastField[] {
    return _introspectFields(this.mapper);
  }
  get(dbValue: unknown): T | null {
    const v = _parse(dbValue);
    return v === null || v === undefined ? (v as null) : _hydrate(this.mapper, v);
  }
  set(value: T | null): unknown {
    return value === null || value === undefined ? null : JSON.stringify(value);
  }
}

/**
 * Cast a JSON column to an array of typed values, optionally hydrated. Non-array
 * stored values read back as `[]`; on write the array is stringified. Usually
 * created via the {@link arrayOf} helper.
 * @category Casts
 */
export class ArrayCast<T = unknown> extends Cast<T[]> {
  /** Structural hint for the admin UI: a repeating list of nested objects. */
  readonly shape = "array" as const;
  constructor(private readonly mapper?: CastMapper<T>) {
    super();
  }
  /** Sub-fields of each element, derived from the mapper class. */
  fields(): CastField[] {
    return _introspectFields(this.mapper);
  }
  get(dbValue: unknown): T[] {
    const v = _parse(dbValue);
    if (!Array.isArray(v)) return [];
    return v.map((x) => _hydrate(this.mapper, x));
  }
  set(value: T[]): unknown {
    return JSON.stringify(value ?? []);
  }
}

/**
 * Typed JSON object cast: `@column({ cast: json<Settings>() })`.
 * @param mapper - Optional class or function to hydrate the parsed value into.
 * @category Casts
 */
export function json<T = unknown>(mapper?: CastMapper<T>): JsonCast<T> {
  return new JsonCast<T>(mapper);
}

/**
 * Alias of {@link json}, reads nicely with a class: `objectOf(Address)`.
 * @param mapper - Optional class or function to hydrate the parsed value into.
 * @category Casts
 */
export function objectOf<T = unknown>(mapper?: CastMapper<T>): JsonCast<T> {
  return new JsonCast<T>(mapper);
}

/**
 * Typed JSON list cast: `@column({ cast: arrayOf(Address) })`.
 * @param mapper - Optional class or function to hydrate each element into.
 * @category Casts
 */
export function arrayOf<T = unknown>(mapper?: CastMapper<T>): ArrayCast<T> {
  return new ArrayCast<T>(mapper);
}
