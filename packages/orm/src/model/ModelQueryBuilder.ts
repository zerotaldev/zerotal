import type { SQLInstance } from "../db/sql-types.ts";
import { Carbon } from "@zerotal/core/carbon";
import { QueryBuilder, OPERATORS, _inlineValue, dialectFor } from "../db/QueryBuilder.ts";
import {
  toCamelKey as _toCamel,
  toSnakeColumn as _toSnakeColumn,
  ctorChain,
} from "../support/identifiers.ts";
import { collectEncryptable, encryptedQueryError, isEncryptedCast } from "../casts/encrypted.ts";
import type {
  PaginateResult,
  SimplePaginateResult,
  CursorPaginateResult,
  KeysetOptions,
  KeysetPaginateResult,
  WhereOperator,
} from "../db/types.ts";
import { ModelNotFoundError } from "../errors/index.ts";
import { HookRegistry } from "./hooks/HookRegistry.ts";
import { type WithLoaded, type ManyToMany } from "./relations/RelationRegistry.ts";
import type { BaseModel } from "./BaseModel.ts";
import { type ColumnOptions } from "./decorators/column.ts";
import { columnsFor, relationsFor } from "./decorators/_metadata.ts";
import { currentOrmContext } from "./OrmContext.ts";
import type { ClassRef } from "../support/classRef.ts";

type StringCast = "datetime" | "array" | "json" | "date" | "boolean" | "integer" | "float";
type CastOption = ColumnOptions["cast"];

function _getCasts(ctor: ClassRef): Record<string, CastOption> {
  const merged: Record<string, CastOption> = {};
  const colReg = columnsFor(ctor);
  // Mirrors getCasts() in BaseModel: `static encryptable` resolves to casts, and an
  // explicit cast on the same column wins. Without this the guard below cannot see
  // a column declared encrypted through the list form.
  Object.assign(
    merged,
    collectEncryptable(ctorChain(ctor), (key) => colReg?.get(key)?.type),
  );
  for (const entry of ctorChain(ctor)) {
    const casts = (entry as { casts?: Record<string, CastOption> }).casts;
    if (casts) Object.assign(merged, casts);
  }
  return merged;
}

function _applyCastSet(value: unknown, cast: StringCast): unknown {
  if (value === null || value === undefined) return value;
  switch (cast) {
    case "datetime":
      if (value instanceof Carbon) return value.toDatabase();
      if (value instanceof Date) return value.toISOString();
      return value;
    case "array":
    case "json":
      if (typeof value !== "string") return JSON.stringify(value);
      return value;
    case "date":
      if (value instanceof Carbon) return value.toDatabase();
      if (value instanceof Date) return value.toISOString();
      return value;
    case "boolean":
      return value ? 1 : 0;
    case "integer":
      return parseInt(String(value), 10);
    case "float":
      return parseFloat(String(value));
    default:
      return value;
  }
}

/**
 * SQLite allows at most ~999 bound parameters per statement (32 766 in newer
 * builds, but we stay conservative). Chunk large IN lists and union the results.
 */
const WHEREIN_CHUNK = 500;

interface _ChunkFactory<T> {
  whereIn(col: string, vals: unknown[]): { get<R = T>(): Promise<R[]> };
}

async function _whereInChunked<T = Record<string, unknown>>(
  factory: () => _ChunkFactory<T>,
  column: string,
  ids: unknown[],
  apply?: (builder: _ChunkFactory<T>) => void,
): Promise<T[]> {
  const run = (vals: unknown[]): Promise<T[]> => {
    const builder = factory();
    if (apply) apply(builder);
    return builder.whereIn(column, vals).get<T>();
  };
  if (ids.length <= WHEREIN_CHUNK) {
    return run(ids);
  }
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += WHEREIN_CHUNK) {
    const rows = await run(ids.slice(i, i + WHEREIN_CHUNK));
    out.push(...rows);
  }
  return out;
}

/**
 * Base related-model query for eager loading that honours the related model's
 * soft-delete scope. `_unscopedQuery()` deliberately omits `deleted_at IS NULL`,
 * so every relation loader re-applies it here — matching the withCount aggregate
 * path, so `with('rel')` and `withCount('rel')` agree on which rows are visible.
 */
function _scopedRelated(RelatedClass: typeof BaseModel): QueryBuilder {
  const q = RelatedClass._unscopedQuery() as unknown as QueryBuilder;
  if (RelatedClass.softDeletes) q.whereNull("deleted_at");
  return q;
}

/** A constraint closure applied to a relation subquery / eager-load query. */
export type RelationConstraint = (query: ModelQueryBuilder<BaseModel>) => void;

type AggregateEntry = {
  relation: string;
  fn: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  column: string;
  constraint?: RelationConstraint;
};
type CountEntry = { relation: string; constraint?: RelationConstraint };
type ExistsEntry = { relation: string; constraint?: RelationConstraint };

/** A parsed eager-load specification supporting constraints and nested (dot) paths. */
interface EagerSpec {
  name: string;
  constraint?: RelationConstraint;
  children: EagerSpec[];
}

/** Reduce an aggregate column expression to a safe identifier segment for the alias. */
function _aggColumnKey(column: string): string {
  const bare = column.includes(".") ? column.split(".").pop()! : column;
  return (
    bare
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "value"
  );
}

/**
 * SQL alias for a relation aggregate, e.g. `comments_sum_votes`. Including the
 * column keeps multiple aggregates of the same function on one relation distinct
 * instead of colliding on a bare `comments_sum`.
 */
export function aggregateAlias(relation: string, fn: string, column: string): string {
  return `${relation}_${fn.toLowerCase()}_${_aggColumnKey(column)}`;
}

/** Instance attribute name for a relation aggregate, e.g. `commentsSumVotes`. */
export function aggregateAttribute(relation: string, fn: string, column: string): string {
  return _toCamel(aggregateAlias(relation, fn, column));
}

/** Instance attribute name for a relation count, e.g. `commentsCount`. */
export function countAttribute(relation: string): string {
  return _toCamel(`${relation}_count`);
}

/**
 * Wrap an array of related models in a ManyToMany<T> collection that has
 * pivot manipulation methods (attach / detach / sync / toggle) wired directly
 * to the pivot table. The array still behaves as a plain Array<T> for
 * iteration, spread, and all standard array methods.
 */
function _createPivotCollection<T extends BaseModel>(
  items: T[],
  pivotTable: string,
  pivotForeignKey: string,
  pivotRelatedKey: string,
  parentId: unknown,
  sql: SQLInstance,
  timestamps = false,
): ManyToMany<T> {
  const arr = [...items] as ManyToMany<T>;
  const _ts = (): Record<string, unknown> => {
    if (!timestamps) return {};
    const now = new Date().toISOString();
    return { created_at: now, updated_at: now };
  };

  arr.attach = async (
    id: number | number[],
    pivotData?: Record<string, unknown>,
  ): Promise<void> => {
    const ids = Array.isArray(id) ? id : [id];
    for (const relId of ids) {
      await new QueryBuilder(pivotTable, sql).insert({
        [pivotForeignKey]: parentId,
        [pivotRelatedKey]: relId,
        ..._ts(),
        ...(pivotData ?? {}),
      });
    }
  };

  arr.detach = async (id?: number | number[]): Promise<void> => {
    const qb = new QueryBuilder(pivotTable, sql).where(pivotForeignKey, parentId);
    if (id !== undefined) {
      const ids = Array.isArray(id) ? id : [id];
      qb.whereIn(pivotRelatedKey, ids as unknown[]);
    }
    await qb.delete();
  };

  arr.sync = async (ids: number[]): Promise<void> => {
    await new QueryBuilder(pivotTable, sql).where(pivotForeignKey, parentId).delete();
    for (const relId of ids) {
      await new QueryBuilder(pivotTable, sql).insert({
        [pivotForeignKey]: parentId,
        [pivotRelatedKey]: relId,
        ..._ts(),
      });
    }
  };

  arr.syncWithoutDetaching = async (ids: number[]): Promise<void> => {
    for (const relId of ids) {
      const existing = await new QueryBuilder(pivotTable, sql)
        .where(pivotForeignKey, parentId)
        .where(pivotRelatedKey, relId)
        .first<Record<string, unknown>>();
      if (!existing) {
        await new QueryBuilder(pivotTable, sql).insert({
          [pivotForeignKey]: parentId,
          [pivotRelatedKey]: relId,
        });
      }
    }
  };

  arr.updateExistingPivot = async (
    id: number,
    pivotData: Record<string, unknown>,
  ): Promise<void> => {
    await new QueryBuilder(pivotTable, sql)
      .where(pivotForeignKey, parentId)
      .where(pivotRelatedKey, id)
      .update(pivotData);
  };

  arr.toggle = async (id: number | number[]): Promise<void> => {
    const ids = Array.isArray(id) ? id : [id];
    for (const relId of ids) {
      const existing = await new QueryBuilder(pivotTable, sql)
        .where(pivotForeignKey, parentId)
        .where(pivotRelatedKey, relId)
        .first<Record<string, unknown>>();
      if (existing) {
        await new QueryBuilder(pivotTable, sql)
          .where(pivotForeignKey, parentId)
          .where(pivotRelatedKey, relId)
          .delete();
      } else {
        await new QueryBuilder(pivotTable, sql).insert({
          [pivotForeignKey]: parentId,
          [pivotRelatedKey]: relId,
        });
      }
    }
  };

  return arr;
}

