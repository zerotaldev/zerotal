import type { SQLInstance } from "../db/sql-types.ts";
import type { PaginateResult } from "../db/types.ts";
import { RequestContext, FrameworkEvents } from "@zerotal/core";
import { ModelChanged } from "../events.ts";
import { Carbon } from "@zerotal/core/carbon";
import { toCamelKey as toCamel, toSnakeColumn as toSnake } from "../support/identifiers.ts";
import { resolveContainerConnection } from "../db/resolver.ts";
import { currentOrmContext } from "./OrmContext.ts";
import {
  ModelQueryBuilder,
  _globalScopeRegistry,
  aggregateAttribute,
  countAttribute,
  type GlobalScopeCallback,
} from "./ModelQueryBuilder.ts";
import {
  QueryBuilder,
  _setQueryBuilderDialect,
  _runSegments,
  _assertIdentifier,
  dialectFor,
  registerConnectionDialect,
  type Dialect,
} from "../db/QueryBuilder.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { HookRegistry, type HookName } from "./hooks/HookRegistry.ts";
import { registerObserver, type ModelObserver } from "./Observer.ts";
import { makeReactive } from "./ReactiveProxy.ts";
import {
  ModelNotFoundError,
  RelationNotLoadedError,
  MassAssignmentError,
} from "../errors/index.ts";
import { type ManyToMany } from "./relations/RelationRegistry.ts";
import { installReactiveAccessors, type ColumnOptions } from "./decorators/column.ts";
import { _compose } from "./mixins.ts";
import type { Compose } from "./mixins.ts";
import { columnsFor, relationsFor } from "./decorators/_metadata.ts";
import {
  collectEncryptable,
  decryptColumn,
  encryptColumn,
  isEncryptedCast,
  type EncryptedCastName,
} from "../casts/encrypted.ts";
import { TransactionContext } from "../db/TransactionContext.ts";
import type { InsertPayload, UpdatePayload, FillablePayload } from "./payload.ts";
import type { WhereOperator, OrderDirection } from "../db/types.ts";
import type { ClassRef } from "../support/classRef.ts";

let _dialect: "sqlite" | "postgres" | "mysql" = "sqlite";

const _writeDialect = new AsyncLocalStorage<Dialect>();

// ── Model event dispatch (`dispatchesEvents` bridge) ──────────────────────────
//
// Maps internal hook names to the event keys used in `dispatchesEvents`.
const _HOOK_TO_EVENT: Partial<Record<HookName, string>> = {
  beforeCreate: "creating",
  afterCreate: "created",
  beforeUpdate: "updating",
  afterUpdate: "updated",
  beforeSave: "saving",
  afterSave: "saved",
  beforeDelete: "deleting",
  afterDelete: "deleted",
  afterFind: "retrieved",
};

// App-level dispatcher, wired by DatabaseProvider to the container's event bus. No-op when
// unset (ORM used standalone / no emitter bound), keeping the ORM decoupled from core events.
let _eventDispatcher: ((event: object) => void) | undefined;

/** @internal Set the model-event dispatcher (called by DatabaseProvider). */
export function _setModelEventDispatcher(fn: ((event: object) => void) | undefined): void {
  _eventDispatcher = fn;
}

// The persisting lifecycle hooks that correspond to a row change, for monitor telemetry.
const _HOOK_TO_OP: Partial<Record<HookName, ModelChanged["operation"]>> = {
  afterCreate: "created",
  afterUpdate: "updated",
  afterDelete: "deleted",
};

// Dispatch the mapped event (if any) after a lifecycle hook runs. Wired via HookRegistry so
// it honours the hook-suppression context (factory seeding mutes events automatically).
HookRegistry.onAfterRun = (ModelClass, hook, model): void => {
  // Per-model change telemetry (created/updated/deleted) for the monitor's models
  // watcher. Fires for every model regardless of `dispatchesEvents`, but only when
  // hooks aren't suppressed (so factory seeding doesn't flood it).
  const op = _HOOK_TO_OP[hook];
  if (op) {
    const cls = ModelClass as typeof BaseModel;
    FrameworkEvents.emit(new ModelChanged(cls.name, cls.table ?? "", op));
  }

  // `dispatchesEvents` bridge to the app event bus.
  if (!_eventDispatcher) return;
  const key = _HOOK_TO_EVENT[hook];
  if (!key) return;
  const map = (ModelClass as typeof BaseModel).dispatchesEvents;
  const EventClass = map?.[key];
  if (EventClass) _eventDispatcher(new EventClass(model));
};

/**
 * Register a named connection that models can select via `static connection`.
 * Stored on the current OrmContext (execution-scoped), not a global.
 *
 * @internal
 */
export function registerModelConnection(name: string, conn: SQLInstance, dialect?: Dialect): void {
  currentOrmContext().namedConnections.set(name, conn);
  registerConnectionDialect(conn as unknown as object, dialect ?? _dialect);
}

/** @internal — clear named connections (tests). Prefer resetOrmContext(). */
export function _clearModelConnections(): void {
  currentOrmContext().namedConnections.clear();
}

/** @internal Set an execution-scoped override connection for all models (tests / withDatabase). */
export function _setBaseModelConnection(conn: SQLInstance | null): void {
  currentOrmContext().overrideConnection = conn;
  if (conn) registerConnectionDialect(conn as unknown as object, _dialect);
}

/** @internal Set the active SQL dialect used for identifier quoting and date serialization. */
export function _setBaseModelDialect(dialect: "sqlite" | "postgres" | "mysql"): void {
  _dialect = dialect;
  _setQueryBuilderDialect(dialect);
  const ov = currentOrmContext().overrideConnection;
  if (ov) {
    registerConnectionDialect(ov as unknown as object, dialect);
  }
}

/** @internal Return the active SQL dialect. */
export function _getDialect(): "sqlite" | "postgres" | "mysql" {
  return _dialect;
}

/**
 * Returns the active connection — override if set, otherwise via the injected resolver.
 *
 * @internal
 */
export function _getModelConnection(): SQLInstance {
  const override = currentOrmContext().overrideConnection;
  if (override) return override;
  const conn = resolveContainerConnection();
  if (conn) return conn;
  throw new Error("[Zerotal ORM] No database connection. Is DatabaseProvider registered?");
}

/**
 * Context-aware connection resolver — an additive, AsyncLocalStorage-safe hook used
 * by features that route queries to a connection chosen by the *current execution
 * context* rather than a global override. The canonical user is `@zerotal/tenancy`'s
 * multi-database strategy: it returns the active tenant's connection so every model
 * query transparently hits the right database. Returns `null` to defer to the normal
 * resolution. Defaults to a no-op, so it changes nothing until something registers it.
 *
 * @internal
 */
export type ContextConnectionResolver = (ModelClass?: typeof BaseModel) => SQLInstance | null;
let _contextConnectionResolver: ContextConnectionResolver | null = null;

/**
 * Register a context-aware connection resolver (pass `null` to clear). Consulted by
 * `_resolveConn` after explicit transactions and `static connection` named bindings,
 * but before the default connection — so transactions and pinned connections still win.
 *
 * @internal
 */
export function registerConnectionResolver(fn: ContextConnectionResolver | null): void {
  _contextConnectionResolver = fn;
}

/**
 * Resolve the connection for a model operation.
 * Priority: ALS transaction > RequestContext._transaction > `static connection` named
 * binding > context resolver (e.g. tenancy multi-db) > configured/default connection.
 * The configured connection itself may be an override set by withDatabase() in tests.
 *
 * @internal
 */
export function _resolveConn(ModelClass?: typeof BaseModel): SQLInstance {
  const tx =
    TransactionContext.getStore() ??
    (RequestContext.tryGet()?._transaction as SQLInstance | undefined);
  if (tx) return tx;
  const name = ModelClass?.connection;
  if (name) {
    const named = currentOrmContext().namedConnections.get(name);
    if (named) return named;
  }
  if (_contextConnectionResolver) {
    const resolved = _contextConnectionResolver(ModelClass);
    if (resolved) return resolved;
  }
  return _getModelConnection();
}

// Column-name conversion lives in support/identifiers.ts — one memoized
// implementation shared with the query builders, whose lookups must produce
// exactly the property names hydration creates here.

/**
 * Format a Date for storage, respecting the active dialect.
 * MySQL DATETIME columns reject ISO 8601 ('T'/'Z') — they require 'YYYY-MM-DD HH:MM:SS'.
 * SQLite and PostgreSQL both accept ISO 8601 as-is.
 */
function _serializeDate(date: Date): string {
  const dialect = _writeDialect.getStore() ?? _dialect;
  if (dialect === "mysql") {
    return date.toISOString().replace("T", " ").slice(0, 19);
  }
  return date.toISOString();
}

function serializeVal(v: unknown): unknown {
  if (v instanceof Carbon) return _serializeDate(v.toDate());
  if (v instanceof Date) return _serializeDate(v);
  return v;
}

type StringCast =
  | "datetime"
  | "array"
  | "json"
  | "date"
  | "boolean"
  | "integer"
  | "float"
  | "enum"
  | "immutable_datetime"
  | EncryptedCastName
  | `decimal:${number}`;
type CastOption = ColumnOptions["cast"];

function getCasts(ctor: ClassRef): Record<string, CastOption> {
  const merged: Record<string, CastOption> = {};
  const chain: ClassRef[] = [];
  let current: ClassRef | null = ctor;
  while (current && current !== Function.prototype) {
    chain.push(current);
    current = Object.getPrototypeOf(current) as ClassRef | null;
  }
  chain.reverse();
  // `static encryptable` first, so an explicit cast on the same column still wins —
  // spelling one out is the more specific statement of intent.
  const colReg = columnsFor(ctor);
  Object.assign(
    merged,
    collectEncryptable(chain, (key) => colReg?.get(key)?.type),
  );
  for (const entry of chain) {
    const casts = (entry as { casts?: Record<string, CastOption> }).casts;
    if (casts) Object.assign(merged, casts);
  }
  return merged;
}