// ── Global scope registry ────────────────────────────────────────────────────
// Stored here (not in BaseModel) to avoid a circular runtime import.
// BaseModel imports ModelQueryBuilder at runtime; ModelQueryBuilder imports
// BaseModel as a type only — no cycle.

export type GlobalScopeCallback = (qb: ModelQueryBuilder<BaseModel>) => void;
export function _globalScopeRegistry(): Map<ClassRef, Map<string, GlobalScopeCallback>> {
  return currentOrmContext().globalScopes as unknown as Map<
    ClassRef,
    Map<string, GlobalScopeCallback>
  >;
}

/**
 * The model-aware query builder returned by `Model.query()`.
 *
 * Extends the low-level {@link QueryBuilder} with everything that makes a query
 * "Active Record": rows are hydrated into model instances, relations can be
 * eager-loaded, relationship-existence filters (`has` / `whereHas`) and relation
 * aggregates (`withCount` / `withSum` / …) are available, named and global scopes
 * are applied, and terminal methods (`get`, `first`, `firstOrFail`, `findOrFail`,
 * `paginate`) return model instances instead of raw rows.
 *
 * @typeParam M - The model class this builder queries and hydrates.
 *
 * @remarks
 * Behaviours layered on top of {@link QueryBuilder}:
 *
 * - **Model hydration** — `get()` / `first()` map each result row through
 *   `Model.fromRow()`, apply casts, run the `afterFind` hook, and attach any
 *   relation aggregate columns (e.g. `commentsCount`, `commentsExists`).
 * - **Column-name resolution** — every column-taking method (`where`, `orderBy`,
 *   `select`, `sum`, …) accepts a model property name in camelCase and resolves
 *   it to the snake_case database column, so `where('createdAt', …)` targets
 *   `created_at`.
 * - **Eager loading** — {@link with} declares relations (including nested
 *   dot-paths and constrained closures) to load in a batched follow-up query.
 * - **Relationship existence** — {@link has} / {@link whereHas} /
 *   {@link doesntHave} filter the parent rows by correlated `EXISTS` subqueries.
 * - **Global scopes** — scopes registered on the model (and inherited through the
 *   prototype chain) are applied lazily on the first terminal call; opt out per
 *   query with {@link withoutGlobalScope} / {@link withoutGlobalScopes}.
 * - **Soft-delete scoping asymmetry** — {@link has}, {@link whereHas},
 *   {@link withCount} and the other relation aggregates exclude soft-deleted
 *   related rows (they add `deleted_at IS NULL` when the related model soft-deletes),
 *   but eager {@link with} loads related rows through the model's *unscoped* query
 *   and therefore does **not** apply the related model's soft-delete (or global)
 *   scopes. Trashed related records will appear in an eager-loaded relation.
 *
 * @example
 * ```ts
 * // Hydrated User instances, each with its posts eager-loaded, paginated.
 * const page = await User.query()
 *   .with('posts', (q) => q.where('published', true))
 *   .where('active', true)
 *   .orderBy('createdAt', 'desc')
 *   .paginate(15, 1); // 15 per page, page 1
 *
 * for (const user of page.data) {
 *   console.log(user.name, user.posts.length);
 * }
 * ```
 */
export class ModelQueryBuilder<M extends BaseModel> extends QueryBuilder {
  private _ModelClass: typeof BaseModel;
  private _eagerSpecs: EagerSpec[] = [];
  private _withCounts: CountEntry[] = [];
  private _withAggregates: AggregateEntry[] = [];
  private _withExists: ExistsEntry[] = [];
  private _excludedScopes = new Set<string>();
  private _scopesApplied = false;

  constructor(table: string, sql: SQLInstance, ModelClass: typeof BaseModel) {
    super(table, sql);
    this._ModelClass = ModelClass;
  }

  protected override _newInstance(): QueryBuilder {
    return new ModelQueryBuilder(this._state.table, this._sql, this._ModelClass);
  }

  /** Walk the prototype chain to find a single relation's metadata. */
  private _findRelationMeta(
    relation: string,
  ): import("./relations/RelationRegistry.ts").RelationMetadata | undefined {
    return relationsFor(this._ModelClass).get(relation);
  }

  /** Merge relation metadata from the full prototype chain (child overrides parent). */
  private _allRelationsMeta(): Map<
    string,
    import("./relations/RelationRegistry.ts").RelationMetadata
  > {
    return relationsFor(this._ModelClass);
  }

  /**
   * Return a deep copy of this builder, including its eager-load specs, relation
   * aggregate/count/exists entries and excluded-scope set. The copy has scopes
   * un-applied so they run on its own first terminal call.
   * @category Retrieval
   */
  override clone(): this {
    const c = super.clone() as unknown as ModelQueryBuilder<M>;
    c._eagerSpecs = this._eagerSpecs.map((s) => _cloneSpec(s));
    c._withCounts = this._withCounts.map((e) => ({ ...e }));
    c._withAggregates = this._withAggregates.map((e) => ({ ...e }));
    c._withExists = this._withExists.map((e) => ({ ...e }));
    c._excludedScopes = new Set(this._excludedScopes);
    c._scopesApplied = false;
    return c as unknown as this;
  }

  /**
   * Exclude one or more named global scopes from this query.
   *
   * @param names - Names of the global scopes to skip for this query only.
   * @returns This builder for chaining.
   * @category Scopes
   *
   * @example
   * ```ts
   * // Skip the 'published' scope for this query only
   * Post.query().withoutGlobalScope('published').get();
   * ```
   */
  withoutGlobalScope(...names: string[]): this {
    for (const n of names) this._excludedScopes.add(n);
    return this;
  }

  /**
   * Remove ALL global scopes registered on this model for this query.
   *
   * @returns This builder for chaining.
   * @category Scopes
   */
  withoutGlobalScopes(): this {
    this._excludedScopes.add("__all__");
    return this;
  }

  /**
   * Apply global scopes before any terminal compiles SQL.
   *
   * Overrides {@link QueryBuilder._beforeTerminal}, so this now runs for `update()`, `delete()`,
   * `count()`, `exists()`, `pluck()`, `value()`, the aggregates and every paginator — not just
   * `get()`/`first()` as before. `_applyGlobalScopes` is guarded by `_scopesApplied`, so
   * repeat entry through a cloned builder is a no-op.
   *
   * @category Scopes
   * @internal
   */
  protected override _beforeTerminal(): void {
    // Order matters: group the caller's predicates FIRST, so the scopes appended below join
    // the outer AND chain rather than the caller's (possibly OR-joined) one.
    this._groupUserWheres();
    this._applyGlobalScopes();
  }

  private _applyGlobalScopes(): void {
    if (this._scopesApplied) return;
    this._scopesApplied = true;
    if (this._excludedScopes.has("__all__")) return;

    // Walk the prototype chain (base-first) so subclasses inherit parent scopes
    // and can override them by name.
    const merged = new Map<string, GlobalScopeCallback>();
    const scopeReg = _globalScopeRegistry();
    for (const cls of ctorChain(this._ModelClass)) {
      const clsScopes = scopeReg.get(cls);
      if (clsScopes) for (const [n, fn] of clsScopes) merged.set(n, fn);
    }

    for (const [name, fn] of merged) {
      if (!this._excludedScopes.has(name)) fn(this as unknown as ModelQueryBuilder<BaseModel>);
    }
  }

  // ── Aggregate eager loads (constrained + object/array forms) ──────────────

  /**
   * Add a `COUNT` subquery for a relation, injected as `<relation>Count` (camelCase)
   * on every hydrated result.
   *
   * Supports hasMany, hasOne, belongsTo and manyToMany relations, and an optional
   * constraint closure. The count excludes soft-deleted related rows when the related
   * model soft-deletes.
   *
   * @param relation - A relation name, an array of names, or a `{ name: constraint }`
   *   map to count several relations (optionally constrained) at once.
   * @param constraint - Optional closure narrowing which related rows are counted
   *   (applies when `relation` is a single string).
   * @returns This builder for chaining.
   * @category Aggregates
   *
   * @example
   * ```ts
   * const posts = await Post.query().withCount('comments').get();
   * // posts[0].commentsCount === 12
   *
   * await Post.query()
   *   .withCount({ comments: (q) => q.where('approved', true) })
   *   .get();
   * ```
   */
  withCount(
    relation: string | string[] | Record<string, RelationConstraint>,
    constraint?: RelationConstraint,
  ): this {
    this._eachRelationArg(relation, constraint, (rel, c) => {
      if (!this._withCounts.some((e) => e.relation === rel && !c))
        this._withCounts.push({ relation: rel, ...(c ? { constraint: c } : {}) });
    });
    return this;
  }

  /**
   * Add a `SUM(column)` subquery for a relation, injected as
   * `<relation>Sum<Column>` (camelCase) on every hydrated result.
   *
   * @param relation - The relation to aggregate over.
   * @param column - The related-table column to sum.
   * @param constraint - Optional closure narrowing which related rows are summed.
   * @returns This builder for chaining.
   * @category Aggregates
   *
   * @example
   * ```ts
   * const posts = await Post.query().withSum('comments', 'votes').get();
   * // posts[0].commentsSumVotes === 42
   * ```
   */
  withSum(relation: string, column: string, constraint?: RelationConstraint): this {
    this._withAggregates.push({
      relation,
      fn: "SUM",
      column,
      ...(constraint ? { constraint } : {}),
    });
    return this;
  }
  /**
   * Add an `AVG(column)` subquery for a relation, injected as
   * `<relation>Avg<Column>` (camelCase) on every hydrated result.
   *
   * @param relation - The relation to aggregate over.
   * @param column - The related-table column to average.
   * @param constraint - Optional closure narrowing which related rows are averaged.
   * @returns This builder for chaining.
   * @category Aggregates
   */
  withAvg(relation: string, column: string, constraint?: RelationConstraint): this {
    this._withAggregates.push({
      relation,
      fn: "AVG",
      column,
      ...(constraint ? { constraint } : {}),
    });
    return this;
  }
  /**
   * Add a `MIN(column)` subquery for a relation, injected as
   * `<relation>Min<Column>` (camelCase) on every hydrated result.
   *
   * @param relation - The relation to aggregate over.
   * @param column - The related-table column to take the minimum of.
   * @param constraint - Optional closure narrowing which related rows are considered.
   * @returns This builder for chaining.
   * @category Aggregates
   */
  withMin(relation: string, column: string, constraint?: RelationConstraint): this {
    this._withAggregates.push({
      relation,
      fn: "MIN",
      column,
      ...(constraint ? { constraint } : {}),
    });
    return this;
  }
  /**
   * Add a `MAX(column)` subquery for a relation, injected as
   * `<relation>Max<Column>` (camelCase) on every hydrated result.
   *
   * @param relation - The relation to aggregate over.
   * @param column - The related-table column to take the maximum of.
   * @param constraint - Optional closure narrowing which related rows are considered.
   * @returns This builder for chaining.
   * @category Aggregates
   */
  withMax(relation: string, column: string, constraint?: RelationConstraint): this {
    this._withAggregates.push({
      relation,
      fn: "MAX",
      column,
      ...(constraint ? { constraint } : {}),
    });
    return this;
  }

  /**
   * Add an `EXISTS` subquery for a relation, injected as `<relation>Exists`
   * (boolean) on every result — a single-query check that avoids loading the
   * related rows. Optional constraint narrows what counts as "existing".
   *
   * @param relation - The relation to test for existence.
   * @param constraint - Optional closure narrowing what counts as "existing".
   * @returns This builder for chaining.
   * @category Aggregates
   *
   * @example
   * ```ts
   * const posts = await Post.query().withExists('comments').get();
   * // posts[0].commentsExists === true | false
   * ```
   */
  withExists(relation: string, constraint?: RelationConstraint): this {
    this._withExists.push({ relation, ...(constraint ? { constraint } : {}) });
    return this;
  }

  private _eachRelationArg(
    arg: string | string[] | Record<string, RelationConstraint>,
    constraint: RelationConstraint | undefined,
    fn: (rel: string, c?: RelationConstraint) => void,
  ): void {
    if (typeof arg === "string") fn(arg, constraint);
    else if (Array.isArray(arg)) for (const r of arg) fn(r);
    else for (const [k, v] of Object.entries(arg)) fn(k, typeof v === "function" ? v : undefined);
  }

  // ── Relationship existence queries ────────────────────────────────────────

  /**
   * Filter to parent rows that HAVE the related records, via a correlated
   * `EXISTS` subquery (soft-deleted related rows are excluded).
   *
   * Supported for hasMany, hasOne, belongsTo, manyToMany, morphMany and morphOne
   * relations. The `*Through`, `morphToMany`, `morphedByMany` and `morphTo`
   * relation types are **not** supported and throw — use eager {@link with}
   * instead.
   *
   * @param relation - The relation that must exist.
   * @param operator - Optional comparison operator against the related count (e.g. `'>='`).
   * @param count - Optional count to compare against (defaults to 1 when an operator is given).
   * @returns This builder for chaining.
   * @throws Error if the relation is undefined on the model, or is a `*Through` /
   *   polymorphic-many / `morphTo` relation.
   * @category Relationship constraints
   *
   * @example
   * ```ts
   * Post.query().has('comments');            // at least one comment
   * Post.query().has('comments', '>=', 3);   // three or more
   * ```
   */
  has(relation: string, operator?: string, count?: number): this {
    if (operator === undefined && count === undefined)
      return this._addHas(relation, undefined, "and", false);
    return this._addHas(relation, undefined, "and", false, operator ?? ">=", count ?? 1);
  }
  /**
   * `OR` variant of {@link has} — combines with the previous condition via `OR`.
   * @category Relationship constraints
   */
  orHas(relation: string, operator?: string, count?: number): this {
    if (operator === undefined && count === undefined)
      return this._addHas(relation, undefined, "or", false);
    return this._addHas(relation, undefined, "or", false, operator ?? ">=", count ?? 1);
  }
  /**
   * Filter to parent rows that do NOT have the related records (`NOT EXISTS`).
   *
   * @param relation - The relation that must be absent.
   * @param callback - Optional closure constraining which related rows count as present.
   * @returns This builder for chaining.
   * @category Relationship constraints
   */
  doesntHave(relation: string, callback?: RelationConstraint): this {
    return this._addHas(relation, callback, "and", true);
  }
  /**
   * `OR` variant of {@link doesntHave}.
   * @category Relationship constraints
   */
  orDoesntHave(relation: string, callback?: RelationConstraint): this {
    return this._addHas(relation, callback, "or", true);
  }
  /**
   * Filter by existence of related records matching the callback constraints.
   *
   * @param relation - The relation to test.
   * @param callback - Optional closure applied to the related subquery.
   * @param operator - Optional operator to compare the matching related count against.
   * @param count - Optional count to compare against.
   * @returns This builder for chaining.
   * @category Relationship constraints
   *
   * @example
   * ```ts
   * User.query().whereHas('posts', (q) => q.where('published', true)).get();
   * ```
   */
  whereHas(
    relation: string,
    callback?: RelationConstraint,
    operator?: string,
    count?: number,
  ): this {
    return this._addHas(relation, callback, "and", false, operator, count);
  }
  /**
   * `OR` variant of {@link whereHas}.
   * @category Relationship constraints
   */
  orWhereHas(relation: string, callback?: RelationConstraint): this {
    return this._addHas(relation, callback, "or", false);
  }
  /**
   * Filter to parent rows with NO related records matching the callback constraints.
   * @category Relationship constraints
   */
  whereDoesntHave(relation: string, callback?: RelationConstraint): this {
    return this._addHas(relation, callback, "and", true);
  }
  /**
   * `OR` variant of {@link whereDoesntHave}.
   * @category Relationship constraints
   */
  orWhereDoesntHave(relation: string, callback?: RelationConstraint): this {
    return this._addHas(relation, callback, "or", true);
  }
  /**
   * Shorthand for {@link whereHas} with a single column condition on the related table.
   *
   * @param relation - The relation to test.
   * @param column - The related-table column to compare.
   * @param operatorOrValue - The operator, or the value when the 3-arg form is used.
   * @param value - The value when an explicit operator is supplied.
   * @returns This builder for chaining.
   * @category Relationship constraints
   *
   * @example
   * ```ts
   * Post.query().whereRelation('comments', 'approved', true).get();
   * ```
   */
  whereRelation(relation: string, column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.whereHas(relation, (q) =>
      value === undefined
        ? q.where(column, operatorOrValue)
        : q.where(column, operatorOrValue as WhereOperator, value),
    );
  }
  /**
   * `OR` variant of {@link whereRelation}.
   * @category Relationship constraints
   */
  orWhereRelation(
    relation: string,
    column: string,
    operatorOrValue: unknown,
    value?: unknown,
  ): this {
    return this.orWhereHas(relation, (q) =>
      value === undefined
        ? q.where(column, operatorOrValue)
        : q.where(column, operatorOrValue as WhereOperator, value),
    );
  }
  /**
   * {@link whereHas} plus eager-loading the same relation with the same
   * constraint — filter parents by matching related rows and load exactly those
   * rows in one call.
   *
   * @param relation - The relation to filter by and eager-load.
   * @param callback - Optional closure applied both to the existence subquery and
   *   the eager-load query.
   * @returns This builder for chaining.
   * @category Relationship constraints
   */
  withWhereHas(relation: string, callback?: RelationConstraint): this {
    this.whereHas(relation, callback);
    this._addEager(relation, callback);
    return this;
  }