function applyCastGet(value: unknown, cast: StringCast, label: string): unknown {
  if (value === null || value === undefined) return value;
  if (isEncryptedCast(cast)) return decryptColumn(value, cast, label);
  const cstr = cast as unknown as string;
  if (cstr.startsWith("decimal:")) {
    const n = parseInt(cstr.slice(8), 10) || 0;
    return Number(value).toFixed(n);
  }
  if (cstr === "immutable_datetime") {
    return value instanceof Carbon ? value : new Carbon(value as string | number | Date);
  }
  switch (cast) {
    case "datetime":
      if (value instanceof Carbon) return value;
      return new Carbon(value as string | number | Date);
    case "array":
    case "json":
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    case "date":
      if (value instanceof Date) return value;
      if (value instanceof Carbon) return value.toDate();
      if (typeof value === "string" || typeof value === "number") return new Date(value);
      return value;
    case "boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
      return Boolean(value);
    case "integer":
      return parseInt(String(value), 10);
    case "float":
      return parseFloat(String(value));
    case "enum":
      return value;
    default:
      return value;
  }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function applyCastSet(value: unknown, cast: StringCast, label: string): unknown {
  if (value === null || value === undefined) return value;
  if (isEncryptedCast(cast)) return encryptColumn(value, cast, label);
  const cstr = cast as unknown as string;
  if (cstr.startsWith("decimal:")) {
    const n = parseInt(cstr.slice(8), 10) || 0;
    return Number(value).toFixed(n);
  }
  if (cstr === "immutable_datetime") {
    if (value instanceof Carbon) return _serializeDate(value.toDate());
    if (value instanceof Date) return _serializeDate(value);
    return value;
  }
  switch (cast) {
    case "datetime":
      if (value instanceof Carbon) return _serializeDate(value.toDate());
      if (value instanceof Date) return _serializeDate(value);
      return value;
    case "array":
    case "json":
      // Encode unconditionally. Skipping strings was meant to avoid double-encoding a
      // value that was already JSON text, but that is indistinguishable from a string
      // someone means to store — and guessing wrong changed the value's *type* between
      // write and read: `"62812345678"` went in as bare characters and came back out of
      // `JSON.parse` as a number. Encoding both ways symmetrically is the only version
      // of this that round-trips.
      return JSON.stringify(value);
    case "date":
      if (value instanceof Carbon) return _serializeDate(value.toDate());
      if (value instanceof Date) return _serializeDate(value);
      return value;
    case "boolean":
      return value ? 1 : 0;
    case "integer":
      return parseInt(String(value), 10);
    case "float":
      return parseFloat(String(value));
    case "enum":
      return value;
    default:
      return value;
  }
}

function shouldProxyCast(
  model: typeof BaseModel,
  cast: CastOption | undefined,
  colType: ColumnOptions["type"] | undefined,
): boolean {
  if (!model.reactiveCasts) return false;
  return cast === "json" || cast === "array" || colType === "json";
}

/**
 * Serialize one model property value for a database write.
 *
 * Applies, in priority order: a custom cast object's `set()`, a string
 * shorthand cast ('boolean', 'json', …), then @column type coercions
 * (boolean → 0/1, json → JSON string), and finally dialect-aware date
 * formatting via serializeVal(). Must run inside a `_writeDialect.run()`
 * scope so dates serialize for the right engine.
 *
 * Shared by bulkInsert(), upsert(), and both save() branches.
 */
function _serializeForWrite(
  key: string,
  val: unknown,
  casts: Record<string, CastOption>,
  colReg: Map<string, ColumnOptions> | null,
  model?: string,
): unknown {
  const colMeta = colReg?.get(key);
  const castOpt = casts[key] ?? colMeta?.cast;
  const colType = colMeta?.type;
  let serializedVal: unknown;
  if (castOpt && typeof castOpt === "object" && castOpt.set) {
    serializedVal = castOpt.set(val);
  } else if (typeof castOpt === "string") {
    serializedVal = applyCastSet(val, castOpt, model ? `${model}.${key}` : key);
  } else if (colType === "boolean" && val !== null && val !== undefined) {
    serializedVal = val ? 1 : 0;
  } else if (colType === "json" && val !== null) {
    // See applyCastSet: strings are encoded too, so the column always holds valid JSON
    // and a read returns the type that was written.
    serializedVal = JSON.stringify(val);
  } else {
    serializedVal = val;
  }
  return serializeVal(serializedVal);
}

type Seg = string | { val: unknown };

// Both delegate to QueryBuilder._runSegments so model writes share the same
// interned-template cache AND emit the same QueryExecuted telemetry events
// as builder queries (previously model writes were invisible to the monitor).

async function runSegs(conn: SQLInstance, segs: Seg[]): Promise<void> {
  await _runSegments(conn, segs);
}

function runQuery<T = Record<string, unknown>>(conn: SQLInstance, segs: Seg[]): Promise<T[]> {
  return _runSegments<T>(conn, segs);
}

const SYSTEM_KEYS = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

type ModelCtor<T extends BaseModel> = typeof BaseModel & { new (): T };

/**
 * Return camelCase relation names registered anywhere in a constructor's
 * prototype chain. Walks the chain (like getCasts / _allColumnKeys) so a subclass
 * inherits relations declared on ancestor classes — e.g. mixins applied in layers
 * (`Roles(Permissions(Base))`), where each relation lives on a different
 * class in the chain.
 */
function relNames(ctor: ClassRef): Set<string> {
  return new Set(relationsFor(ctor).keys());
}

/**
 * Enumerate own enumerable data properties, skipping:
 *  - _private fields
 *  - system columns (id, timestamps, softDeletes)
 *  - any relation property (getter-guard OR plain undefined from field initialiser)
 */
function* ownDataEntries(
  target: object,
  skipKeys: Set<string>,
  rels: Set<string>,
  allowedKeys?: Set<string> | null,
): Generator<[string, unknown]> {
  for (const key of Object.keys(target)) {
    if (key.startsWith("_")) continue;
    if (skipKeys.has(key)) continue;
    if (rels.has(key)) continue;
    if (allowedKeys && !allowedKeys.has(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (desc && typeof desc.get === "function") {
      // Skip lazy-load relation guards, but INCLUDE reactive column accessors
      // (json/array) — they carry a `_zerotal_<key>` backing data property.
      if (!Object.prototype.hasOwnProperty.call(target, `_zerotal_${key}`)) continue;
    }
    yield [key, (target as Record<string, unknown>)[key]];
  }
}

/**
 * Collect all @column-registered property names across the full prototype chain
 * of a model class. Returns null when no column registry entries are found at all
 * (rare edge case: a model with zero @column decorators) so callers can fall back
 * to the old unrestricted behaviour.
 */
function _allColumnKeys(cls: ClassRef): Set<string> | null {
  const cols = columnsFor(cls);
  return cols ? new Set(cols.keys()) : null;
}

/**
 * A reusable, applicable query constraint produced by {@link BaseModel.scope}.
 * Its `apply` method mutates a {@link QueryBuilder} to add the scope's clauses.
 */
export interface ScopeApplicator {
  apply(query: QueryBuilder): void;
}

/**
 * Union of all data-column property names on a model class.
 *
 * Excludes:
 * - Methods / functions
 * - Internal underscore-prefixed properties (`_exists`, `_original`, `_zerotal_*`)
 *
 * Use this to give `fillable`, `hidden`, and `hashable` compile-time safety
 * — TypeScript will catch typos and non-existent column references.
 *
 * @example
 * \@table("users")
 * export class User extends BaseModel {
 *   static fillable: Columns<User>[] = ["name", "email", "role"];
 *   static hidden:   Columns<User>[] = ["password"];
 *   static hashable: Columns<User>[] = ["password"];
 *
 *   @column() name!: string;
 *   @column() email!: string;
 *   @column() password!: string;
 *   @column() role?: string;
 * }
 */
export type Columns<T> = {
  [K in keyof T & string]: K extends `_${string}`
    ? never
    : T[K] extends (...args: any[]) => any
      ? never
      : K;
}[keyof T & string];

/**
 * Base class for every Zerotal Active Record model, backed by `Bun.sql`.
 *
 * Subclass it, declare columns with `@column`, and you get querying,
 * persistence, dirty tracking, relationships, serialization, timestamps,
 * lifecycle hooks, and (opt-in) soft deletes — Active Record-style, but
 * fully typed against your model's own properties.
 *
 * @remarks
 * An instance is a row: its enumerable data properties are the attributes.
 * The model snapshots them on load, so {@link isDirty}, {@link $dirty}, and
 * {@link save} write only changed columns (an UPDATE touches dirty columns
 * only; a new instance INSERTs).
 *
 * **Mass assignment is guarded by default.** A model that declares neither
 * {@link fillable} (allowlist) nor {@link guarded} (denylist) rejects every
 * attribute passed to {@link fill} / {@link create} with a
 * {@link MassAssignmentError}, so a stray key from a request body can never
 * reach the database. Use {@link forceFill} / {@link forceCreate} for trusted,
 * framework-internal writes only.
 *
 * **Timestamps** (`created_at` / `updated_at`) are maintained automatically
 * when {@link timestamps} is `true` (the default). The **primary key** is
 * `id` unless {@link primaryKey} is overridden. **Soft deletes** are opt-in
 * via the `SoftDeletes` mixin (which sets {@link softDeletes}); once enabled,
 * queries scope `WHERE deleted_at IS NULL` and {@link delete} sets
 * `deleted_at` instead of removing the row.
 *
 * `@column({ cast })` / {@link casts} coerce values on read and write
 * (booleans, JSON/array, dates via `Carbon`, decimals, enums). {@link hashable}
 * fields are bcrypt-hashed transparently on save. {@link hidden} / {@link visible}
 * / {@link appends} shape {@link toJSON} output.
 *
 * @example
 * Defining a model with `@column`:
 * ```ts
 * @table("users")
 * export class User extends BaseModel {
 *   static fillable: Columns<User>[] = ["name", "email", "password"];
 *   static hidden: Columns<User>[] = ["password"];
 *   static hashable = ["password"];
 *
 *   @column() name!: string;
 *   @column() email!: string;
 *   @column() password!: string;
 *   @column({ cast: "boolean" }) active?: boolean;
 * }
 * ```
 *
 * @example
 * Querying, creating, and saving:
 * ```ts
 * // Create (mass-assignment respects `fillable`)
 * const user = await User.create({ name: "Ada", email: "ada@example.com", password: "s3cret" });
 *
 * // Query
 * const admins = await User.where("role", "admin").orderBy("name").get();
 * const found = await User.findOrFail(user.id); // throws ModelNotFoundError if missing
 *
 * // Mutate + persist (only dirty columns are written)
 * found.name = "Ada Lovelace";
 * await found.save();
 * ```
 */
export class BaseModel {
  /**
   * Phantom nominal brand, used ONLY at the type level to detect relation
   * properties (see `ColumnKeys` in payload.ts). Detecting relations by this one
   * marker — rather than structurally via `extends BaseModel` — avoids forcing TS
   * to re-resolve a related model's `fill(data: UpdatePayload<this>)` signature,
   * which is itself defined in terms of `ColumnKeys`. That structural feedback loop
   * is what makes mutually-referential models (A.b: B, B.a: A) trip TS2615
   * ("circularly references itself in mapped type").
   *
   * `declare` => purely type-level, no runtime field is emitted and instances
   * never carry it. The leading underscore keeps it out of column/serialization
   * key sets automatically.
   */
  declare readonly __isZerotalModel: true;

  /**
   * Compose one or more model mixins onto this class, folding them left-to-right, so reusable
   * model behaviour (auth contract, roles, permissions, soft deletes, tenancy, …) stacks flat
   * instead of nesting.
   *
   * @remarks
   * Each mixin receives the accumulated base and returns an extended class, so this class's full
   * static surface (`query()`, `find()`, `create()`, scopes, …) and every mixin's instance and
   * static members flow through to the composed class — fully type-checked. Prefer this over
   * hand-nesting mixins (`Roles(Permissions(AuthUser))`), which reads inside-out and repeats the
   * base.
   *
   * `using` composes onto whatever class it is called on, so it also works on an intermediate
   * model base, and the composed class carries `using` itself, so `Model.using(a, b).using(c)`
   * chains past the 8-mixin overload set.
   *
   * Mixin authors declaring columns must call {@link registerColumn} imperatively — the `@column`
   * decorator cannot run inside a returned class expression.
   *
   * @param mixins - Mixin factories applied in order; each receives the class the previous one produced.
   * @returns A model class extending this one with every mixin applied.
   *
   * @example
   * ```ts
   * class User extends Model.using(Authenticatable, Permissions, Roles) {}
   * ```
   *
   * @category Composition
   */
  static using: Compose = _compose;

  /**
   * Database table this model maps to. Usually set for you by the `@table("…")`
   * decorator; assign directly to override.
   *
   * @category Attributes & mass assignment
   */
  static table: string;

  /**
   * Primary-key column name. Defaults to `id`.
   *
   * @category Attributes & mass assignment
   */
  static primaryKey = "id";

  /**
   * When `true` (default), `created_at` / `updated_at` are set automatically on
   * insert and `updated_at` is bumped on every update. Toggle off, or wrap a
   * write in {@link withoutTimestamps}, to suppress this.
   *
   * @category Timestamps
   */
  static timestamps = true;

  /**
   * Whether this model uses soft deletes. Flipped to `true` by the `SoftDeletes`
   * mixin; when set, {@link delete} sets `deleted_at` and queries scope
   * `WHERE deleted_at IS NULL`.
   *
   * @category Soft deletes
   */
  static softDeletes = false;

  /**
   * Per-attribute cast map applied on read/write — string shorthands
   * (`"boolean"`, `"json"`, `"array"`, `"date"`, `"datetime"`, `"integer"`,
   * `"float"`, `"decimal:2"`, `"enum"`, `"immutable_datetime"`) or a custom
   * cast object with `get`/`set`. Merged across the prototype chain.
   *
   * @category Attributes & mass assignment
   */
  static casts?: Record<string, CastOption>;

  /**
   * Wrap `json`/`array` cast columns in a reactive proxy so mutating them in place
   * (`user.meta.count = 99`) marks the column dirty. Defaults to `true`.
   *
   * Off, the failure is silent and looks like success: `_applyRow` stores the same object
   * reference in the instance and in `_original`, and `$dirty()` compares with `!==`, so
   * `user.meta.count = 99; await user.save()` issues no UPDATE and reports no error. The
   * proxy is allocated only for columns actually cast to `json`/`array`.
   *
   * Set `false` for a model where that cost is measurable and every write to a JSON column
   * replaces the whole value (`user.meta = { ...user.meta, count: 99 }`), which dirty
   * tracking sees either way.
   *
   * @category Attributes & mass assignment
   */
  static reactiveCasts = true;

  /**
   * Whether this model participates in implicit route-model binding (default: true).
   * When on, a route param matching the model name auto-resolves to a loaded instance
   * (e.g. `:user` -> `User.findOrFail(value)`). Set to `false` to opt out.
   *
   * @category Route binding
   */
  static implicitBinding?: boolean;

  /**
   * Override which route param this model claims for implicit binding. By default a model
   * named `User` binds the `:user` param; set this to claim a different key.
   *
   * @example
   * static implicitBindingKey = "author"; // any :author param resolves via this model
   *
   * @category Route binding
   */
  static implicitBindingKey?: string;

  /**
   * Maps lifecycle events to event classes that are dispatched on the app
   * event bus when they fire (via `$dispatchesEvents`). Keys: `creating`, `created`,
   * `updating`, `updated`, `saving`, `saved`, `deleting`, `deleted`, `retrieved`. Each event
   * class is constructed with the model instance and emitted (no-op if no bus is bound).
   *
   * @example
   * static dispatchesEvents = { created: OrderPlaced, deleted: OrderCancelled };
   *
   * @category Lifecycle & hooks
   */
  static dispatchesEvents?: Record<string, new (model: unknown) => object>;

  /**
   * Allowlist of camelCase field names accepted by create() / fill().
   * When set, any key not in this list is rejected with `MassAssignmentError`.
   * Cannot be used together with `guarded`.
   *
   * @category Attributes & mass assignment
   */
  static fillable?: readonly string[];

  /**
   * Denylist of camelCase field names blocked from create() / fill().
   * When set, listed keys are rejected; all other keys are accepted.
   * Cannot be used together with `fillable`.
   *
   * @category Attributes & mass assignment
   */
  static guarded?: readonly string[];

  /**
   * Disable mass-assignment protection for this model — every attribute passed
   * to `fill()` / `create()` is accepted.
   *
   * Models **guard by default**: when neither `fillable` nor `guarded` is
   * declared, `fill()` rejects every attribute (throwing `MassAssignmentError`)
   * so an unexpected key from a request body can never reach the database. Set
   * this to `true` only for models whose writes never come from user input.
   *
   * @category Attributes & mass assignment
   */
  static unguarded = false;

  /**
   * Process-wide mass-assignment override. When true, models that declare
   * **neither** `fillable` **nor** `guarded` accept every attribute (an explicit
   * `fillable`/`guarded` list is always honoured regardless).
   *
   * Toggle it around trusted bulk work — seeders, migrations, test setup — with
   * {@link unguard} / {@link reguard}; the default (`false`) keeps request input
   * guarded. This is a global flag, so re-guard promptly in a `finally`.
   *
   * @internal
   */
  private static _unguardedGlobally = false;

  /**
   * Turn off mass-assignment guarding process-wide (trusted contexts only).
   *
   * @category Attributes & mass assignment
   */
  static unguard(): void {
    BaseModel._unguardedGlobally = true;
  }

  /**
   * Restore mass-assignment guarding process-wide.
   *
   * @category Attributes & mass assignment
   */
  static reguard(): void {
    BaseModel._unguardedGlobally = false;
  }

  /**
   * Run `callback` with mass-assignment guarding disabled process-wide,
   * restoring the previous setting afterwards (even on throw).
   *
   * @category Attributes & mass assignment
   */
  static async withoutGuard<T>(callback: () => T | Promise<T>): Promise<T> {
    BaseModel.unguard();
    try {
      return await callback();
    } finally {
      BaseModel.reguard();
    }
  }

  /**
   * Fields to exclude from `toJSON()` and therefore from any
   * `JSON.stringify()` output — API responses, cache serialisation, etc.
   *
   * List camelCase property names.  Nested models serialise independently
   * via their own `toJSON()`, so a parent's `hidden` list does not
   * propagate to relations.
   *
   * @example
   * static hidden = ['password', 'rememberToken'];
   *
   * @category Serialization
   */
  static hidden: string[] = [];

  /**
   * Allow-list for serialization. When set (non-empty), `toJSON()` includes
   * ONLY these keys (plus `appends`). Takes precedence over `hidden`.
   *
   * @category Serialization
   */
  static visible: string[] = [];

  /**
   * Computed accessor names to include in `toJSON()` output. Each name should
   * resolve to a getter (or plain property) on the instance.
   *
   * @example
   * class User extends BaseModel {
   *   static appends = ['fullName'];
   *   get fullName() { return `${this.first} ${this.last}`; }
   * }
   *
   * @category Serialization
   */
  static appends: string[] = [];

  /**
   * Optional named connection (registered via {@link registerConnection}). When
   * set, queries for this model resolve to that connection instead of the default.
   *
   * @category Querying
   */
  static connection?: string;

  /**
   * Fields that are automatically hashed with `Bun.password.hash()` (bcrypt)
   * before every INSERT and whenever the field changes on UPDATE.
   *
   * The hash is applied transparently in `save()` — the plaintext value is
   * never written to the database.  Use `Bun.password.verify()` to check
   * a plaintext candidate against the stored hash.
   *
   * @example
   * static hashable = ['password'];
   *
   * // Verify later:
   * const ok = await Bun.password.verify(candidate, user.password);
   *
   * @category Persistence
   */
  static hashable?: string[];

  /**
   * Columns encrypted at rest with AES-256-GCM under `APP_KEY`, and decrypted
   * transparently on read. Shorthand for putting `cast: "encrypted"` on each one.
   *
   * Unlike {@link hashable} this is reversible and non-destructive: the model
   * property still holds the value you assigned after a `save()`, because the
   * encryption happens on the way to the database rather than to the instance.
   * `$dirty` therefore compares plaintext, and an unchanged column is not
   * rewritten with a new IV on every save.
   *
   * A `json` column in this list encrypts as `encrypted:json`, so it round-trips
   * as the structure it was rather than as `"[object Object]"`.
   *
   * @example
   * ```ts
   * class Client extends BaseModel {
   *   static encryptable = ["idNumber", "passportNumber"];
   *
   *   // TEXT, not VARCHAR — a payload outgrows its plaintext.
   *   @column({ type: "text", nullable: true }) idNumber?: string;
   *   @column({ type: "text", nullable: true }) passportNumber?: string;
   * }
   * ```
   *
   * @remarks
   * Encrypted columns cannot be filtered, grouped or usefully sorted — every
   * write draws a fresh IV, so the ciphertext for a given value never repeats.
   * `where()` on one throws rather than quietly matching nothing. For lookup,
   * keep a hashed blind-index column beside it. Add these to {@link hidden} too
   * if the model is serialized to a client: decryption puts the real value back
   * on the instance, and `toJSON()` will happily include it.
   *
   * @category Persistence
   */
  static encryptable?: string[];

  /**
   * Register an observer class for this model.
   * The observer's lifecycle methods (creating, created, updating, …) are
   * wired into the HookRegistry automatically.
   *
   * @example
   * User.observe(UserObserver);  // call once at boot in a ServiceProvider
   *
   * @category Lifecycle & hooks
   */
  static observe<T extends BaseModel>(
    this: ModelCtor<T>,
    ObserverClass: new () => ModelObserver<T>,
  ): void {
    registerObserver<T>(this, ObserverClass);
  }

  /**
   * Primary-key value. Populated after {@link save} inserts a new row, or when
   * the instance is hydrated from the database.
   *
   * @category Attributes & mass assignment
   */
  id!: number;

  /**
   * Creation timestamp, set on insert when {@link timestamps} is enabled.
   *
   * @category Timestamps
   */
  createdAt?: Date;

  /**
   * Last-update timestamp, bumped on every save when {@link timestamps} is enabled.
   *
   * @category Timestamps
   */
  updatedAt?: Date;

  /** @internal Snapshot of attribute values at load/last-save, for dirty tracking. */
  private _original: Record<string, unknown> = {};
  /** @internal Keys force-marked dirty via {@link markDirty}. */
  private _forcedDirty = new Set<string>();
  /**
   * True when this instance was loaded from (or last written to) the database.
   *
   * @internal
   */
  private _exists = false;

  // ── Global query scopes ──────────────────────────────────────────────────

  /**
   * Register a named global scope applied to every query for this model.
   * The callback receives the query builder and constrains it (e.g. a tenant
   * filter). Remove it later with {@link removeGlobalScope}.
   *
   * @category Querying
   */
  static addGlobalScope<T extends BaseModel>(
    this: ModelCtor<T>,
    name: string,
    callback: GlobalScopeCallback,
  ): void {
    const reg = _globalScopeRegistry();
    let scopes = reg.get(this);
    if (!scopes) {
      scopes = new Map();
      reg.set(this, scopes);
    }
    scopes.set(name, callback);
  }

  /**
   * Remove a previously registered global scope by name.
   *
   * @category Querying
   */
  static removeGlobalScope<T extends BaseModel>(this: ModelCtor<T>, name: string): void {
    _globalScopeRegistry().get(this)?.delete(name);
  }

  /**
   * Register a named connection that models can select via `static connection`.
   * Stored on the current OrmContext (execution-scoped).
   *
   * @category Querying
   */
  static registerConnection(name: string, conn: SQLInstance, dialect?: Dialect): void {
    registerModelConnection(name, conn, dialect);
  }

  /**
   * Run a callback with automatic timestamp updates disabled for this model.
   * Restores the previous setting afterwards (even on throw).
   *
   * @example
   * await User.withoutTimestamps(() => user.save());
   *
   * @category Timestamps
   */
  static async withoutTimestamps<R>(callback: () => Promise<R> | R): Promise<R> {
    const prev = this.timestamps;
    this.timestamps = false;
    try {
      return await callback();
    } finally {
      this.timestamps = prev;
    }
  }

  /**
   * When true, `prune()` permanently deletes rows (forceDelete) rather than
   * soft-deleting them.
   *
   * @category Persistence
   */
  static massPrune = false;

  /**
   * Override to return the query selecting records eligible for pruning.
   * Implement this to make a model "prunable" (used by `prune()` and a
   * scheduled `model:prune` task).
   *
   * @example
   * static prunable() { return this.query().where('created_at', '<', cutoff); }
   *
   * @category Persistence
   */
  static prunable?<T extends BaseModel>(this: ModelCtor<T>): ModelQueryBuilder<T>;

  /**
   * Delete prunable records in chunks. Returns the number of records pruned.
   * Honours `massPrune` (permanent delete) vs. soft delete.
   *
   * @throws {Error} when the model does not define a static `prunable()` method.
   * @category Persistence
   */
  static async prune<T extends BaseModel>(this: ModelCtor<T>, chunkSize = 1000): Promise<number> {
    if (typeof this.prunable !== "function") {
      throw new Error(`[Zerotal ORM] ${this.name}.prune() requires a static prunable() method.`);
    }
    let total = 0;
    for (;;) {
      const query = (this.prunable as () => ModelQueryBuilder<T>).call(this);
      const rows = await query.limit(chunkSize).get<T>();
      if (rows.length === 0) break;
      for (const row of rows) {
        // massPrune means permanent removal. For soft-delete models that's forceDelete()
        // (from the SoftDeletes mixin); for hard-delete models delete() is already permanent.
        if (this.massPrune && this.softDeletes) {
          await (row as unknown as { forceDelete(): Promise<void> }).forceDelete();
        } else {
          await row.delete();
        }
        total++;
      }
      if (rows.length < chunkSize) break;
    }
    return total;
  }

  // ── Static query entry points ────────────────────────────────────────────

  /**
   * New model query builder with the soft-delete scope
   * (`deleted_at IS NULL`) applied when the model uses soft deletes.
   * Single source of the scope for every static entry point.
   *
   * @internal
   */
  private static _newScopedQuery<T extends BaseModel>(this: ModelCtor<T>): ModelQueryBuilder<T> {
    const qb = new ModelQueryBuilder<T>(this.table, _resolveConn(this), this);
    if (this.softDeletes) qb.whereNull("deleted_at");
    // Everything the caller adds from here on is "theirs", and must be grouped as a unit so an
    // orWhere() cannot split the soft-delete predicate (or a global scope) off its chain.
    qb._markUserWhereStart();
    return qb;
  }

  /**
   * Start a new query builder for this model — the entry point for building
   * `where`/`orderBy`/`with`/etc. chains. Applies the soft-delete scope
   * (`deleted_at IS NULL`) when the model uses soft deletes.
   *
   * @example
   * const posts = await Post.query().where("published", true).orderBy("createdAt", "desc").get();
   *
   * @category Querying
   */
  static query<T extends BaseModel>(this: ModelCtor<T>): ModelQueryBuilder<T> {
    return (this as ModelCtor<T>)._newScopedQuery();
  }

  /**
   * @internal A raw, unscoped model query — no soft-delete (`deleted_at IS NULL`)
   * filter applied. Used by the relation loader to build base related queries
   * (which add their own scoping). The public, soft-delete-aware `withTrashed()` /
   * `onlyTrashed()` live on the `SoftDeletes` mixin.
   */
  static _unscopedQuery<T extends BaseModel>(this: ModelCtor<T>): ModelQueryBuilder<T> {
    return new ModelQueryBuilder<T>(this.table, _resolveConn(this), this);
  }

  // ── Static query shortcuts ─────────────────────────────────────────────────
  // Fluent static entry points so callers can write Post.where(...) or
  // User.count() without spelling out .query() first. Each delegates to query(),
  // so the soft-delete scope and connection resolution are applied consistently.

  /**
   * Start a query constrained by a `WHERE` clause. Pass `(column, value)` for
   * equality or `(column, operator, value)` for any other comparison.
   *
   * @example
   * const recent = await Post.where("views", ">=", 100).get();
   *
   * @category Querying
   */
  static where<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    value: unknown,
  ): ModelQueryBuilder<T>;
  static where<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    operator: WhereOperator,
    value: unknown,
  ): ModelQueryBuilder<T>;
  static where<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    operatorOrValue: unknown,
    value?: unknown,
  ): ModelQueryBuilder<T> {
    const qb = (this as ModelCtor<T>).query();
    return value === undefined
      ? qb.where(column, operatorOrValue)
      : qb.where(column, operatorOrValue as WhereOperator, value);
  }

  /**
   * Start a query constrained by `WHERE column IN (values)`.
   *
   * @category Querying
   */
  static whereIn<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    values: unknown[],
  ): ModelQueryBuilder<T> {
    return (this as ModelCtor<T>).query().whereIn(column, values);
  }

  /**
   * Start a query ordered by `column` (default direction `"asc"`).
   *
   * @category Querying
   */
  static orderBy<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    direction: OrderDirection = "asc",
  ): ModelQueryBuilder<T> {
    return (this as ModelCtor<T>).query().orderBy(column, direction);
  }

  /**
   * Start a query ordered newest-first by `column` (default `"created_at"`).
   *
   * @category Querying
   */
  static latest<T extends BaseModel>(
    this: ModelCtor<T>,
    column = "created_at",
  ): ModelQueryBuilder<T> {
    return (this as ModelCtor<T>).query().latest(column);
  }

  /**
   * Start a query ordered oldest-first by `column` (default `"created_at"`).
   *
   * @category Querying
   */
  static oldest<T extends BaseModel>(
    this: ModelCtor<T>,
    column = "created_at",
  ): ModelQueryBuilder<T> {
    return (this as ModelCtor<T>).query().oldest(column);
  }

  /**
   * Fetch the first row, or `null` when none match.
   *
   * @category Querying
   */
  static first<T extends BaseModel>(this: ModelCtor<T>): Promise<T | null> {
    return (this as ModelCtor<T>).query().first<T>();
  }

  /**
   * Fetch the first row, or throw when none match.
   *
   * @throws {ModelNotFoundError} when no row matches.
   * @category Querying
   */
  static firstOrFail<T extends BaseModel>(this: ModelCtor<T>): Promise<T> {
    return (this as ModelCtor<T>).query().firstOrFail() as Promise<T>;
  }

  /**
   * Count all rows (subject to any global/soft-delete scopes).
   *
   * @category Querying
   */
  static count<T extends BaseModel>(this: ModelCtor<T>): Promise<number> {
    return (this as ModelCtor<T>).query().count();
  }

  /**
   * Find a single row by primary key, or `null` when not found.
   *
   * @category Querying
   */
  static async find<T extends BaseModel>(
    this: ModelCtor<T>,
    id: number | string,
  ): Promise<T | null> {
    return (this as ModelCtor<T>)._newScopedQuery().where(this.primaryKey, id).first<T>();
  }

  /**
   * Find a single row by primary key, or throw when not found.
   *
   * @throws {ModelNotFoundError} when no row has the given primary key.
   *
   * @example
   * const user = await User.findOrFail(ctx.integer("id"));
   *
   * @category Querying
   */
  static async findOrFail<T extends BaseModel>(
    this: ModelCtor<T>,
    id: number | string,
  ): Promise<T> {
    const inst = await (this as ModelCtor<T>).find(id);
    if (inst === null) throw new ModelNotFoundError(this.name, id);
    return inst;
  }

  /**
   * Find the first row where `column` equals `value` (the column name is
   * converted to snake_case), or `null` when none match.
   *
   * @category Querying
   */
  static async findBy<T extends BaseModel>(
    this: ModelCtor<T>,
    column: string,
    value: unknown,
  ): Promise<T | null> {
    return (this as ModelCtor<T>)._newScopedQuery().where(toSnake(column), value).first<T>();
  }

  /**
   * Fetch every row for this model (subject to global/soft-delete scopes).
   *
   * @category Querying
   */
  static async all<T extends BaseModel>(this: ModelCtor<T>): Promise<T[]> {
    return (this as ModelCtor<T>)._newScopedQuery().get<T>();
  }

  /**
   * Fetch one page of rows (subject to global/soft-delete scopes).
   *
   * The page comes from the request in flight — the `?page=` query string, or whatever a
   * server-driven view registered instead — so a controller or a Flow page reads
   * `Post.paginate(10)` and gets the page the user is actually on. Pass `page` to override.
   *
   * @param perPage - Rows per page. Defaults to 15.
   * @param page - 1-based page. Omit to use the request's current page.
   * @param pageName - Which paginator to read, so one page can drive several. Defaults to `"page"`.
   *
   * @example
   * ```ts
   * const posts = await Post.paginate(10);              // ?page= (or the view's page)
   * const invoices = await Invoice.paginate(10, undefined, "invoices"); // a second paginator
   * ```
   *
   * @category Querying
   */
  static async paginate<T extends BaseModel>(
    this: ModelCtor<T>,
    perPage = 15,
    page?: number,
    pageName = "page",
  ): Promise<PaginateResult<T>> {
    return (this as ModelCtor<T>)._newScopedQuery().paginate<T>(perPage, page, pageName);
  }

  /**
   * Mass-assign `data` (respecting {@link fillable} / {@link guarded}) onto a new
   * instance and {@link save} it, returning the persisted model.
   *
   * When the model declares `static fillable` as a literal tuple (`as const`), the
   * payload type is narrowed to exactly those columns — so a column deliberately kept
   * out of `fillable` is neither required nor accepted here, instead of being demanded
   * by the type and rejected by {@link fill} at runtime.
   *
   * @throws {MassAssignmentError} when `data` contains a non-fillable key.
   *
   * @example
   * const user = await User.create({ name: "Ada", email: "ada@example.com" });
   *
   * @category Persistence
   */
  static async create<T extends BaseModel, F extends string = string>(
    this: ModelCtor<T> & { fillable?: readonly F[] | undefined },
    data: FillablePayload<T, F>,
  ): Promise<T> {
    const inst = new this();
    inst.fill(data as UpdatePayload<T>);
    return inst.save() as Promise<T>;
  }

  /**
   * Mass-assign fields, respecting `fillable` / `guarded` protection.
   * Call this instead of `Object.assign` when data comes from user input.
   *
   * **Guarded by default:** a model that declares neither `fillable` nor
   * `guarded` (and is not `unguarded`) rejects every attribute with a
   * `MassAssignmentError`, so a stray key from a request body can never reach
   * the database. Declare `fillable` to allow specific columns, or use
   * {@link forceFill} for trusted, framework-internal writes.
   *
   * Accepts `UpdatePayload<this>` — a partial of the model's writable,
   * non-relation, non-auto-managed columns. Passing `id`, `createdAt`,
   * relations, or methods is a compile-time error.
   *
   * @example
   * post.fill(ctx.body<UpdatePayload<Post>>());
   *
   * @throws {MassAssignmentError} when `data` contains a key not permitted by
   * this model's `fillable` / `guarded` configuration.
   * @category Attributes & mass assignment
   */
  fill(data: UpdatePayload<this>): this {
    const ModelClass = this.constructor as typeof BaseModel;
    // Reactive (json/array) columns are registered at decoration time; install their
    // per-instance accessors now so assignments below go through the reactive setter.
    installReactiveAccessors(this);

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!ModelClass._isFillable(key)) {
        throw new MassAssignmentError(ModelClass.name, key);
      }
      (this as unknown as Record<string, unknown>)[key] = value;
    }
    return this;
  }

  /**
   * True when `key` may be mass-assigned given this model's `fillable` /
   * `guarded` / `unguarded` configuration. Precedence: `unguarded` (all) →
   * `fillable` (allowlist) → `guarded` (denylist) → guarded-by-default (none).
   *
   * @internal
   */
  static _isFillable(key: string): boolean {
    // An explicit allow/deny list is always honoured, even under global unguard.
    if (this.fillable !== undefined) return this.fillable.includes(key);
    if (this.guarded !== undefined) return !this.guarded.includes(key);
    if (this.unguarded || BaseModel._unguardedGlobally) return true;
    // Neither list declared and not unguarded → guard everything.
    return false;
  }

  /**
   * Mass-assign fields **bypassing** `fillable` / `guarded` protection.
   * Use only for trusted data you construct yourself (framework-internal
   * writes, factories, seeders) — never for request input.
   *
   * @example
   * // Trusted, non-user data:
   * role.forceFill({ name, guard });
   *
   * @category Attributes & mass assignment
   */
  forceFill(data: Record<string, unknown>): this {
    installReactiveAccessors(this);
    for (const [key, value] of Object.entries(data)) {
      (this as unknown as Record<string, unknown>)[key] = value;
    }
    return this;
  }

  /**
   * Like {@link create}, but bypasses mass-assignment protection. Use only for
   * trusted data (framework-internal writes, seeders), never for request input.
   *
   * @category Persistence
   */
  static async forceCreate<T extends BaseModel>(
    this: ModelCtor<T>,
    data: Record<string, unknown>,
  ): Promise<T> {
    const inst = new this();
    inst.forceFill(data);
    return inst.save() as Promise<T>;
  }

  /**
   * Return the first row matching `search`, or {@link create} one from
   * `search` merged with `create`.
   *
   * @throws {MassAssignmentError} when a created key is not fillable.
   * @category Persistence
   */
  static async firstOrCreate<T extends BaseModel>(
    this: ModelCtor<T>,
    search: UpdatePayload<T>,
    create?: UpdatePayload<T>,
  ): Promise<T> {
    const qb = (this as ModelCtor<T>)._newScopedQuery();
    for (const [k, v] of Object.entries(search as Record<string, unknown>)) {
      qb.where(toSnake(k), v);
    }
    const existing = await qb.first<T>();
    if (existing) return existing;
    return (this as ModelCtor<T>).create<T>({
      ...search,
      ...(create ?? {}),
    } as InsertPayload<T>);
  }

  /**
   * Update the first row matching `search`, or create it. Returns the model.
   *
   * @example
   * await User.updateOrCreate({ email }, { name, lastSeenAt: new Date() });
   *
   * @throws {MassAssignmentError} when an updated/created key is not fillable.
   * @category Persistence
   */
  static async updateOrCreate<T extends BaseModel>(
    this: ModelCtor<T>,
    search: UpdatePayload<T>,
    values?: UpdatePayload<T>,
  ): Promise<T> {
    const qb = (this as ModelCtor<T>)._newScopedQuery();
    for (const [k, v] of Object.entries(search as Record<string, unknown>)) {
      qb.where(toSnake(k), v);
    }
    const existing = await qb.first<T>();
    if (existing) {
      existing.fill((values ?? {}) as UpdatePayload<T>);
      return existing.save() as Promise<T>;
    }
    return (this as ModelCtor<T>).create<T>({
      ...search,
      ...(values ?? {}),
    } as InsertPayload<T>);
  }

  /**
   * Return the first row matching `search`, or a new **unsaved** instance
   * filled with `search` + `values`.
   *
   * @throws {MassAssignmentError} when a filled key is not fillable.
   * @category Persistence
   */
  static async firstOrNew<T extends BaseModel>(
    this: ModelCtor<T>,
    search: UpdatePayload<T>,
    values?: UpdatePayload<T>,
  ): Promise<T> {
    const qb = (this as ModelCtor<T>)._newScopedQuery();
    for (const [k, v] of Object.entries(search as Record<string, unknown>)) {
      qb.where(toSnake(k), v);
    }
    const existing = await qb.first<T>();
    if (existing) return existing;
    const inst = new this();
    inst.fill({ ...search, ...(values ?? {}) } as UpdatePayload<T>);
    return inst;
  }

  /**
   * Find by primary key, or return a new **unsaved** instance if not found.
   *
   * @category Persistence
   */
  static async findOrNew<T extends BaseModel>(this: ModelCtor<T>, id: number | string): Promise<T> {
    const found = await (this as ModelCtor<T>).find(id);
    if (found) return found;
    return new this();
  }

  /**
   * Create multiple rows one at a time, returning the saved model instances.
   * Each row goes through the full `save()` path — casts, hashing, timestamps,
   * and observer/hook events all fire per row.
   *
   * For large bulk loads where per-row events are not needed, prefer
   * {@link bulkInsert} which issues a single multi-row INSERT.
   *
   * @throws {MassAssignmentError} when any record contains a non-fillable key.
   * @category Persistence
   */
  static async createMany<T extends BaseModel>(
    this: ModelCtor<T>,
    records: InsertPayload<T>[],
  ): Promise<T[]> {
    const out: T[] = [];
    for (const r of records) out.push(await (this as ModelCtor<T>).create<T>(r));
    return out;
  }

  /**
   * Insert many rows in a single multi-row `INSERT`, returning the number of
   * rows written. Applies casts and timestamps but bypasses per-row `save()`
   * lifecycle hooks — the fast path for bulk loads. Use {@link createMany} when
   * you need hooks/observers per row.
   *
   * @returns the number of rows inserted (`0` for an empty input).
   * @category Persistence
   */
  static async bulkInsert<T extends BaseModel>(
    this: ModelCtor<T>,
    records: InsertPayload<T>[],
  ): Promise<number> {
    if (records.length === 0) return 0;

    const ModelClass = this as unknown as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const dialect = dialectFor(conn as unknown as object);
    const casts = getCasts(ModelClass as unknown as ClassRef);
    const colReg = columnsFor(ModelClass as unknown as ClassRef);
    const useTs = ModelClass.timestamps;

    const rows: Record<string, unknown>[] = _writeDialect.run(dialect, () => {
      const now = _serializeDate(new Date());
      return records.map((rec) => {
        const row: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(rec as Record<string, unknown>)) {
          if (key.startsWith("_")) continue;
          row[toSnake(key)] = _serializeForWrite(key, val, casts, colReg, ModelClass.name);
        }
        if (useTs) {
          row["created_at"] = now;
          row["updated_at"] = now;
        }
        return row;
      });
    });

    const colSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
    const cols = [...colSet];
    for (const c of cols) _assertIdentifier(c, "bulkInsert()");

    const segs: Seg[] = [`INSERT INTO ${ModelClass.table} (${cols.join(", ")}) VALUES `];
    rows.forEach((r, ri) => {
      if (ri > 0) segs.push(", ");
      segs.push("(");
      cols.forEach((c, ci) => {
        if (ci > 0) segs.push(", ");
        segs.push({ val: c in r ? r[c] : null });
      });
      segs.push(")");
    });

    await runSegs(conn, segs);
    return rows.length;
  }

  /**
   * Persist multiple already-built instances (each via {@link save}).
   *
   * @category Persistence
   */
  static async saveMany<T extends BaseModel>(this: ModelCtor<T>, models: T[]): Promise<T[]> {
    for (const m of models) await m.save();
    return models;
  }

  /**
   * Fetch many rows by an array of primary keys.
   *
   * @category Querying
   */
  static async findMany<T extends BaseModel>(
    this: ModelCtor<T>,
    ids: (number | string)[],
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    return (this as ModelCtor<T>)._newScopedQuery().whereIn(this.primaryKey, ids).get<T>();
  }

  /**
   * INSERT a row; update specified columns when the unique constraint fires.
   *
   * - PostgreSQL / SQLite: `ON CONFLICT (conflictKeys) DO UPDATE SET …`
   * - MySQL: `ON DUPLICATE KEY UPDATE … = VALUES(…)`
   *
   * @param data         Row data (camelCase keys are converted to snake_case)
   * @param conflictKeys Columns that define the conflict constraint (ignored on MySQL)
   * @param updateCols   Columns to overwrite on conflict (defaults to all non-conflict cols)
   *
   * @example
   * await User.upsert({ email: 'a@b.com', name: 'Alice' }, ['email'], ['name']);
   *
   * @category Persistence
   */
  static async upsert<T extends BaseModel>(
    this: ModelCtor<T>,
    data: InsertPayload<T>,
    conflictKeys: (keyof T & string)[],
    updateCols?: (keyof T & string)[],
  ): Promise<void> {
    const conn = _resolveConn(this);
    const dialect = dialectFor(conn as unknown as object);
    const casts = getCasts(this as unknown as ClassRef);
    const colReg = columnsFor(this as unknown as ClassRef);

    const row: Record<string, unknown> = _writeDialect.run(dialect, () => {
      const r: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
        r[toSnake(key)] = _serializeForWrite(key, val, casts, colReg, this.name);
      }
      return r;
    });

    const cols = Object.keys(row);
    const vals = Object.values(row);
    if (cols.length === 0) return;

    const conflictSnake = conflictKeys.map(toSnake);
    const targetCols = updateCols
      ? updateCols.map(toSnake)
      : cols.filter((c) => !conflictSnake.includes(c));

    if (targetCols.length === 0) return;

    for (const c of cols) _assertIdentifier(c, "upsert()");
    for (const c of conflictSnake) _assertIdentifier(c, "upsert()");
    for (const c of targetCols) _assertIdentifier(c, "upsert()");

    const segs: Seg[] = [`INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (`];
    vals.forEach((v, i) => {
      if (i > 0) segs.push(", ");
      segs.push({ val: v });
    });
    segs.push(")");

    if (dialect === "mysql") {
      segs.push(" ON DUPLICATE KEY UPDATE ");
      targetCols.forEach((col, i) => {
        if (i > 0) segs.push(", ");
        segs.push(`${col} = VALUES(${col})`);
      });
    } else {
      // PostgreSQL + SQLite
      segs.push(` ON CONFLICT (${conflictSnake.join(", ")}) DO UPDATE SET `);
      targetCols.forEach((col, i) => {
        if (i > 0) segs.push(", ");
        segs.push(`${col} = EXCLUDED.${col}`);
      });
    }

    await runSegs(conn, segs);
  }

  /**
   * Define a named query scope with typed arguments.
   * Assign to a static property; apply via .withScopes(s => s.active()).
   *
   * @example
   * static active  = BaseModel.scope((q) => q.where('active', 1));
   * static byScore = BaseModel.scope((q, min: number) => q.where('score', '>=', min));
   *
   * @category Querying
   */
  static scope<Args extends unknown[]>(
    fn: (query: QueryBuilder, ...args: Args) => void,
  ): (...args: Args) => ScopeApplicator {
    return (...args: Args) => ({ apply: (q: QueryBuilder) => fn(q, ...args) });
  }

  // ── Instance methods ─────────────────────────────────────────────────────

  /**
   * Persist this instance: `INSERT` when new, or `UPDATE` of only the dirty
   * columns when it already exists. Applies casts, hashes {@link hashable}
   * fields, maintains timestamps, and runs the save/create/update lifecycle
   * hooks. On insert the new primary key (and full row) are read back onto the
   * instance. Returns `this`.
   *
   * @example
   * const user = new User();
   * user.fill({ name: "Ada", email: "ada@example.com" });
   * await user.save();
   *
   * @category Persistence
   */
  async save(): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const dialect = dialectFor(conn as unknown as object);
    const rels = relNames(ModelClass as unknown as ClassRef);
    const casts = getCasts(ModelClass as unknown as ClassRef);

    await HookRegistry.run(ModelClass, "beforeSave", this);

    // ── Auto-hash hashable fields ─────────────────────────────────────────
    // On INSERT: hash every hashable field that holds a non-empty string.
    // On UPDATE: only hash hashable fields whose value changed since the last
    //            save (avoids re-hashing an already-stored bcrypt hash).
    // One keyed view of the instance for the whole method: the hashable pass and the
    // insert's default-filling both need to read and write columns by name.
    const self = this as unknown as Record<string, unknown>;

    const hashable = ModelClass.hashable;
    if (hashable && hashable.length > 0) {
      if (!this._exists) {
        for (const key of hashable) {
          const val = self[key];
          if (typeof val === "string" && val.length > 0) {
            self[key] = await Bun.password.hash(val);
          }
        }
      } else {
        const orig = this._original as Record<string, unknown>;
        for (const key of hashable) {
          const current = self[key];
          if (typeof current === "string" && current.length > 0 && current !== orig[key]) {
            self[key] = await Bun.password.hash(current);
          }
        }
      }
    }

    const colReg = columnsFor(ModelClass as unknown as ClassRef);
    const colKeys = _allColumnKeys(ModelClass as unknown as ClassRef);

    if (!this._exists) {
      // ── INSERT ──
      await HookRegistry.run(ModelClass, "beforeCreate", this);

      const row: Record<string, unknown> = _writeDialect.run(dialect, () => {
        const r: Record<string, unknown> = {};
        for (const [key, val] of ownDataEntries(this, SYSTEM_KEYS, rels, colKeys)) {
          // A declared field that was never assigned is `undefined`, and writing that
          // as an explicit NULL made `@column({ default: … })` inert: the INSERT named
          // the column, so the database never applied its own default and a NOT NULL
          // column failed outright. Fall back to the declared default, and if there
          // isn't one, omit the column entirely so the database decides.
          //
          // Only `undefined` is treated this way. An explicit `null` is a deliberate
          // "store NULL" and still writes one.
          let effective = val;
          if (effective === undefined) {
            const declared = colReg?.get(key)?.default;
            if (declared === undefined) continue; // omit → database default / NULL
            effective = typeof declared === "function" ? (declared as () => unknown)() : declared;
            // Keep the instance consistent with the row we are about to write, so the
            // value is readable straight after save() without a reload.
            self[key] = effective;
          }
          r[toSnake(key)] = _serializeForWrite(key, effective, casts, colReg, ModelClass.name);
        }
        if (ModelClass.timestamps) {
          const now = _serializeDate(new Date());
          r["created_at"] = now;
          r["updated_at"] = now;
        }
        return r;
      });

      const cols = Object.keys(row);
      const vals = Object.values(row);
      for (const c of cols) _assertIdentifier(c, "save()");
      const segs: Seg[] = [`INSERT INTO ${ModelClass.table} (${cols.join(", ")}) VALUES (`];
      vals.forEach((v, i) => {
        if (i > 0) segs.push(", ");
        segs.push({ val: v });
      });
      segs.push(")");

      let newId: number;
      if (dialect === "postgres") {
        segs.push(` RETURNING ${ModelClass.primaryKey}`);
        const [returning] = await runQuery<Record<string, number>>(conn, segs);
        newId = returning![ModelClass.primaryKey as string] as number;
      } else if (dialect === "mysql") {
        // LAST_INSERT_ID() is scoped per connection, so the INSERT and the
        // SELECT must be pinned to the SAME connection — under concurrency a
        // pool may otherwise hand the SELECT to a different connection and
        // return another insert's id. Inside a transaction the connection is
        // already pinned; otherwise reserve a dedicated connection from the
        // pool (falling back to a short transaction when reserve() is
        // unavailable).
        // _serializeDate() guarantees MySQL DATETIME format ('YYYY-MM-DD HH:MM:SS').
        const insertAndReadId = async (c: SQLInstance): Promise<number> => {
          await runSegs(c, segs);
          const [lastRow] = await runQuery<{ id: number }>(c, ["SELECT LAST_INSERT_ID() as id"]);
          return lastRow!.id;
        };
        const inTx =
          TransactionContext.getStore() !== undefined ||
          RequestContext.tryGet()?._transaction !== undefined;
        const reservable = conn as unknown as {
          reserve?: () => Promise<SQLInstance & { release(): void }>;
        };
        if (inTx) {
          newId = await insertAndReadId(conn);
        } else if (typeof reservable.reserve === "function") {
          const pinned = await reservable.reserve();
          try {
            newId = await insertAndReadId(pinned);
          } finally {
            pinned.release();
          }
        } else {
          newId = await conn.begin((tx) => insertAndReadId(tx));
        }
      } else {
        await runSegs(conn, segs);
        const [lastRow] = await runQuery<{ id: number }>(conn, [
          "SELECT last_insert_rowid() as id",
        ]);
        newId = lastRow!.id;
      }

      const rows = await runQuery<Record<string, unknown>>(conn, [
        `SELECT * FROM ${ModelClass.table} WHERE ${ModelClass.primaryKey} = `,
        { val: newId },
      ]);
      if (rows[0]) _applyRow(this, rows[0]);

      await HookRegistry.run(ModelClass, "afterCreate", this);
    } else {
      // ── UPDATE — only dirty columns ──
      await HookRegistry.run(ModelClass, "beforeUpdate", this);

      const dirty = this.$dirty();
      if (ModelClass.timestamps) dirty["updatedAt"] = new Date();

      if (Object.keys(dirty).length > 0) {
        const entries = _writeDialect.run(dialect, () =>
          Object.entries(dirty).map(
            ([k, v]) =>
              [toSnake(k), _serializeForWrite(k, v, casts, colReg, ModelClass.name)] as [
                string,
                unknown,
              ],
          ),
        );
        const segs: Seg[] = [`UPDATE ${ModelClass.table} SET `];
        entries.forEach(([col, val], i) => {
          _assertIdentifier(col, "save()");
          if (i > 0) segs.push(", ");
          segs.push(`${col} = `);
          segs.push({ val });
        });
        segs.push(` WHERE ${ModelClass.primaryKey} = `);
        segs.push({ val: this.id });
        await runSegs(conn, segs);

        const self = this as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(dirty)) self[k] = v;
        Object.assign(this._original, dirty);
      }

      await HookRegistry.run(ModelClass, "afterUpdate", this);
    }

    this._forcedDirty.clear();
    await HookRegistry.run(ModelClass, "afterSave", this);
    return this;
  }

  /**
   * Delete this record. For soft-delete models this sets `deleted_at` (the row
   * stays in the table but is hidden from default queries); otherwise it issues
   * a hard `DELETE`. Runs the before/after delete lifecycle hooks.
   *
   * @category Persistence
   */
  async delete(): Promise<void> {
    const ModelClass = this.constructor as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const dialect = dialectFor(conn as unknown as object);

    await HookRegistry.run(ModelClass, "beforeDelete", this);

    if (ModelClass.softDeletes) {
      const now = new Date();
      await runSegs(conn, [
        `UPDATE ${ModelClass.table} SET deleted_at = `,
        { val: _writeDialect.run(dialect, () => _serializeDate(now)) },
        ` WHERE ${ModelClass.primaryKey} = `,
        { val: this.id },
      ]);
      // `deletedAt` lives on the SoftDeletes mixin; this branch only runs for models
      // that compose it (softDeletes === true).
      (this as { deletedAt?: Date | null }).deletedAt = now;
    } else {
      await runSegs(conn, [
        `DELETE FROM ${ModelClass.table} WHERE ${ModelClass.primaryKey} = `,
        { val: this.id },
      ]);
    }

    await HookRegistry.run(ModelClass, "afterDelete", this);
  }

  /**
   * Eager-load the given relations onto this already-fetched model instance.
   * If a relation is already loaded, it is reloaded.
   *
   * @example
   * const post = await Post.find(1);
   * await post.load(['comments', 'tags']);
   * // post.comments is now populated
   *
   * @category Relationships
   */
  async load(relations: string[]): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const qb = new ModelQueryBuilder(ModelClass.table, _resolveConn(ModelClass), ModelClass);
    for (const rel of relations) qb.with(rel as never);
    // _eagerLoadRelations is private on ModelQueryBuilder; use the public approach
    // by fetching from the QB's internal method via a single-item array
    await (
      qb as unknown as {
        _eagerLoadRelations(instances: BaseModel[]): Promise<void>;
      }
    )._eagerLoadRelations([this]);
    return this;
  }

  /**
   * Like load(), but skips relations that are already loaded on this instance.
   *
   * @example
   * await post.loadMissing(['comments']); // no-op if comments already loaded
   *
   * @category Relationships
   */
  async loadMissing(relations: string[]): Promise<this> {
    // A loaded relation is a plain data property (no getter).
    // An unloaded relation has a lazy-load getter that throws RelationNotLoadedError.
    const missing = relations.filter((rel) => {
      const desc = Object.getOwnPropertyDescriptor(this, rel);
      // If descriptor has a getter, the relation is not yet loaded
      return !desc || typeof desc.get === "function";
    });
    if (missing.length > 0) await this.load(missing);
    return this;
  }

  /**
   * Re-read this record from the database and return it as a **new** instance,
   * leaving the current one untouched. Use {@link refresh} to mutate in place.
   *
   * @throws {ModelNotFoundError} when the row no longer exists.
   * @category Persistence
   */
  async fresh(): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const rows = await runQuery<Record<string, unknown>>(conn, [
      `SELECT * FROM ${ModelClass.table} WHERE ${ModelClass.primaryKey} = `,
      { val: this.id },
    ]);
    if (!rows[0]) throw new ModelNotFoundError(ModelClass.name, this.id);
    return ModelClass.fromRow(rows[0]) as this;
  }

  /**
   * Reload this instance's attributes from the database, mutating it in place.
   * Unlike `fresh()` (which returns a new instance) this updates `this`.
   *
   * @throws {ModelNotFoundError} when the row no longer exists.
   * @category Persistence
   */
  async refresh(): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const rows = await runQuery<Record<string, unknown>>(conn, [
      `SELECT * FROM ${ModelClass.table} WHERE ${ModelClass.primaryKey} = `,
      { val: this.id },
    ]);
    if (!rows[0]) throw new ModelNotFoundError(ModelClass.name, this.id);
    _applyRow(this, rows[0]);
    return this;
  }

  /**
   * Copy this model into a new **unsaved** instance. The primary key and
   * timestamps are not copied; pass `except` to omit additional columns.
   *
   * @category Persistence
   */
  replicate(except?: string[]): this {
    const ModelClass = this.constructor as typeof BaseModel;
    const rels = relNames(ModelClass as unknown as ClassRef);
    const colKeys = _allColumnKeys(ModelClass as unknown as ClassRef);
    const skip = new Set<string>([...SYSTEM_KEYS, ...(except ?? [])]);
    const inst = new (this.constructor as new () => this)();
    for (const [k, v] of ownDataEntries(this, skip, rels, colKeys)) {
      (inst as unknown as Record<string, unknown>)[k] = v;
    }
    return inst;
  }

  /**
   * Bump `updated_at` to now and persist. No-op when timestamps are disabled.
   *
   * @category Timestamps
   */
  async touch(): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    if (!ModelClass.timestamps) return this;
    this.updatedAt = new Date();
    this.markDirty("updatedAt" as keyof this);
    return this.save();
  }

  /**
   * True when `other` is the same model class with the same primary key.
   *
   * @category Comparison
   */
  is(other: BaseModel | null | undefined): boolean {
    if (!other) return false;
    if (other.constructor !== this.constructor) return false;
    const pk = toCamel((this.constructor as typeof BaseModel).primaryKey);
    return (
      (other as unknown as Record<string, unknown>)[pk] ===
      (this as unknown as Record<string, unknown>)[pk]
    );
  }

  /**
   * Inverse of {@link is}.
   *
   * @category Comparison
   */
  isNot(other: BaseModel | null | undefined): boolean {
    return !this.is(other);
  }

  /**
   * Atomically increment a column in the DB and on this instance.
   *
   * @category Persistence
   */
  async increment(column: keyof this & string, amount = 1): Promise<this> {
    return this._stepColumn(column, amount);
  }

  /**
   * Atomically decrement a column in the DB and on this instance.
   *
   * @category Persistence
   */
  async decrement(column: keyof this & string, amount = 1): Promise<this> {
    return this._stepColumn(column, -amount);
  }

  /** @internal Shared implementation of {@link increment} / {@link decrement}. */
  private async _stepColumn(column: string, delta: number): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const conn = _resolveConn(ModelClass);
    const col = toSnake(column);
    _assertIdentifier(col, "increment()/decrement()");
    const op = delta >= 0 ? "+" : "-";
    await runSegs(conn, [
      `UPDATE ${ModelClass.table} SET ${col} = ${col} ${op} `,
      { val: Math.abs(delta) },
      ` WHERE ${ModelClass.primaryKey} = `,
      { val: this.id },
    ]);
    const self = this as unknown as Record<string, unknown>;
    const current = Number(self[column] ?? 0);
    self[column] = current + delta;
    (this._original as Record<string, unknown>)[column] = self[column];
    return this;
  }

  /**
   * Load relation COUNT(s) onto this instance (sets `<rel>Count`).
   *
   * @category Relationships
   */
  async loadCount(relations: string | string[]): Promise<this> {
    const rels = Array.isArray(relations) ? relations : [relations];
    const ModelClass = this.constructor as typeof BaseModel;
    const qb = new ModelQueryBuilder(ModelClass.table, _resolveConn(ModelClass), ModelClass);
    qb.where(ModelClass.primaryKey, this.id);
    for (const r of rels) qb.withCount(r);
    const fresh = (await qb.limit(1).get<BaseModel>())[0] ?? null;
    const src = fresh as unknown as Record<string, unknown> | null;
    const self = this as unknown as Record<string, unknown>;
    for (const r of rels) {
      const key = `${toCamel(r)}Count`;
      self[key] = src?.[key] ?? 0;
    }
    return this;
  }

  /**
   * Load relation COUNT(s) for an array of already-fetched models in a SINGLE
   * query (no N+1), setting `<rel>Count` on each — prefer this over calling the
   * instance `loadCount()` in a loop.
   *
   * @example
   * const posts = await Post.all();
   * await Post.loadCount(posts, "comments");
   * posts[0]!.commentsCount;
   *
   * @category Relationships
   */
  static async loadCount<T extends BaseModel>(
    this: typeof BaseModel,
    models: T[],
    relations: string | string[],
  ): Promise<T[]> {
    if (models.length === 0) return models;
    const rels = Array.isArray(relations) ? relations : [relations];
    const idOf = (m: T): unknown => (m as unknown as { id: unknown }).id;

    const qb = new ModelQueryBuilder(this.table, _resolveConn(this), this);
    qb.whereIn(this.primaryKey, models.map(idOf));
    for (const r of rels) qb.withCount(r);
    const fresh = await qb.get<BaseModel>();

    const byId = new Map<unknown, Record<string, unknown>>();
    for (const f of fresh) byId.set((f as unknown as { id: unknown }).id, f as never);

    for (const m of models) {
      const src = byId.get(idOf(m));
      const rec = m as unknown as Record<string, unknown>;
      for (const r of rels) {
        const key = countAttribute(r);
        rec[key] = src?.[key] ?? 0;
      }
    }
    return models;
  }

  /** @internal Shared implementation of {@link loadSum} / {@link loadAvg} / {@link loadMin} / {@link loadMax}. */
  private async _loadAgg(
    fn: "Sum" | "Avg" | "Min" | "Max",
    relation: string,
    column: string,
  ): Promise<this> {
    const ModelClass = this.constructor as typeof BaseModel;
    const qb = new ModelQueryBuilder(ModelClass.table, _resolveConn(ModelClass), ModelClass);
    qb.where(ModelClass.primaryKey, this.id);
    (qb as unknown as Record<string, (r: string, c: string) => void>)[`with${fn}`]?.(
      relation,
      column,
    );
    const fresh = (await qb.limit(1).get<BaseModel>())[0] ?? null;
    // Attribute name matches the eager path, e.g. commentsSumVotes.
    const key = aggregateAttribute(relation, fn, column);
    (this as unknown as Record<string, unknown>)[key] =
      (fresh as unknown as Record<string, unknown> | null)?.[key] ?? 0;
    return this;
  }

  /**
   * Load `SUM(column)` over a relation onto this instance (sets `<rel>Sum<Column>`).
   *
   * @category Relationships
   */
  loadSum(relation: string, column: string): Promise<this> {
    return this._loadAgg("Sum", relation, column);
  }
  /**
   * Load `AVG(column)` over a relation onto this instance (sets `<rel>Avg<Column>`).
   *
   * @category Relationships
   */
  loadAvg(relation: string, column: string): Promise<this> {
    return this._loadAgg("Avg", relation, column);
  }
  /**
   * Load `MIN(column)` over a relation onto this instance (sets `<rel>Min<Column>`).
   *
   * @category Relationships
   */
  loadMin(relation: string, column: string): Promise<this> {
    return this._loadAgg("Min", relation, column);
  }
  /**
   * Load `MAX(column)` over a relation onto this instance (sets `<rel>Max<Column>`).
   *
   * @category Relationships
   */
  loadMax(relation: string, column: string): Promise<this> {
    return this._loadAgg("Max", relation, column);
  }

  /**
   * Hide additional keys from `toJSON()` for this instance only.
   *
   * @category Serialization
   */
  makeHidden(...keys: string[]): this {
    const self = this as unknown as { _instanceHidden?: Set<string> };
    self._instanceHidden = new Set([...(self._instanceHidden ?? []), ...keys]);
    return this;
  }

  /**
   * Reveal keys that are hidden by the class `hidden` list, for this instance only.
   *
   * @category Serialization
   */
  makeVisible(...keys: string[]): this {
    const self = this as unknown as { _instanceVisible?: Set<string> };
    self._instanceVisible = new Set([...(self._instanceVisible ?? []), ...keys]);
    return this;
  }

  /**
   * Add computed accessor name(s) to this instance's `toJSON()` output.
   *
   * @category Serialization
   */
  append(...keys: string[]): this {
    const self = this as unknown as { _instanceAppends?: string[] };
    self._instanceAppends = [...(self._instanceAppends ?? []), ...keys];
    return this;
  }

  /**
   * Set this model's belongsTo foreign key to `model` and cache the relation.
   * Does not persist — call `save()` afterwards.
   *
   * @example
   * comment.associate('post', post);
   * await comment.save();
   *
   * @throws {Error} when `relation` is not a `belongsTo` relation on this model.
   * @category Relationships
   */
  associate(relation: string, model: BaseModel): this {
    const meta = relationsFor(this.constructor as ClassRef).get(relation);
    if (!meta || meta.type !== "belongsTo") {
      throw new Error(
        `associate(): "${relation}" is not a belongsTo relation on ${this.constructor.name}`,
      );
    }
    const fkProp = toCamel(meta.foreignKey);
    const ownerKeyProp = toCamel(meta.localKey);
    (this as unknown as Record<string, unknown>)[fkProp] = (
      model as unknown as Record<string, unknown>
    )[ownerKeyProp];
    Object.defineProperty(this, relation, {
      value: model,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return this;
  }

  /**
   * Clear this model's belongsTo foreign key and cached relation.
   *
   * @throws {Error} when `relation` is not a `belongsTo` relation on this model.
   * @category Relationships
   */
  dissociate(relation: string): this {
    const meta = relationsFor(this.constructor as ClassRef).get(relation);
    if (!meta || meta.type !== "belongsTo") {
      throw new Error(
        `dissociate(): "${relation}" is not a belongsTo relation on ${this.constructor.name}`,
      );
    }
    const fkProp = toCamel(meta.foreignKey);
    (this as unknown as Record<string, unknown>)[fkProp] = null;
    Object.defineProperty(this, relation, {
      value: null,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return this;
  }

  /**
   * True when the model (or a specific `column`) has unsaved changes since it
   * was loaded or last saved.
   *
   * @category Attributes & mass assignment
   */
  isDirty(column?: string): boolean {
    if (column) {
      const current = (this as unknown as Record<string, unknown>)[column];
      const original = this._original[column];
      return current !== original || this._forcedDirty.has(column);
    }
    return Object.keys(this.$dirty()).length > 0;
  }

  /**
   * Return a map of changed columns to their current values — the set that a
   * subsequent {@link save} would write.
   *
   * @category Attributes & mass assignment
   */
  $dirty(): Record<string, unknown> {
    const ModelClass = this.constructor as typeof BaseModel;
    const rels = relNames(ModelClass as unknown as ClassRef);
    const colKeys = _allColumnKeys(ModelClass as unknown as ClassRef);
    const out: Record<string, unknown> = {};
    for (const [key, val] of ownDataEntries(this, SYSTEM_KEYS, rels, colKeys)) {
      if (val !== this._original[key] || this._forcedDirty.has(key)) {
        out[key] = val;
      }
    }
    return out;
  }

  /**
   * Force a property to be treated as dirty so it is included in the next
   * {@link save}, even if its value is reference-equal to the loaded snapshot
   * (e.g. an in-place mutation of a JSON column).
   *
   * @category Attributes & mass assignment
   */
  markDirty(property: keyof this): this {
    this._forcedDirty.add(String(property));
    return this;
  }

  /**
   * Called automatically by JSON.stringify — returns a plain object containing
   * only user-facing data:
   *
   *  • All column values and loaded relation instances (enumerable own props)
   *  • Excludes internal ORM state: _original, _exists, _forcedDirty, _zerotal_*
   *  • Excludes any remaining getter guards (unloaded relation lazy-load traps)
   *
   * Nested model instances (e.g. post.author) also have toJSON(), so
   * JSON.stringify recurses correctly through the full object graph.
   *
   * @category Serialization
   */
  toJSON(): Record<string, unknown> {
    const ModelClass = this.constructor as typeof BaseModel;
    const self = this as unknown as {
      _instanceHidden?: Set<string>;
      _instanceVisible?: Set<string>;
      _instanceAppends?: string[];
    };

    const instVisible = self._instanceVisible ?? new Set<string>();
    // Effective hidden = class hidden + per-instance hidden − per-instance visible.
    const hidden = new Set<string>([...(ModelClass.hidden ?? []), ...(self._instanceHidden ?? [])]);
    for (const k of instVisible) hidden.delete(k);

    // The allow-list is a *class-level* opt-in. `makeVisible()` un-hides a key; it does not
    // create an allow-list where the class had none — otherwise, with `static visible` empty
    // (the normal case), one `makeVisible("password")` would reduce the whole payload to
    // exactly that field. The per-instance set only extends an allow-list the class already
    // declared.
    const classVisible = ModelClass.visible ?? [];
    const visible =
      classVisible.length > 0 ? new Set<string>([...classVisible, ...instVisible]) : null;

    const include = (key: string): boolean => {
      if (hidden.has(key)) return false;
      if (visible && !visible.has(key)) return false;
      return true;
    };

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      if (key.startsWith("_")) continue;
      if (!include(key)) continue;
      const desc = Object.getOwnPropertyDescriptor(this, key);
      if (desc && typeof desc.get === "function") {
        // Skip lazy-load relation guards — reading one throws RelationNotLoadedError — but
        // INCLUDE reactive column accessors. `installReactiveAccessors` defines a getter for
        // every `cast: "json" | "array"` column, so the blanket skip silently dropped every
        // such column from toJSON(): persistence still worked, but the field vanished from API
        // responses, cache writes and queue payloads with no error. A `_zerotal_<key>` backing
        // data property is what distinguishes the two. `ownDataEntries` (see above) already
        // draws exactly this distinction; toJSON did not.
        if (!Object.prototype.hasOwnProperty.call(this, `_zerotal_${key}`)) continue;
      }
      out[key] = (this as Record<string, unknown>)[key];
    }

    // Computed accessors declared via `static appends` / instance `append()`.
    const appends = [...(ModelClass.appends ?? []), ...(self._instanceAppends ?? [])];
    for (const name of appends) {
      if (!include(name)) continue;
      out[name] = (this as unknown as Record<string, unknown>)[name];
    }

    return out;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Build a model instance from a raw database row, applying casts and marking
   * it as DB-resident. Primarily used internally by the query builder.
   *
   * @internal
   */
  static fromRow(row: Record<string, unknown>): BaseModel {
    const inst = new this();
    _applyRow(inst, row);
    return inst;
  }
}

// ── Module-private helpers ───────────────────────────────────────────────────

/**
 * Returns a ManyToMany<never> pivot proxy for an *unloaded* manyToMany relation.
 *
 * The pivot methods (attach / detach / sync / toggle) work immediately using
 * the parent model's primary key — no need to eager-load the relation first.
 * Any array access (length, iteration, indexing) throws RelationNotLoadedError,
 * preserving the same contract as other unloaded relations.
 */
function _createLazyPivotProxy(
  relName: string,
  modelName: string,
  pivotTable: string,
  pivotForeignKey: string,
  pivotRelatedKey: string,
  parentId: unknown,
): ManyToMany<never> {
  return new Proxy([] as unknown as ManyToMany<never>, {
    get(_: ManyToMany<never>, prop: string | symbol): unknown {
      switch (prop) {
        case "attach":
          return async (id: number | number[]): Promise<void> => {
            const ids = Array.isArray(id) ? id : [id];
            const conn = _resolveConn();
            for (const relId of ids) {
              await new QueryBuilder(pivotTable, conn).insert({
                [pivotForeignKey]: parentId,
                [pivotRelatedKey]: relId,
              });
            }
          };
        case "detach":
          return async (id?: number | number[]): Promise<void> => {
            const conn = _resolveConn();
            const qb = new QueryBuilder(pivotTable, conn).where(pivotForeignKey, parentId);
            if (id !== undefined) {
              const ids = Array.isArray(id) ? id : [id];
              qb.whereIn(pivotRelatedKey, ids as unknown[]);
            }
            await qb.delete();
          };
        case "sync":
          return async (ids: number[]): Promise<void> => {
            const conn = _resolveConn();
            await new QueryBuilder(pivotTable, conn).where(pivotForeignKey, parentId).delete();
            for (const relId of ids) {
              await new QueryBuilder(pivotTable, conn).insert({
                [pivotForeignKey]: parentId,
                [pivotRelatedKey]: relId,
              });
            }
          };
        case "toggle":
          return async (id: number | number[]): Promise<void> => {
            const conn = _resolveConn();
            const ids = Array.isArray(id) ? id : [id];
            for (const relId of ids) {
              const existing = await new QueryBuilder(pivotTable, conn)
                .where(pivotForeignKey, parentId)
                .where(pivotRelatedKey, relId)
                .first<Record<string, unknown>>();
              if (existing) {
                await new QueryBuilder(pivotTable, conn)
                  .where(pivotForeignKey, parentId)
                  .where(pivotRelatedKey, relId)
                  .delete();
              } else {
                await new QueryBuilder(pivotTable, conn).insert({
                  [pivotForeignKey]: parentId,
                  [pivotRelatedKey]: relId,
                });
              }
            }
          };
        default:
          throw new RelationNotLoadedError(relName, modelName);
      }
    },
  });
}

function _applyRow(inst: BaseModel, row: Record<string, unknown>): void {
  const self = inst as unknown as Record<string, unknown>;
  const orig: Record<string, unknown> = {};
  const ModelClass = inst.constructor as typeof BaseModel;
  const ctor: ClassRef = ModelClass;
  const colReg = columnsFor(ctor);
  installReactiveAccessors(inst); // json/array reactiveCasts accessors (registered at decoration)
  const casts = getCasts(ctor);

  for (const [snakeKey, rawVal] of Object.entries(row)) {
    const camelKey = toCamel(snakeKey);
    // Prefer the property name as registered in the column registry. Models that
    // define snake_case properties (e.g. `is_active`) register under the snake_case
    // key, so we fall back to snakeKey when camelKey has no entry.
    const colMeta = colReg?.get(camelKey) ?? colReg?.get(snakeKey);
    const propKey = colReg?.has(camelKey) ? camelKey : colReg?.has(snakeKey) ? snakeKey : camelKey;
    const cast = casts[propKey] ?? casts[camelKey] ?? colMeta?.cast;
    const colType = colMeta?.type;
    const castObj =
      cast && typeof cast === "object" && typeof (cast as { get?: unknown }).get === "function"
        ? (cast as { get(v: unknown): unknown })
        : undefined;

    let finalVal: unknown;
    if (castObj) {
      // User-defined cast (object or Cast class) — method call preserves `this`.
      finalVal = castObj.get(rawVal);
    } else if (typeof cast === "string") {
      // Explicit shorthand cast ('boolean', 'json', 'date', etc.)
      finalVal = applyCastGet(rawVal, cast, `${ModelClass.name}.${propKey}`);
    } else if (colType === "boolean" && rawVal !== null && rawVal !== undefined) {
      // Auto-cast based on @column({ type: 'boolean' }) — SQLite stores 0/1
      finalVal = rawVal === 1 || rawVal === "1" || rawVal === true;
    } else if (colType === "datetime" && rawVal !== null && rawVal !== undefined) {
      finalVal = new Carbon(rawVal as string | number);
    } else if (colType === "json" && rawVal !== null && rawVal !== undefined) {
      // Auto-cast based on @column({ type: 'json' }) — SQLite stores JSON strings
      finalVal = typeof rawVal === "string" ? tryParseJson(rawVal) : rawVal;
    } else if (camelKey === "createdAt" || camelKey === "updatedAt") {
      finalVal = rawVal != null ? new Carbon(rawVal as string | number) : undefined;
    } else if (camelKey === "deletedAt") {
      finalVal = rawVal != null ? new Carbon(rawVal as string | number) : null;
    } else {
      finalVal = rawVal;
    }

    if (shouldProxyCast(ModelClass, cast, colType)) {
      finalVal = makeReactive(inst, propKey, finalVal);
    }

    const desc = Object.getOwnPropertyDescriptor(inst, propKey);
    if (desc && typeof desc.set === "function") {
      const privateKey = `_zerotal_${propKey}`;
      (self as Record<string, unknown>)[privateKey] = finalVal;
    } else {
      self[propKey] = finalVal;
    }
    orig[propKey] = finalVal;
  }

  // Mark as DB-resident so save() chooses UPDATE over INSERT.
  (inst as unknown as { _exists: boolean })._exists = true;

  // Install lazy-load guard getters for every declared relation.
  // For manyToMany relations a pivot proxy is returned instead of throwing so
  // that attach/detach/sync/toggle can be called without eager-loading.
  // The setter in every guard rewrites the property to a plain data property
  // so _attach() can overwrite without triggering the getter recursively.
  // Walk the prototype chain so relations declared on ancestor classes (e.g.
  // layered mixins) are guarded on the concrete subclass too; child wins.
  const relations = relationsFor(ctor);
  if (relations.size) {
    for (const [relName, relMeta] of relations.entries()) {
      if (relMeta.type === "manyToMany") {
        const { pivotTable, pivotForeignKey, pivotRelatedKey, localKey } = relMeta;
        const localKeyProp = toCamel(localKey);
        Object.defineProperty(inst, relName, {
          get(this: BaseModel) {
            const parentId = (this as unknown as Record<string, unknown>)[localKeyProp];
            return _createLazyPivotProxy(
              relName,
              ctor.name,
              pivotTable!,
              pivotForeignKey!,
              pivotRelatedKey!,
              parentId,
            );
          },
          set(this: BaseModel, v: unknown) {
            Object.defineProperty(this, relName, {
              value: v,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
          configurable: true,
          enumerable: false,
        });
      } else {
        Object.defineProperty(inst, relName, {
          get(this: BaseModel) {
            throw new RelationNotLoadedError(relName, ctor.name);
          },
          set(this: BaseModel, v: unknown) {
            Object.defineProperty(this, relName, {
              value: v,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
          configurable: true,
          // false so JSON.stringify / cache drivers skip unloaded relations.
          // Once loaded the set() handler above redefines the property with
          // enumerable:true so it IS included in subsequent serialisation.
          enumerable: false,
        });
      }
    }
  }

  (inst as unknown as { _original: Record<string, unknown> })._original = orig;
}

// `Model` is the canonical name at the declaration site — `class User extends Model.using(…)`
// mirrors Flow's `class PostsPage extends Component.using(…)`. `BaseModel` remains exported as
// an alias (same class object) for code that references the base class by that name.
export { BaseModel as Model };