  private _addHas(
    relation: string,
    callback: RelationConstraint | undefined,
    boolean: "and" | "or",
    negate: boolean,
    operator?: string,
    count?: number,
  ): this {
    const sub = this._relationSubquery(relation, callback);
    if (operator !== undefined && count !== undefined) {
      // The operator lands in SQL by interpolation, not binding, so it is allowlisted like
      // an identifier. `has('posts', req.query.op, 1)` was otherwise a way to append
      // arbitrary predicate text — with a correct binding count, so it executed cleanly.
      if (!OPERATORS.has(operator)) {
        throw new Error(`[Zerotal ORM] has()/whereHas(): unsupported operator "${operator}".`);
      }
      sub.selectRaw("COUNT(*)");
      const { sql, bindings } = sub.toSqlWithBindings();
      const clause = `(${sql}) ${operator} ?`;
      if (boolean === "or") this.orWhereRaw(clause, [...bindings, count]);
      else this.whereRaw(clause, [...bindings, count]);
    } else {
      sub.selectRaw("1");
      const { sql, bindings } = sub.toSqlWithBindings();
      const kw = negate ? "NOT EXISTS" : "EXISTS";
      if (boolean === "or") this.orWhereRaw(`${kw} (${sql})`, bindings);
      else this.whereRaw(`${kw} (${sql})`, bindings);
    }
    return this;
  }

  /**
   * Build a correlated subquery over a relation, with the join predicate that
   * ties it to the parent table plus any caller constraint. Used by has/whereHas
   * and the constrained withCount/withSum aggregates.
   */
  private _relationSubquery(relation: string, constraint?: RelationConstraint): QueryBuilder {
    const meta = this._findRelationMeta(relation);
    if (!meta) {
      throw new Error(`Relation "${relation}" is not defined on ${this._ModelClass.name}`);
    }
    const Related = meta.related() as typeof BaseModel;
    const main = this._ModelClass.table;
    let sub: QueryBuilder;

    if (
      meta.type === "hasManyThrough" ||
      meta.type === "hasOneThrough" ||
      meta.type === "morphToMany" ||
      meta.type === "morphedByMany" ||
      meta.type === "morphTo"
    ) {
      throw new Error(
        `[Zerotal ORM] has()/whereHas() is not supported for "${meta.type}" relations ("${relation}"). Use eager loading (with()) instead.`,
      );
    }

    if (meta.type === "manyToMany") {
      const relTable = Related.table;
      sub = new QueryBuilder(meta.pivotTable!, this._sql)
        .join(
          relTable,
          `${relTable}.${Related.primaryKey}`,
          "=",
          `${meta.pivotTable}.${meta.pivotRelatedKey}`,
        )
        .whereColumn(`${meta.pivotTable}.${meta.pivotForeignKey}`, `${main}.${meta.localKey}`);
      if (Related.softDeletes) sub.whereNull(`${relTable}.deleted_at`);
    } else {
      const relTable = Related.table;
      sub = new QueryBuilder(relTable, this._sql);
      if (meta.type === "belongsTo") {
        sub.whereColumn(`${relTable}.${meta.localKey}`, `${main}.${meta.foreignKey}`);
      } else {
        sub.whereColumn(`${relTable}.${meta.foreignKey}`, `${main}.${meta.localKey}`);
        if (meta.type === "morphMany" || meta.type === "morphOne") {
          sub.where(`${relTable}.${meta.morphTypeColumn}`, this._ModelClass.name);
        }
      }
      if (Related.softDeletes) sub.whereNull(`${relTable}.deleted_at`);
    }

    if (constraint) constraint(sub as unknown as ModelQueryBuilder<BaseModel>);
    return sub;
  }

  /** Compile a subquery builder to SQL with its bindings inlined as literals. */
  private _inlinedSql(sub: QueryBuilder): string {
    const { sql, bindings } = sub.toSqlWithBindings();
    let i = 0;
    return sql.replace(/\?/g, () => _inlineValue(bindings[i++]));
  }

  /**
   * Build a relation aggregate sub-select string (bindings inlined), for both
   * the constrained and unconstrained forms. Returns null for relation types
   * `_relationSubquery` does not support, which the caller silently skips —
   * matching the old string-built path's behaviour for those types.
   */
  private _aggSubquery(
    relation: string,
    fn: string,
    column: string,
    constraint?: RelationConstraint,
  ): string | null {
    try {
      const sub = this._relationSubquery(relation, constraint);
      sub.selectRaw(`${fn}(${column})`);
      return this._inlinedSql(sub);
    } catch {
      return null;
    }
  }

  /** Build a relation EXISTS sub-select string (bindings inlined). */
  private _existsSubquery(relation: string, constraint?: RelationConstraint): string | null {
    try {
      const sub = this._relationSubquery(relation, constraint);
      sub.selectRaw("1");
      return this._inlinedSql(sub);
    } catch {
      return null;
    }
  }

  /**
   * Identifier-ingress override: resolve a model property name to its database
   * column name (camelCase → snake_case). The base builder routes every
   * caller-supplied column through this one hook, so resolution covers all
   * column-taking methods — where/orderBy/select and equally whereNotIn,
   * whereAny, pluck, increment, join columns and the cursor/keyset pagination
   * option columns, which the 29 per-method overrides this hook replaces had
   * drifted on. Idempotent for already-snake and qualified columns; raw
   * expressions pass through untouched.
   */
  protected override _column(column: string): string {
    return _toSnakeColumn(column);
  }

  /**
   * Value-ingress override: coerce a bound value through the column's cast
   * metadata (Carbon → DB string, boolean → 0/1, custom cast setters), so a
   * value compares in its stored representation everywhere a column-value pair
   * enters the builder — where, whereIn and now whereBetween alike.
   */
  protected override _bind(column: string, value: unknown, operator?: WhereOperator): unknown {
    return this._coerceWhereValue(column, value, operator);
  }

  // ── Terminal overrides ───────────────────────────────────────────────────
  // Signatures match the base to satisfy TS override compatibility.
  // The class-level M is used internally; T is a passthrough.

  /**
   * Execute the query and return an array of hydrated model instances.
   *
   * Applies global scopes, injects any {@link withCount} / {@link withSum} /
   * {@link withExists} aggregate columns, hydrates each row via `Model.fromRow`
   * (attaching the aggregate values as camelCase attributes), performs any eager
   * loads declared with {@link with}, and runs the `afterFind` hook per instance.
   *
   * @typeParam T - Element type of the returned array (defaults to the model `M`).
   * @returns The matched model instances.
   * @category Retrieval
   */
  override async get<T = M>(): Promise<T[]> {
    this._beforeTerminal();
    const hasAggSubqueries =
      this._withCounts.length > 0 || this._withAggregates.length > 0 || this._withExists.length > 0;
    if (hasAggSubqueries) {
      if (this._state.selects.length === 0) {
        this.select(`${this._ModelClass.table}.*`);
      }
      // Constrained and unconstrained forms both compile through
      // _relationSubquery. This used to be two implementations — a string-built
      // fast path for the unconstrained case and the builder path for the
      // constrained one — whose SQL was documented as agreeing but did not:
      // for manyToMany without soft deletes the fast path counted pivot rows
      // directly, so an orphaned pivot row made withCount('tags') and
      // withCount({ tags: q => … }) disagree on identical data. One path, one
      // answer: related rows are joined and counted, orphans excluded.
      for (const { relation, constraint } of this._withCounts) {
        const sql = this._aggSubquery(relation, "COUNT", "*", constraint);
        if (sql) this.selectRaw(`(${sql}) AS ${relation}_count`);
      }
      for (const { relation, fn, column, constraint } of this._withAggregates) {
        const alias = aggregateAlias(relation, fn, column);
        const sql = this._aggSubquery(relation, fn, column, constraint);
        if (sql) this.selectRaw(`(${sql}) AS ${alias}`);
      }
      for (const { relation, constraint } of this._withExists) {
        const sql = this._existsSubquery(relation, constraint);
        if (sql)
          this.selectRaw(`(CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END) AS ${relation}_exists`);
      }
    }

    const rows = await super.get<Record<string, unknown>>();
    // Aggregate result columns to detach from the raw row before fromRow().
    const numericKeys = new Set<string>();
    for (const { relation } of this._withCounts) numericKeys.add(`${relation}_count`);
    for (const { relation, fn, column } of this._withAggregates)
      numericKeys.add(aggregateAlias(relation, fn, column));
    const boolKeys = new Set<string>();
    for (const { relation } of this._withExists) boolKeys.add(`${relation}_exists`);

    const instances = rows.map((row) => {
      const camelValues: Record<string, number | boolean> = {};
      for (const key of numericKeys) {
        if (key in row) {
          camelValues[_toCamel(key)] = Number(row[key]);
          delete row[key];
        }
      }
      for (const key of boolKeys) {
        if (key in row) {
          camelValues[_toCamel(key)] = Number(row[key]) !== 0;
          delete row[key];
        }
      }
      const inst = this._ModelClass.fromRow(row) as M;
      const writable = inst as Record<string, unknown>;
      for (const [k, v] of Object.entries(camelValues)) writable[k] = v;
      return inst;
    });

    if (instances.length > 0 && this._eagerSpecs.length > 0) {
      await this._eagerLoadRelations(instances);
    }

    for (const inst of instances) {
      await HookRegistry.run(this._ModelClass, "afterFind", inst);
    }

    return instances as unknown as T[];
  }

  /**
   * Execute the query and return the first matching model instance, or `null`.
   *
   * Applies global scopes, hydrates the row, runs any eager loads declared with
   * {@link with}, and runs the `afterFind` hook.
   *
   * @typeParam T - Result type (defaults to the model `M`).
   * @returns The first matching instance, or `null` when none match.
   * @category Retrieval
   */
  override async first<T = M>(): Promise<T | null> {
    this._beforeTerminal();
    const row = await super.first<Record<string, unknown>>();
    if (row === null) return null;
    const inst = this._ModelClass.fromRow(row) as M;

    if (this._eagerSpecs.length > 0) {
      await this._eagerLoadRelations([inst]);
    }

    await HookRegistry.run(this._ModelClass, "afterFind", inst);
    return inst as unknown as T;
  }

  // ── Named methods ────────────────────────────────────────────────────────

  /**
   * Find a single instance by primary key, or throw when it does not exist.
   *
   * Honours any constraints, scopes and eager loads already set on the builder.
   *
   * @param id - Primary-key value to look up.
   * @returns The matching model instance.
   * @throws {@link ModelNotFoundError} when no row has that primary key.
   * @category Retrieval
   */
  async findOrFail(id: number): Promise<M> {
    const inst = await this.where(this._ModelClass.primaryKey, id).first<M>();
    if (inst === null) {
      throw new ModelNotFoundError(this._ModelClass.name, id);
    }
    return inst;
  }

  /**
   * Return the first matching instance, or throw when none match.
   *
   * @returns The first matching model instance.
   * @throws {@link ModelNotFoundError} when the query matches no rows.
   * @category Retrieval
   */
  async firstOrFail(): Promise<M> {
    const inst = await this.first<M>();
    if (inst === null) {
      throw new ModelNotFoundError(this._ModelClass.name);
    }
    return inst;
  }

  /**
   * Declare one or more relations to eager-load in a batched follow-up query.
   *
   * Accepts a bare name, a nested dot-path, a name plus a constraint closure, an
   * array mixing names and `{ name: constraint }` maps, or a single such map:
   *
   * ```ts
   * .with('comments')
   * .with('author.profile')                       // nested (dot)
   * .with('comments', (q) => q.where('ok', true)) // constrained
   * .with({ comments: (q) => q.where('ok', true) })
   * .with(['author', { comments: (q) => q.where('ok', true) }])
   * ```
   *
   * The single-bare-string overload narrows the builder's type so callers keep
   * fully-typed access to the loaded relation.
   *
   * @remarks
   * Eager loads run through the related model's *unscoped* query, so the related
   * model's soft-delete and global scopes are **not** applied — trashed related
   * rows are included. Constraint closures may add their own filters. Contrast with
   * {@link has} / {@link withCount}, which do exclude soft-deleted related rows.
   *
   * @param relation - Relation name, dot-path, array, or `{ name: constraint }` map.
   * @param constraint - Optional constraint closure (single-string form only).
   * @returns This builder (type-narrowed for the single-string overload).
   * @category Eager loading
   *
   * @example
   * ```ts
   * const users = await User.query()
   *   .with('posts', (q) => q.where('published', true))
   *   .with('profile')
   *   .get();
   * ```
   */
  with<K extends keyof M & string>(relation: K): ModelQueryBuilder<WithLoaded<M, K> & BaseModel>;
  with(relation: string, constraint: RelationConstraint): this;
  with(relations: Array<string | Record<string, RelationConstraint>>): this;
  with(map: Record<string, RelationConstraint | true>): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  with(arg: unknown, constraint?: RelationConstraint): any {
    if (typeof arg === "string") {
      this._addEager(arg, constraint);
    } else if (Array.isArray(arg)) {
      for (const item of arg) {
        if (typeof item === "string") this._addEager(item);
        else
          for (const [k, v] of Object.entries(item))
            this._addEager(k, typeof v === "function" ? (v as RelationConstraint) : undefined);
      }
    } else if (arg && typeof arg === "object") {
      for (const [k, v] of Object.entries(arg))
        this._addEager(k, typeof v === "function" ? (v as RelationConstraint) : undefined);
    }
    return this;
  }

  private _addEager(path: string, constraint?: RelationConstraint): void {
    const parts = path.split(".");
    let level = this._eagerSpecs;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      let spec = level.find((s) => s.name === name);
      if (!spec) {
        spec = { name, children: [] };
        level.push(spec);
      }
      if (i === parts.length - 1 && constraint) spec.constraint = constraint;
      level = spec.children;
    }
  }

  /**
   * Apply one or more named scopes defined as static methods on the model.
   *
   * The callback receives a proxy whose methods mirror the model's static scope
   * methods; each returns a scope object whose `apply(query)` mutates this builder.
   *
   * @param callback - Receives a proxy of the model's named scopes to invoke.
   * @returns This builder for chaining.
   * @category Scopes
   *
   * @example
   * ```ts
   * User.query().withScopes((s) => { s.active(); s.byScore(50); }).get();
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withScopes(callback: (scopes: any) => void): this {
    const ModelClass = this._ModelClass;
    const proxy = new Proxy({} as Record<string, (...args: unknown[]) => void>, {
      get: (_target, prop: string | symbol) => {
        return (...args: unknown[]) => {
          const fn = (ModelClass as unknown as Record<string | symbol, unknown>)[prop];
          if (typeof fn !== "function") return;
          const result = fn(...args) as { apply?: (q: unknown) => void } | null | undefined;
          if (result != null && typeof result.apply === "function") {
            result.apply(this);
          }
        };
      },
    });
    callback(proxy);
    return this;
  }

  /**
   * Model-aware length-aware pagination — returns hydrated model instances (not
   * raw rows) and honours eager-load chains set via {@link with}.
   *
   * Runs a `count()` for the total, then fetches the page via `limit`/`offset`.
   * `page` and `perPage` are clamped to a minimum of 1.
   *
   * @typeParam T - Element type of the page data (defaults to the model `M`).
   * @param perPage - Rows per page (default 15).
   * @param page - 1-based page number (default 1).
   * @returns A paginate result with `data`, `total`, `page`, `perPage`, `lastPage`
   *   and the standard pagination helpers.
   * @category Pagination
   *
   * @example
   * ```ts
   * const page = await User.query().with('posts').paginate(20, 2);
   * console.log(page.total, page.lastPage, page.data.length);
   * ```
   */
  override paginate<T = M>(
    perPage = 15,
    page?: number,
    pageName = "page",
  ): Promise<PaginateResult<T>> {
    // The base implementation already routes the page fetch through the
    // polymorphic this.get(), and — unlike the copy this replaced — restores
    // limit/offset afterwards so the builder is reusable.
    return super.paginate<T>(perPage, page, pageName);
  }
  /**
   * Model-aware {@link QueryBuilder.simplePaginate} — returns model instances
   * (not raw rows). Defaults the result element type to the model class.
   *
   * @remarks Argument order is `(perPage, page)`, matching {@link paginate}.
   *
   * @typeParam T - Element type of the page data (defaults to the model `M`).
   * @param perPage - Rows per page (default 15).
   * @param page - 1-based page number (default 1).
   * @category Pagination
   */
  override simplePaginate<T = M>(perPage = 15, page = 1): Promise<SimplePaginateResult<T>> {
    return super.simplePaginate<T>(perPage, page);
  }

  /**
   * Model-aware {@link QueryBuilder.cursorPaginate} — returns model instances
   * (not raw rows). Defaults the result element type to the model class.
   *
   * @typeParam T - Element type of the page data (defaults to the model `M`).
   * @param options - Optional `cursor` (last seen id) and `limit`.
   * @category Pagination
   */
  override cursorPaginate<T = M>(options?: {
    cursor?: number;
    limit?: number;
  }): Promise<CursorPaginateResult<T>> {
    return super.cursorPaginate<T>(options);
  }

  /**
   * Model-aware {@link QueryBuilder.keysetPaginate} — returns model instances (not raw
   * rows), with casts applied, `hidden` stripped, eager loads run and global scopes
   * honoured, because it now goes through `get()` like every other terminal.
   *
   * @typeParam T - Element type of the page data (defaults to the model `M`).
   * @param options - Sort `column`, `direction`, `limit` and opaque `cursor`.
   * @category Pagination
   */
  override keysetPaginate<T = M>(options?: KeysetOptions): Promise<KeysetPaginateResult<T>> {
    return super.keysetPaginate<T>(options);
  }

  /**
   * Ties are broken by the model's declared primary key, not a hard-coded `id` — a model
   * keyed on `uuid` or `code` was otherwise ordered and cursored by a column that need not
   * exist.
   * @internal
   */
  protected override _keysetTiebreaker(): string {
    return this._ModelClass.primaryKey;
  }

  // ── Private: Two-Query Dictionary Match ──────────────────────────────────

  private _coerceWhereValue(column: string, value: unknown, operator?: WhereOperator): unknown {
    if (value === null || value === undefined) return value;

    const rawKey = column.split(".").pop() ?? column;
    const camelKey = rawKey.includes("_") ? _toCamel(rawKey) : rawKey;
    const casts = _getCasts(this._ModelClass as unknown as ClassRef);
    const colMeta = columnsFor(this._ModelClass as unknown as ClassRef)?.get(camelKey);
    const castOpt = casts[rawKey] ?? casts[camelKey] ?? colMeta?.cast;
    const colType = colMeta?.type;

    // Before anything binds: an encrypted column cannot be compared. Running the
    // cast's set() here would encrypt the search term under a fresh IV, producing
    // ciphertext that cannot equal what is stored — a query that always returns
    // nothing and never says why. Same failure the created_at note below describes,
    // and permanent rather than occasional, so it is refused outright.
    if (isEncryptedCast(castOpt)) {
      throw encryptedQueryError(`${this._ModelClass.name}.${camelKey}`);
    }

    if (operator === "in" || operator === "not in") {
      if (Array.isArray(value)) {
        return value.map((v) => this._coerceWhereValue(column, v));
      }
      return value;
    }

    if (castOpt && typeof castOpt === "object" && castOpt.set) {
      return castOpt.set(value);
    }
    if (typeof castOpt === "string") {
      return _applyCastSet(value, castOpt as StringCast);
    }
    if (colType === "boolean") {
      return value ? 1 : 0;
    }
    if (colType === "json") {
      // Match how writes encode: strings are stringified too, so a column holding
      // `"051001"` is found by `where("value", "051001")` rather than only by a caller
      // who knows to pre-encode the quotes themselves.
      return JSON.stringify(value);
    }
    // Carbon instances always serialize to ISO string regardless of column metadata.
    if (value instanceof Carbon) return value.toDatabase();
    // …and so does a plain Date. Without this, a comparison against a column the cast
    // lookup above can't see — most importantly the framework-managed `created_at` /
    // `updated_at` / `deleted_at`, which carry no `@column` metadata — bound the Date
    // object itself and matched nothing. `where("created_at", ">=", monthStart)` is the
    // commonest reporting query there is, and it silently returned zero rows: a
    // dashboard reading "0 this month" looks like a quiet month, not a broken query.
    // A Date in a comparison is unambiguous intent, so serialize it the way writes do.
    if (value instanceof Date) {
      return dialectFor(this._sql) === "mysql"
        ? value.toISOString().replace("T", " ").slice(0, 19)
        : value.toISOString();
    }
    return value;
  }

  /**
   * Eager-load a tree of relation specs onto the given instances. For each spec
   * the relation is loaded (optionally constrained), then any nested children
   * are loaded recursively on the freshly-loaded related instances.
   */
  private async _eagerLoadRelations(
    instances: M[],
    specs: EagerSpec[] = this._eagerSpecs,
  ): Promise<void> {
    const metaMap = this._allRelationsMeta();

    for (const spec of specs) {
      const meta = metaMap?.get(spec.name);
      if (!meta) {
        throw new Error(`Relation "${spec.name}" is not defined on ${this._ModelClass.name}`);
      }

      const related = await this._loadOneRelation(instances, spec.name, meta, spec.constraint);

      if (spec.children.length > 0 && related.length > 0) {
        if (meta.type === "morphTo") {
          // Mixed related classes — group by constructor and recurse per group.
          const groups = new Map<ClassRef, BaseModel[]>();
          for (const r of related) {
            const ctor = r.constructor as ClassRef;
            if (!groups.has(ctor)) groups.set(ctor, []);
            groups.get(ctor)!.push(r);
          }
          for (const [ctor, group] of groups) {
            const RelatedClass = ctor as unknown as typeof BaseModel;
            const child = new ModelQueryBuilder(RelatedClass.table, this._sql, RelatedClass);
            await child._eagerLoadRelations(group as M[], spec.children);
          }
        } else {
          const RelatedClass = meta.related() as typeof BaseModel;
          const child = new ModelQueryBuilder(RelatedClass.table, this._sql, RelatedClass);
          await child._eagerLoadRelations(related as M[], spec.children);
        }
      }
    }
  }

  /**
   * Load a single relation onto `instances` and return the flat list of related
   * model instances that were attached (for nested eager loading).
   */
  private async _loadOneRelation(
    instances: M[],
    relation: string,
    meta: import("./relations/RelationRegistry.ts").RelationMetadata,
    constraint?: RelationConstraint,
  ): Promise<BaseModel[]> {
    const RelatedClass = meta.related() as typeof BaseModel;
    const applyConstraint = constraint
      ? (b: unknown) => constraint(b as ModelQueryBuilder<BaseModel>)
      : undefined;

    // Eager-loaded relations honour the related model's soft-delete scope.
    const scopedRelated = (): _ChunkFactory<BaseModel> =>
      _scopedRelated(RelatedClass) as unknown as _ChunkFactory<BaseModel>;

    if (meta.type === "hasManyThrough" || meta.type === "hasOneThrough") {
      return this._loadThrough(
        instances,
        relation,
        meta,
        meta.type === "hasOneThrough",
        applyConstraint,
      );
    }
    if (meta.type === "morphToMany" || meta.type === "morphedByMany") {
      return this._loadMorphToMany(
        instances,
        relation,
        meta,
        meta.type === "morphedByMany",
        applyConstraint,
      );
    }

    // ── manyToMany — pivot table loading ──────────────────────────────
    if (meta.type === "manyToMany") {
      const localKeyProp = _toCamel(meta.localKey);
      const parentIds = [
        ...new Set(
          instances
            .map((i) => (i as unknown as Record<string, unknown>)[localKeyProp])
            .filter((v) => v !== undefined && v !== null),
        ),
      ];

      if (parentIds.length === 0) {
        for (const inst of instances) this._attach(inst, relation, []);
        return [];
      }

      const pivotTable = meta.pivotTable!;
      const pivotFK = meta.pivotForeignKey!;
      const sql = this._sql;
      const pivotRows = await _whereInChunked<Record<string, unknown>>(
        () => new QueryBuilder(pivotTable, sql),
        pivotFK,
        parentIds,
      );

      const relatedIds = [
        ...new Set(pivotRows.map((r) => r[meta.pivotRelatedKey!]).filter((v) => v != null)),
      ];

      if (relatedIds.length === 0) {
        for (const inst of instances) this._attach(inst, relation, []);
        return [];
      }

      const relatedRows = await _whereInChunked<BaseModel>(
        scopedRelated,
        RelatedClass.primaryKey,
        relatedIds,
        applyConstraint,
      );

      const relatedDict = new Map<unknown, BaseModel>();
      for (const rm of relatedRows) {
        relatedDict.set(
          (rm as unknown as Record<string, unknown>)[_toCamel(RelatedClass.primaryKey)],
          rm,
        );
      }

      const hydratePivot = !!(meta.pivotColumns?.length || meta.pivotTimestamps);
      const parentDict = new Map<unknown, BaseModel[]>();
      // The objects actually attached to parents. With `withPivot` each (parent, related)
      // pair gets its own copy so it can carry that pair's pivot row, and it is the copy
      // the parent holds — so nested eager loads have to run against these, not against
      // the shared originals.
      const attached: BaseModel[] = [];
      for (const prow of pivotRows) {
        const parentId = prow[meta.pivotForeignKey!];
        const relatedId = prow[meta.pivotRelatedKey!];
        const rm = relatedDict.get(relatedId);
        if (rm) {
          let item: BaseModel = rm;
          if (hydratePivot) {
            // Copy every own property *descriptor*, not just the enumerable values.
            // `Object.assign` skipped the non-enumerable lazy-load guards, so an unloaded
            // relation on a pivot-hydrated model silently read as `undefined` instead of
            // raising RelationNotLoadedError.
            item = Object.create(
              Object.getPrototypeOf(rm) as object,
              Object.getOwnPropertyDescriptors(rm),
            ) as BaseModel;
            const pivot: Record<string, unknown> = {};
            for (const c of meta.pivotColumns ?? []) pivot[c] = prow[c];
            if (meta.pivotTimestamps) {
              pivot["created_at"] = prow["created_at"];
              pivot["updated_at"] = prow["updated_at"];
            }
            (item as unknown as Record<string, unknown>)["pivot"] = pivot;
          }
          if (!parentDict.has(parentId)) parentDict.set(parentId, []);
          parentDict.get(parentId)!.push(item);
          attached.push(item);
        }
      }

      for (const inst of instances) {
        const pid = (inst as unknown as Record<string, unknown>)[localKeyProp];
        this._attach(
          inst,
          relation,
          _createPivotCollection(
            parentDict.get(pid) ?? [],
            meta.pivotTable!,
            meta.pivotForeignKey!,
            meta.pivotRelatedKey!,
            pid,
            this._sql,
            !!meta.pivotTimestamps,
          ),
        );
      }
      // Deduplicated by identity: the same object can be attached to several parents when
      // pivot data is not being hydrated, and loading its children twice is wasted work.
      return [...new Set(attached)];
    }

    // ── Polymorphic types ──────────────────────────────────────────────
    if (meta.type === "morphTo") {
      return this._eagerLoadMorphTo(instances, relation, meta, applyConstraint);
    }
    if (meta.type === "morphMany") {
      return this._eagerLoadMorphInverse(instances, relation, meta, false, applyConstraint);
    }
    if (meta.type === "morphOne") {
      return this._eagerLoadMorphInverse(instances, relation, meta, true, applyConstraint);
    }

    const isBelongsTo = meta.type === "belongsTo";

    const collectSnake = isBelongsTo ? meta.foreignKey : meta.localKey;
    const queryColumn = isBelongsTo ? meta.localKey : meta.foreignKey;
    const dictSnake = isBelongsTo ? meta.localKey : meta.foreignKey;
    const matchSnake = isBelongsTo ? meta.foreignKey : meta.localKey;

    const collectProp = _toCamel(collectSnake);
    const dictProp = _toCamel(dictSnake);
    const matchProp = _toCamel(matchSnake);

    const keyValues = [
      ...new Set(
        instances
          .map((i) => (i as unknown as Record<string, unknown>)[collectProp])
          .filter((v) => v !== undefined && v !== null),
      ),
    ];

    if (keyValues.length === 0) {
      const empty: unknown = meta.type === "hasMany" ? [] : null;
      if (empty === null && meta.withDefault !== undefined && meta.withDefault !== false) {
        for (const inst of instances) {
          this._attach(inst, relation, _makeDefault(RelatedClass, meta.withDefault));
        }
      } else {
        for (const inst of instances) this._attach(inst, relation, empty);
      }
      return [];
    }

    const relatedRows = await _whereInChunked<BaseModel>(
      scopedRelated,
      queryColumn,
      keyValues,
      applyConstraint,
    );

    const dict = new Map<unknown, BaseModel[]>();
    for (const rm of relatedRows) {
      const key = (rm as unknown as Record<string, unknown>)[dictProp];
      if (!dict.has(key)) dict.set(key, []);
      dict.get(key)!.push(rm);
    }

    for (const inst of instances) {
      const matchVal = (inst as unknown as Record<string, unknown>)[matchProp];
      const matched = dict.get(matchVal) ?? [];
      let value: unknown;
      if (meta.type === "hasMany") {
        value = matched;
      } else {
        value = matched[0] ?? null;
        if (value === null && meta.withDefault !== undefined && meta.withDefault !== false) {
          value = _makeDefault(RelatedClass, meta.withDefault);
        }
      }
      this._attach(inst, relation, value);
    }
    return relatedRows;
  }

  // ── Polymorphic eager loading ─────────────────────────────────────────────

  private async _eagerLoadMorphTo(
    instances: M[],
    relation: string,
    meta: import("./relations/RelationRegistry.ts").RelationMetadata,
    applyConstraint?: (b: unknown) => void,
  ): Promise<BaseModel[]> {
    const typeColProp = _toCamel(meta.morphTypeColumn!);
    const idColProp = _toCamel(meta.foreignKey);
    const collected: BaseModel[] = [];

    const byType = new Map<string, { ids: unknown[]; indices: number[] }>();
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i] as unknown as Record<string, unknown>;
      const tname = inst[typeColProp] as string | null | undefined;
      const id = inst[idColProp];
      if (!tname || id == null) {
        this._attach(instances[i]!, relation, null);
        continue;
      }
      if (!byType.has(tname)) byType.set(tname, { ids: [], indices: [] });
      byType.get(tname)!.ids.push(id);
      byType.get(tname)!.indices.push(i);
    }

    for (const [typeName, { ids, indices }] of byType) {
      const factory = meta.morphMap?.[typeName];
      if (!factory) {
        for (const i of indices) this._attach(instances[i]!, relation, null);
        continue;
      }
      const RelatedClass = factory() as typeof BaseModel;
      const rows = await _whereInChunked<BaseModel>(
        () => _scopedRelated(RelatedClass) as unknown as _ChunkFactory<BaseModel>,
        RelatedClass.primaryKey,
        ids,
        applyConstraint,
      );
      const dict = new Map<unknown, BaseModel>();
      for (const r of rows) {
        dict.set((r as unknown as Record<string, unknown>)[_toCamel(RelatedClass.primaryKey)], r);
      }
      for (let k = 0; k < indices.length; k++) {
        const inst = instances[indices[k]!] as unknown as Record<string, unknown>;
        const matched = dict.get(inst[idColProp]) ?? null;
        this._attach(instances[indices[k]!]!, relation, matched);
        if (matched) collected.push(matched);
      }
    }
    return collected;
  }

  private async _eagerLoadMorphInverse(
    instances: M[],
    relation: string,
    meta: import("./relations/RelationRegistry.ts").RelationMetadata,
    singular: boolean,
    applyConstraint?: (b: unknown) => void,
  ): Promise<BaseModel[]> {
    const RelatedClass = meta.related() as typeof BaseModel;
    const localKeyProp = _toCamel(meta.localKey);
    const typeColumn = meta.morphTypeColumn!;
    const idColumn = meta.foreignKey;
    const typeName = this._ModelClass.name;

    const parentIds = [
      ...new Set(
        instances
          .map((i) => (i as unknown as Record<string, unknown>)[localKeyProp])
          .filter((v) => v != null),
      ),
    ];

    if (parentIds.length === 0) {
      for (const inst of instances) this._attach(inst, relation, singular ? null : []);
      return [];
    }

    const rows = await _whereInChunked<BaseModel>(
      () =>
        _scopedRelated(RelatedClass).where(
          typeColumn,
          typeName,
        ) as unknown as _ChunkFactory<BaseModel>,
      idColumn,
      parentIds,
      applyConstraint,
    );

    const idColProp = _toCamel(idColumn);
    const dict = new Map<unknown, BaseModel[]>();
    for (const r of rows) {
      const key = (r as unknown as Record<string, unknown>)[idColProp];
      if (!dict.has(key)) dict.set(key, []);
      dict.get(key)!.push(r);
    }

    for (const inst of instances) {
      const pid = (inst as unknown as Record<string, unknown>)[localKeyProp];
      const matched = dict.get(pid) ?? [];
      this._attach(inst, relation, singular ? (matched[0] ?? null) : matched);
    }
    return rows;
  }

  // ── has*Through eager loading ──────────────────────────────────────────────

  private async _loadThrough(
    instances: M[],
    relation: string,
    meta: import("./relations/RelationRegistry.ts").RelationMetadata,
    singular: boolean,
    applyConstraint?: (b: unknown) => void,
  ): Promise<BaseModel[]> {
    const Through = meta.through!() as typeof BaseModel;
    const Related = meta.related() as typeof BaseModel;
    const localKeyProp = _toCamel(meta.localKey); // parent PK prop
    const firstKeyProp = _toCamel(meta.firstKey!); // through.<firstKey>
    const throughLocalProp = _toCamel(meta.throughLocalKey!); // through PK prop
    const secondKeyProp = _toCamel(meta.foreignKey); // related.<secondKey>

    const parentIds = [
      ...new Set(
        instances
          .map((i) => (i as unknown as Record<string, unknown>)[localKeyProp])
          .filter((v) => v != null),
      ),
    ];
    if (parentIds.length === 0) {
      for (const inst of instances) this._attach(inst, relation, singular ? null : []);
      return [];
    }

    const throughRows = await _whereInChunked<BaseModel>(
      () => _scopedRelated(Through) as unknown as _ChunkFactory<BaseModel>,
      meta.firstKey!,
      parentIds,
    );
    const throughToParent = new Map<unknown, unknown>();
    const throughKeys: unknown[] = [];
    for (const tr of throughRows) {
      const rec = tr as unknown as Record<string, unknown>;
      throughToParent.set(rec[throughLocalProp], rec[firstKeyProp]);
      throughKeys.push(rec[throughLocalProp]);
    }
    const uniqThrough = [...new Set(throughKeys.filter((v) => v != null))];
    if (uniqThrough.length === 0) {
      for (const inst of instances) this._attach(inst, relation, singular ? null : []);
      return [];
    }

    const relatedRows = await _whereInChunked<BaseModel>(
      () => _scopedRelated(Related) as unknown as _ChunkFactory<BaseModel>,
      meta.foreignKey,
      uniqThrough,
      applyConstraint,
    );

    const parentDict = new Map<unknown, BaseModel[]>();
    for (const rr of relatedRows) {
      const throughId = (rr as unknown as Record<string, unknown>)[secondKeyProp];
      const parentId = throughToParent.get(throughId);
      if (parentId == null) continue;
      if (!parentDict.has(parentId)) parentDict.set(parentId, []);
      parentDict.get(parentId)!.push(rr);
    }

    for (const inst of instances) {
      const pid = (inst as unknown as Record<string, unknown>)[localKeyProp];
      const matched = parentDict.get(pid) ?? [];
      this._attach(inst, relation, singular ? (matched[0] ?? null) : matched);
    }
    return relatedRows;
  }

  // ── morphToMany / morphedByMany eager loading ──────────────────────────────

  private async _loadMorphToMany(
    instances: M[],
    relation: string,
    meta: import("./relations/RelationRegistry.ts").RelationMetadata,
    inverse: boolean,
    applyConstraint?: (b: unknown) => void,
  ): Promise<BaseModel[]> {
    const Related = meta.related() as typeof BaseModel;
    const localKeyProp = _toCamel(meta.localKey);
    const pivotTable = meta.pivotTable!;
    const pivotFK = meta.pivotForeignKey!;
    const pivotRK = meta.pivotRelatedKey!;
    const morphType = meta.pivotMorphType!;
    const morphValue = inverse ? Related.name : this._ModelClass.name;
    const sql = this._sql;

    const parentIds = [
      ...new Set(
        instances
          .map((i) => (i as unknown as Record<string, unknown>)[localKeyProp])
          .filter((v) => v != null),
      ),
    ];
    if (parentIds.length === 0) {
      for (const inst of instances) this._attach(inst, relation, []);
      return [];
    }

    const pivotRows = await _whereInChunked<Record<string, unknown>>(
      () =>
        new QueryBuilder(pivotTable, sql).where(morphType, morphValue) as unknown as _ChunkFactory<
          Record<string, unknown>
        >,
      pivotFK,
      parentIds,
    );

    const relatedIds = [...new Set(pivotRows.map((r) => r[pivotRK]).filter((v) => v != null))];
    if (relatedIds.length === 0) {
      for (const inst of instances) this._attach(inst, relation, []);
      return [];
    }

    const relatedRows = await _whereInChunked<BaseModel>(
      () => _scopedRelated(Related) as unknown as _ChunkFactory<BaseModel>,
      Related.primaryKey,
      relatedIds,
      applyConstraint,
    );
    const relatedDict = new Map<unknown, BaseModel>();
    for (const rm of relatedRows) {
      relatedDict.set((rm as unknown as Record<string, unknown>)[_toCamel(Related.primaryKey)], rm);
    }

    const parentDict = new Map<unknown, BaseModel[]>();
    for (const prow of pivotRows) {
      const parentId = prow[pivotFK];
      const rm = relatedDict.get(prow[pivotRK]);
      if (rm) {
        if (!parentDict.has(parentId)) parentDict.set(parentId, []);
        parentDict.get(parentId)!.push(rm);
      }
    }

    for (const inst of instances) {
      const pid = (inst as unknown as Record<string, unknown>)[localKeyProp];
      this._attach(inst, relation, parentDict.get(pid) ?? []);
    }
    return relatedRows;
  }

  /** Write the loaded value via Object.defineProperty, overwriting the lazy-load guard. */
  private _attach(inst: M, relation: string, value: unknown): void {
    Object.defineProperty(inst, relation, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function _cloneSpec(s: EagerSpec): EagerSpec {
  return {
    name: s.name,
    ...(s.constraint ? { constraint: s.constraint } : {}),
    children: s.children.map(_cloneSpec),
  };
}

/** Build a default (unsaved) related instance for belongsTo/hasOne withDefault. */
function _makeDefault(
  RelatedClass: typeof BaseModel,
  spec: boolean | Record<string, unknown> | ((m: unknown) => void),
): BaseModel {
  const inst = new (RelatedClass as unknown as new () => BaseModel)();
  if (typeof spec === "function") spec(inst);
  else if (spec && typeof spec === "object") Object.assign(inst, spec);
  return inst;
}
