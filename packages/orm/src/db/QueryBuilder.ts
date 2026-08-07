import type { SQLInstance } from "./sql-types.ts";
import { RequestContext, rescueSync, FrameworkEvents, currentPage } from "@zerotal/core";
import { Carbon } from "@zerotal/core/carbon";
import { toCamelKey } from "../support/identifiers.ts";
import { QueryExecuted } from "../events.ts";
import { trackQuery } from "./NPlusOneDetector.ts";
import { TransactionContext } from "./TransactionContext.ts";
import { getDialect } from "./dialects/index.ts";
import type {
  WhereOperator,
  OrderDirection,
  WhereClause,
  HavingClause,
  QueryState,
  JoinType,
  PaginateResult,
  CursorPaginateResult,
  KeysetOptions,
  KeysetPaginateResult,
  SimplePaginateResult,
} from "./types.ts";
import { withPaginationHelpers, withSimplePaginationHelpers } from "./types.ts";

/**
 * The comparison operators accepted in a value-comparison slot. Exported so
 * {@link ModelQueryBuilder} shares the exact same set — both classes use
 * membership here as the 2-arg-vs-3-arg dispatch heuristic in `where()`, and
 * two drifting copies would make base and subclass disagree about whether
 * argument two is an operator or a value.
 */
export const OPERATORS = new Set<string>([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "like",
  "not like",
  "in",
  "not in",
]);
const COLUMN_OPERATORS = new Set<string>(["=", "!=", ">", ">=", "<", "<=", "<>"]);

/**
 * Reject an operator that is not on the allowlist.
 *
 * An operator slot is interpolated into SQL, not bound, so it is an identifier-class input
 * and gets identifier-class treatment: allowlist, never escaping. A slot that skips this is
 * a full injection point even though the binding count stays correct — the 2026-07 audit
 * found `whereDate('created_at', req.query.op, …)` accepting
 * `"IS NOT NULL OR 1=1 OR date(created_at) ="`, which escapes the AND chain and defeats
 * tenant scoping, ownership filters and the soft-delete scope in one string.
 *
 * @param op - Candidate operator.
 * @param fn - Calling method name, for the error message.
 * @throws {Error} When `op` is not a known comparison operator.
 */
function _assertOperator(op: string, fn: string): void {
  if (!OPERATORS.has(op) && !COLUMN_OPERATORS.has(op)) {
    throw new Error(`[Zerotal ORM] ${fn}: unsupported operator "${op}".`);
  }
}

/**
 * Sort directions that may be interpolated into `ORDER BY`.
 * The compile-time `"asc" | "desc"` type is not a runtime check — a direction arriving from
 * a query string is just a string, and `orderBy("name", "desc; DROP TABLE users --")`
 * compiled to exactly that.
 */
const SORT_DIRECTIONS = new Set<string>(["asc", "desc"]);

/**
 * Normalise and validate a sort direction.
 *
 * @param direction - Candidate direction, any casing.
 * @param fn - Calling method name, for the error message.
 * @returns The lowercased direction.
 * @throws {Error} When `direction` is not `asc` or `desc`.
 */
function _assertDirection(direction: string, fn: string): "asc" | "desc" {
  const normalised = direction.toLowerCase();
  if (!SORT_DIRECTIONS.has(normalised)) {
    throw new Error(
      `[Zerotal ORM] ${fn}: direction must be "asc" or "desc", received "${direction}".`,
    );
  }
  return normalised as "asc" | "desc";
}

/**
 * A compiled query fragment: either a literal SQL string, or `{ val }` marking
 * a value to be sent through a parameterised binding (`?` placeholder).
 */
export type Segment = string | { val: unknown };

// ── Dialect awareness ─────────────────────────────────────────────────────────
// QueryBuilder is dialect-light, but a few features differ across engines:
//   - pessimistic row locks (FOR UPDATE / FOR SHARE) are unsupported on SQLite
//   - random ordering is RAND() on MySQL, RANDOM() elsewhere
// The active dialect is set once at boot (DatabaseProvider / _setBaseModelDialect).

/** The database engines the builder can target. */
export type Dialect = "sqlite" | "postgres" | "mysql";

/** Global default dialect — used for connections not explicitly registered. */
let _dialect: Dialect = "sqlite";

/** @internal Set the global default dialect (lock + random-order SQL). */
export function _setQueryBuilderDialect(d: Dialect): void {
  _dialect = d;
}

const _connectionDialects = new WeakMap<object, Dialect>();

/**
 * Associate a specific connection object with a dialect, overriding the global
 * default for queries run on that connection.
 */
export function registerConnectionDialect(conn: object, d: Dialect): void {
  _connectionDialects.set(conn, d);
}

/**
 * Resolve the dialect for a connection — its registered dialect if any,
 * otherwise the global default.
 */
export function dialectFor(conn: object | undefined | null): Dialect {
  return (conn ? _connectionDialects.get(conn) : undefined) ?? _dialect;
}

// ── Prepared-statement cache ──────────────────────────────────────────────────
//
// Bun.sql identifies prepared statements by the *object identity* of the
// TemplateStringsArray passed to the tagged-template call.  Generating a fresh
// array on every query (via Object.assign) defeats that cache entirely.
//
// This Map interns arrays by their joined SQL fragments so identical query
// shapes reuse the same object reference, giving Bun.sql a 100% cache-hit rate
// for any query shape seen more than once.
const _tplCache = new Map<string, TemplateStringsArray>();

// Upper bound on interned template shapes. Most apps produce a small, fixed
// set of query shapes, but `whereIn()` with varying list lengths mints a new
// shape per cardinality — without a cap the map grows for the process
// lifetime. On overflow the oldest entry is evicted (Map preserves insertion
// order), keeping the hot path a single Map lookup.
const _TPL_CACHE_MAX = 500;

const _SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
// having() additionally accepts a simple aggregate wrapper, e.g. SUM(score) or COUNT(*).
const _SAFE_AGGREGATE = /^[a-zA-Z_][a-zA-Z0-9_]*\(\s*(?:\*|[a-zA-Z_][a-zA-Z0-9_.]*)\s*\)$/;

function _isSafeIdentifier(s: string): boolean {
  return _SAFE_IDENTIFIER.test(s);
}

/**
 * @internal Throw unless `s` is a safe (optionally dotted) SQL identifier.
 * Every identifier interpolated into SQL — column names, table names — must
 * pass through here; values always flow through tagged-template bindings.
 * Raw expressions belong in the documented escape hatches (selectRaw,
 * whereRaw, orderByRaw).
 */
export function _assertIdentifier(s: string, where: string): void {
  if (!_isSafeIdentifier(s)) {
    throw new Error(
      `[Zerotal ORM] ${where}: unsafe identifier "${s}". Must match /^[a-zA-Z_][a-zA-Z0-9_.]*$/.`,
    );
  }
}

/** Like _assertIdentifier, but also allows a simple aggregate such as SUM(score). */
function _assertIdentifierOrAggregate(s: string, where: string): void {
  if (_SAFE_IDENTIFIER.test(s) || _SAFE_AGGREGATE.test(s)) return;
  throw new Error(
    `[Zerotal ORM] ${where}: unsafe column expression "${s}". ` +
      `Expected an identifier or a simple aggregate like SUM(score).`,
  );
}

// A single SELECT-list entry: a column (`name`, `users.id`), a star (`*`,
// `users.*`), or a simple aggregate (`COUNT(*)`, `SUM(score)`) — each with an
// optional `[AS] alias`. Deliberately rejects subqueries, commas, and operators
// so nothing but selectRaw() can smuggle raw SQL into the projection.
const _SAFE_SELECT_EXPRESSION =
  /^(?:\*|[a-zA-Z_][a-zA-Z0-9_]*\.\*|[a-zA-Z_][a-zA-Z0-9_]*\(\s*(?:\*|[a-zA-Z_][a-zA-Z0-9_.]*)\s*\)|[a-zA-Z_][a-zA-Z0-9_.]*)(?:\s+(?:as\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?$/i;

/**
 * @internal Throw unless `s` is a safe SELECT-list entry. Guards the projection
 * (select/pluck/value) the same way {@link _assertIdentifier} guards where/order
 * columns. Raw projection SQL belongs in the `selectRaw()` escape hatch.
 */
function _assertSelectExpression(s: string, where: string): void {
  if (!_SAFE_SELECT_EXPRESSION.test(s)) {
    throw new Error(
      `[Zerotal ORM] ${where}: unsafe select expression "${s}". ` +
        `Expected a column, table.*, or a simple aggregate; use selectRaw() for raw SQL.`,
    );
  }
}

function _getCachedTemplate(strings: string[]): TemplateStringsArray {
  const key = strings.join("\x00");
  let tpl = _tplCache.get(key);
  if (!tpl) {
    const arr = [...strings];
    tpl = Object.assign(arr, { raw: arr }) as TemplateStringsArray;
    if (_tplCache.size >= _TPL_CACHE_MAX) {
      // FIFO eviction: drop the oldest interned shape.
      const oldest = _tplCache.keys().next().value;
      if (oldest !== undefined) _tplCache.delete(oldest);
    }
    _tplCache.set(key, tpl);
  }
  return tpl;
}

/**
 * @internal Execute compiled segments on `conn` with prepared-template
 * interning and QueryExecuted telemetry. Shared by `QueryBuilder._run` and
 * the BaseModel write paths so every query — builder reads and model writes
 * alike — emits the same events.
 */
export async function _runSegments<T = Record<string, unknown>>(
  conn: SQLInstance,
  segs: Segment[],
  trackNPlusOne = false,
): Promise<T[]> {
  const strings: string[] = [];
  const values: unknown[] = [];
  let current = "";

  for (const seg of segs) {
    if (typeof seg === "string") {
      current += seg;
    } else {
      strings.push(current);
      current = "";
      values.push(seg.val);
    }
  }
  strings.push(current);

  const cacheKey = strings.join("\x00");
  const tpl = _getCachedTemplate(strings);
  const ctx = RequestContext.tryGet();
  if (trackNPlusOne) trackQuery(ctx, cacheKey);

  const startMs = Date.now();
  const rows = await conn<T>(tpl, ...values);
  const durationMs = Date.now() - startMs;
  FrameworkEvents.emit(
    new QueryExecuted(
      cacheKey.replace(/\x00/g, "?"),
      values,
      startMs,
      durationMs,
      Array.isArray(rows) ? rows.length : 0,
      ctx,
    ),
  );
  return rows;
}

/**
 * Fluent, low-level SQL query builder over a {@link SQLInstance} (Bun.sql).
 *
 * Chain methods to describe a query, then call a terminal ({@link get},
 * {@link first}, {@link count}, {@link insert}, {@link update}, {@link delete}, …)
 * to compile and execute it. Every builder method returns `this`, so calls
 * chain. This is the engine beneath `DB.table()` and the model query builder;
 * most application code reaches it through those, but it can be used directly.
 *
 * @remarks
 * **Safety model.** User-supplied *values* always flow through Bun.sql
 * tagged-template bindings (`?` placeholders) — they are never string-concatenated
 * into SQL. User-supplied *identifiers* (column, table, alias, group/order
 * columns) are interpolated into the SQL text and are therefore forced through an
 * identifier-assertion allowlist (`/^[a-zA-Z_][a-zA-Z0-9_.]*$/`, plus a simple
 * aggregate form for {@link having}); anything else throws.
 *
 * Not every method asserts, and the differences are load-bearing:
 * - {@link where}, {@link whereIn}, {@link orderBy}, {@link groupBy},
 *   {@link having}, {@link join}, the aggregates and the write methods DO assert
 *   their identifiers.
 * - {@link select} asserts each entry as a safe SELECT expression;
 *   {@link selectRaw} does NOT — it interpolates verbatim, so never pass user
 *   input to it.
 * - The raw escape hatches {@link selectRaw}, {@link whereRaw}, {@link orderByRaw}
 *   inject their SQL verbatim and are **trusted-input only**; pass dynamic values
 *   through their bindings argument, never by concatenation.
 *
 * A few features are dialect-aware (row locks are no-ops on SQLite; random
 * ordering is `RAND()` on MySQL and `RANDOM()` elsewhere; date-part extraction
 * differs per engine).
 *
 * @example
 * ```ts
 * // Read: where → order → limit → fetch
 * const users = await DB.table('users')
 *   .where('active', true)
 *   .where('age', '>=', 18)
 *   .orderBy('created_at', 'desc')
 *   .limit(10)
 *   .get();
 *
 * // Write
 * await DB.table('users').insert({ email: 'a@example.com', active: true });
 * await DB.table('users').where('id', 1).update({ active: false });
 * ```
 *
 * @category Select
 */
export class QueryBuilder {
  protected _state: QueryState;
  protected _sql: SQLInstance;

  /**
   * Index into `_state.wheres` at which caller-supplied predicates begin.
   *
   * Anything before it was injected by the framework (currently the soft-delete predicate
   * seeded in `BaseModel.query()`) and must stay outside the group built by
   * {@link _groupUserWheres}. Defaults to 0 for a plain `DB.table()` builder, which has no
   * framework predicates.
   */
  protected _userWhereStart = 0;

  /**
   * Identifier-ingress hook: every caller-supplied column name passes through
   * here exactly once, at the point it enters builder state. The base builder
   * is identity; {@link ModelQueryBuilder} overrides it to resolve camelCase
   * model properties to snake_case columns. Centralising the seam is what
   * guarantees *every* column-taking method resolves — the previous
   * per-method overrides had drifted (`whereIn` resolved, `whereNotIn` did
   * not; `orWhereNotLike` was the only LIKE variant left out; the pagination
   * option columns were never touched).
   * @internal
   */
  protected _column(column: string): string {
    return column;
  }

  /**
   * Value-ingress hook: a value bound alongside a column passes through here.
   * The base builder is identity; {@link ModelQueryBuilder} overrides it to
   * coerce through the column's cast metadata (Carbon → DB string, boolean →
   * 0/1, …), so `whereBetween('createdAt', [a, b])` coerces the same way
   * `where('createdAt', '>=', a)` always has.
   * @internal
   */
  protected _bind(column: string, value: unknown, operator?: WhereOperator): unknown {
    void column;
    void operator;
    return value;
  }

  constructor(table: string, sql: SQLInstance) {
    // Subquery builders start with an empty table (set later via from()).
    if (table) _assertIdentifier(table, "table name");
    this._state = {
      table,
      selects: [],
      distinct: false,
      joins: [],
      wheres: [],
      orders: [],
      groupBys: [],
      havings: [],
      unions: [],
      limit: undefined,
      offset: undefined,
      lock: undefined,
    };
    this._sql = sql;
  }

  // ── Builder ───────────────────────────────────────────────────────────

  /**
   * Change the table this query targets. Useful for subquery builders that
   * start with an empty table.
   *
   * @param table - Table name; asserted as a safe identifier.
   * @throws {Error} When `table` is not a safe SQL identifier.
   * @category Select
   */
  from(table: string): this {
    _assertIdentifier(table, "from()");
    this._state.table = table;
    return this;
  }

  /**
   * Add columns to the SELECT list. Called with no columns the query selects
   * `*`. Repeated calls accumulate.
   *
   * @remarks
   * Each column is asserted as a safe SELECT entry (a column, `table.*`, or a
   * simple aggregate, with an optional `[AS] alias`) — the same identifier guard
   * the where/order builders use. For raw projection SQL, use {@link selectRaw}.
   *
   * @throws {Error} When a column is not a safe select expression.
   * @category Select
   */
  select(...columns: string[]): this {
    const cols = columns.map((c) => this._column(c));
    for (const c of cols) _assertSelectExpression(c, "select()");
    this._state.selects.push(...cols);
    return this;
  }

  /**
   * Emit `SELECT DISTINCT`.
   * @category Select
   */
  distinct(): this {
    this._state.distinct = true;
    return this;
  }

  /**
   * Add an `AND` WHERE clause. Two-arg form defaults the operator to `=`; the
   * three-arg form takes an explicit operator (`=`, `!=`, `>`, `>=`, `<`, `<=`,
   * `like`, `not like`, `in`, `not in`). The column is asserted; the value is
   * always bound.
   *
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   * @example
   * ```ts
   * DB.table('users').where('active', true).where('age', '>=', 18);
   * ```
   */
  where(column: string, value: unknown): this;
  where(column: string, operator: WhereOperator, value: unknown): this;
  where(group: (query: this) => void): this;
  where(
    columnOrGroup: string | ((query: this) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrGroup === "function") {
      return this._addWhereGroup(columnOrGroup, "and");
    }
    if (typeof operatorOrValue === "string" && OPERATORS.has(operatorOrValue)) {
      this._addWhere(columnOrGroup, operatorOrValue as WhereOperator, value, "and");
    } else {
      this._addWhere(columnOrGroup, "=", operatorOrValue, "and");
    }
    return this;
  }

  /**
   * Add an `OR` WHERE clause. Same operator/value semantics as {@link where}.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhere(column: string, value: unknown): this;
  orWhere(column: string, operator: WhereOperator, value: unknown): this;
  orWhere(group: (query: this) => void): this;
  orWhere(
    columnOrGroup: string | ((query: this) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrGroup === "function") {
      return this._addWhereGroup(columnOrGroup, "or");
    }
    const column = columnOrGroup;
    if (typeof operatorOrValue === "string" && OPERATORS.has(operatorOrValue)) {
      this._addWhere(column, operatorOrValue as WhereOperator, value, "or");
    } else {
      this._addWhere(column, "=", operatorOrValue, "or");
    }
    return this;
  }

  /**
   * `AND column IN (…)`. Each value is bound. An empty list compiles to a
   * constant-false predicate (`1 = 0`) so no rows match.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereIn(column: string, values: unknown[]): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereIn()");
    const vals = values.map((v) => this._bind(col, v));
    this._state.wheres.push({ column: col, operator: "in", value: vals, boolean: "and" });
    return this;
  }

  /**
   * `OR column IN (…)`. See {@link whereIn}.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereIn(column: string, values: unknown[]): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereIn()");
    const vals = values.map((v) => this._bind(col, v));
    this._state.wheres.push({ column: col, operator: "in", value: vals, boolean: "or" });
    return this;
  }

  /**
   * `AND column NOT IN (…)`. An empty list compiles to a constant-true
   * predicate (`1 = 1`) so all rows match.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereNotIn(column: string, values: unknown[]): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereNotIn()");
    const vals = values.map((v) => this._bind(col, v));
    this._state.wheres.push({ column: col, operator: "not in", value: vals, boolean: "and" });
    return this;
  }

  /**
   * `OR column NOT IN (…)`. See {@link whereNotIn}.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereNotIn(column: string, values: unknown[]): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereNotIn()");
    const vals = values.map((v) => this._bind(col, v));
    this._state.wheres.push({ column: col, operator: "not in", value: vals, boolean: "or" });
    return this;
  }

  /**
   * `AND column IS NULL`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereNull(column: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereNull()");
    this._state.wheres.push({ column: col, operator: "is null", value: null, boolean: "and" });
    return this;
  }

  /**
   * `OR column IS NULL`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereNull(column: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereNull()");
    this._state.wheres.push({ column: col, operator: "is null", value: null, boolean: "or" });
    return this;
  }

  /**
   * `AND column IS NOT NULL`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereNotNull(column: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereNotNull()");
    this._state.wheres.push({ column: col, operator: "is not null", value: null, boolean: "and" });
    return this;
  }

  /**
   * `OR column IS NOT NULL`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereNotNull(column: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereNotNull()");
    this._state.wheres.push({ column: col, operator: "is not null", value: null, boolean: "or" });
    return this;
  }

  // ── Range / column / date / pattern filters ───────────────────────────

  /**
   * `AND column BETWEEN ? AND ?` — both bounds bound as values.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereBetween(column: string, range: [unknown, unknown]): this {
    return this._between(column, range, false, "and");
  }

  /**
   * `OR column BETWEEN ? AND ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereBetween(column: string, range: [unknown, unknown]): this {
    return this._between(column, range, false, "or");
  }

  /**
   * `AND column NOT BETWEEN ? AND ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereNotBetween(column: string, range: [unknown, unknown]): this {
    return this._between(column, range, true, "and");
  }

  /**
   * `OR column NOT BETWEEN ? AND ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereNotBetween(column: string, range: [unknown, unknown]): this {
    return this._between(column, range, true, "or");
  }

  /** Shared BETWEEN builder: one resolution + coercion + assertion site for the four variants. */
  private _between(
    column: string,
    range: [unknown, unknown],
    negate: boolean,
    boolean: "and" | "or",
  ): this {
    const col = this._column(column);
    _assertIdentifier(col, negate ? "whereNotBetween()" : "whereBetween()");
    const bounds = [this._bind(col, range[0]), this._bind(col, range[1])];
    return this._pushRaw(`${col} ${negate ? "NOT " : ""}BETWEEN ? AND ?`, bounds, boolean);
  }

  /**
   * Compare two columns instead of a column to a value:
   * `whereColumn('updated_at', '>', 'created_at')`. With two arguments the
   * operator defaults to `=`. Both column names are asserted.
   * @throws {Error} When either column is unsafe or the operator is unsupported.
   * @category Where clauses
   */
  whereColumn(first: string, operatorOrSecond: string, second?: string): this {
    return this._whereColumn(first, operatorOrSecond, second, "and");
  }

  /**
   * `OR` form of {@link whereColumn}.
   * @throws {Error} When either column is unsafe or the operator is unsupported.
   * @category Where clauses
   */
  orWhereColumn(first: string, operatorOrSecond: string, second?: string): this {
    return this._whereColumn(first, operatorOrSecond, second, "or");
  }

  private _whereColumn(
    first: string,
    operatorOrSecond: string,
    second: string | undefined,
    boolean: "and" | "or",
  ): this {
    const op = second === undefined ? "=" : operatorOrSecond;
    const col1 = this._column(first);
    const col2 = this._column(second === undefined ? operatorOrSecond : second);
    _assertIdentifier(col1, "whereColumn()");
    _assertIdentifier(col2, "whereColumn()");
    if (!COLUMN_OPERATORS.has(op))
      throw new Error(`[Zerotal ORM] whereColumn(): unsupported operator "${op}".`);
    return this._pushRaw(`${col1} ${op} ${col2}`, [], boolean);
  }

  /**
   * Filter on the date portion of a timestamp column. Two-arg form defaults the
   * operator to `=`. The date-extraction SQL is dialect-specific.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereDate(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this._dateFn("date", column, operatorOrValue, value, "and");
  }
  /**
   * Filter on the time portion of a timestamp column. See {@link whereDate}.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereTime(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this._dateFn("time", column, operatorOrValue, value, "and");
  }
  /**
   * Filter on the day-of-month component of a timestamp column.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereDay(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this._dateFn("day", column, operatorOrValue, value, "and");
  }
  /**
   * Filter on the month component of a timestamp column.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereMonth(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this._dateFn("month", column, operatorOrValue, value, "and");
  }
  /**
   * Filter on the year component of a timestamp column.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereYear(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this._dateFn("year", column, operatorOrValue, value, "and");
  }

  private _dateFn(
    kind: "date" | "time" | "day" | "month" | "year",
    column: string,
    operatorOrValue: unknown,
    value: unknown,
    boolean: "and" | "or",
  ): this {
    const col = this._column(column);
    _assertIdentifier(col, `where${kind}()`);
    const hasOp = value !== undefined && typeof operatorOrValue === "string";
    const op = hasOp ? (operatorOrValue as string) : "=";
    if (hasOp) _assertOperator(op, `where${kind}()`);
    // The value is a date *fragment* ('2026-01-01', 14, 'May') compared against
    // the extracted part — deliberately NOT passed through _bind, whose cast
    // coercion would turn a Carbon into a full timestamp and break equality.
    const val = hasOp ? value : operatorOrValue;
    // Date-part extraction differs per engine (strftime vs EXTRACT vs DAY()).
    const expr = getDialect(dialectFor(this._sql)).dateExpr(kind, col);
    return this._pushRaw(`${expr} ${op} ?`, [val], boolean);
  }

  /**
   * `AND column LIKE ?` — the pattern is bound as a value.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereLike(column: string, value: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereLike()");
    return this._pushRaw(`${col} LIKE ?`, [value], "and");
  }
  /**
   * `OR column LIKE ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereLike(column: string, value: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereLike()");
    return this._pushRaw(`${col} LIKE ?`, [value], "or");
  }
  /**
   * `AND column NOT LIKE ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  whereNotLike(column: string, value: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "whereNotLike()");
    return this._pushRaw(`${col} NOT LIKE ?`, [value], "and");
  }
  /**
   * `OR column NOT LIKE ?`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Where clauses
   */
  orWhereNotLike(column: string, value: string): this {
    const col = this._column(column);
    _assertIdentifier(col, "orWhereNotLike()");
    return this._pushRaw(`${col} NOT LIKE ?`, [value], "or");
  }

  /**
   * Match when ANY of the columns satisfies the operator/value, as a
   * parenthesised `OR` group. Each column is asserted and the value is bound
   * once per column.
   * @throws {Error} When a column is unsafe or the operator is unsupported.
   * @category Where clauses
   */
  whereAny(columns: string[], operator: string, value: unknown): this {
    return this._whereMany(columns, operator, value, "OR", "and");
  }
  /**
   * Match when ALL of the columns satisfy the operator/value, as a
   * parenthesised `AND` group.
   * @throws {Error} When a column is unsafe or the operator is unsupported.
   * @category Where clauses
   */
  whereAll(columns: string[], operator: string, value: unknown): this {
    return this._whereMany(columns, operator, value, "AND", "and");
  }

  private _whereMany(
    columns: string[],
    operator: string,
    value: unknown,
    glue: "OR" | "AND",
    boolean: "and" | "or",
  ): this {
    if (!OPERATORS.has(operator))
      throw new Error(`[Zerotal ORM] whereAny/whereAll(): unsupported operator "${operator}".`);
    // One shared value across N columns whose casts may differ — resolved per
    // column, but deliberately not cast-coerced (coercion is per-column and
    // there is only one value).
    const cols = columns.map((c) => this._column(c));
    for (const c of cols) _assertIdentifier(c, "whereAny/whereAll()");
    const frag = cols.map((c) => `${c} ${operator} ?`).join(` ${glue} `);
    return this._pushRaw(
      `(${frag})`,
      cols.map(() => value),
      boolean,
    );
  }

  /**
   * `AND EXISTS (subquery)`. The callback receives a fresh {@link QueryBuilder}
   * to build the correlated subquery; its bindings are merged into the parent.
   * @category Where clauses
   * @example
   * ```ts
   * DB.table('users').whereExists((q) =>
   *   q.from('orders').whereColumn('orders.user_id', 'users.id'));
   * ```
   */
  whereExists(callback: (q: QueryBuilder) => void): this {
    return this._whereExists(callback, "EXISTS", "and");
  }
  /**
   * `OR EXISTS (subquery)`. See {@link whereExists}.
   * @category Where clauses
   */
  orWhereExists(callback: (q: QueryBuilder) => void): this {
    return this._whereExists(callback, "EXISTS", "or");
  }
  /**
   * `AND NOT EXISTS (subquery)`. See {@link whereExists}.
   * @category Where clauses
   */
  whereNotExists(callback: (q: QueryBuilder) => void): this {
    return this._whereExists(callback, "NOT EXISTS", "and");
  }
  /**
   * `OR NOT EXISTS (subquery)`. See {@link whereExists}.
   * @category Where clauses
   */
  orWhereNotExists(callback: (q: QueryBuilder) => void): this {
    return this._whereExists(callback, "NOT EXISTS", "or");
  }

  private _whereExists(
    callback: (q: QueryBuilder) => void,
    kw: string,
    boolean: "and" | "or",
  ): this {
    const sub = new QueryBuilder("", this._sql);
    callback(sub);
    const { sql, bindings } = sub._compileSelect();
    return this._pushRaw(`${kw} (${sql})`, bindings, boolean);
  }

  /**
   * Order by a column. The column must be a safe identifier — for raw SQL
   * expressions (e.g. `RANDOM()`) use {@link orderByRaw}.
   *
   * @param direction - `'asc'` (default) or `'desc'`, any casing.
   * @throws {Error} When `column` is not a safe SQL identifier, or `direction` is neither
   *   `asc` nor `desc` — the `OrderDirection` type is a compile-time hint, and a direction
   *   read off a query string arrives as an unchecked string.
   * @category Ordering & grouping
   */
  orderBy(column: string, direction: OrderDirection = "asc"): this {
    const col = this._column(column);
    _assertIdentifier(col, "orderBy()");
    this._state.orders.push({ column: col, direction: _assertDirection(direction, "orderBy()") });
    return this;
  }

  /**
   * Order descending by a column. Shorthand for `orderBy(column, 'desc')`.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  orderByDesc(column: string): this {
    return this.orderBy(column, "desc");
  }

  /**
   * Order descending by a column (default the primary key `id`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  desc(column = "id"): this {
    return this.orderBy(column, "desc");
  }

  /**
   * Order ascending by a column (default the primary key `id`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  asc(column = "id"): this {
    return this.orderBy(column, "asc");
  }

  /**
   * Order newest-first by a timestamp column (default `created_at`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  latest(column = "created_at"): this {
    return this.orderBy(column, "desc");
  }

  /**
   * Order oldest-first by a timestamp column (default `created_at`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  oldest(column = "created_at"): this {
    return this.orderBy(column, "asc");
  }

  /**
   * Randomise row order — `RAND()` on MySQL, `RANDOM()` on SQLite/Postgres.
   * @category Ordering & grouping
   */
  inRandomOrder(): this {
    return this.orderByRaw(dialectFor(this._sql) === "mysql" ? "RAND()" : "RANDOM()");
  }

  /**
   * Clear all ORDER BY clauses; optionally apply a new one.
   * @throws {Error} When a replacement `column` is given and is unsafe.
   * @category Ordering & grouping
   */
  reorder(column?: string, direction: OrderDirection = "asc"): this {
    this._state.orders = [];
    if (column) this.orderBy(column, direction);
    return this;
  }

  /**
   * Add columns to the `GROUP BY` clause. Each column is asserted.
   * @throws {Error} When any column is not a safe SQL identifier.
   * @category Ordering & grouping
   */
  groupBy(...columns: string[]): this {
    const cols = columns.map((c) => this._column(c));
    for (const c of cols) _assertIdentifier(c, "groupBy()");
    this._state.groupBys.push(...cols);
    return this;
  }

  /**
   * Add a HAVING clause. The column may be a plain identifier or a simple
   * aggregate such as `SUM(score)`; the value is always bound. Two-arg form
   * defaults the operator to `=`. Multiple HAVING clauses are joined with `AND`.
   *
   * @throws {Error} When `column` is neither a safe identifier nor a simple
   *   aggregate, or when the operator is unsupported.
   * @category Ordering & grouping
   * @example
   * ```ts
   * DB.table('orders').groupBy('user_id').having('SUM(total)', '>', 100);
   * ```
   */
  having(column: string, operatorOrValue: unknown, value?: unknown): this {
    // Aggregate forms like SUM(score) pass through _column unchanged (the
    // resolver's raw-expression guard skips anything beyond identifier chars).
    const col = this._column(column);
    _assertIdentifierOrAggregate(col, "having()");
    const op = value !== undefined ? String(operatorOrValue) : "=";
    const val = value !== undefined ? value : operatorOrValue;
    if (!OPERATORS.has(op) && !COLUMN_OPERATORS.has(op))
      throw new Error(`[Zerotal ORM] having(): unsupported operator "${op}".`);
    this._state.havings.push({ column: col, operator: op, value: val } satisfies HavingClause);
    return this;
  }

  // ── Joins ─────────────────────────────────────────────────────────────

  /**
   * `INNER JOIN table ON first <operator> second`. The table and both columns
   * are asserted; the operator is checked against the column-comparison set.
   * @throws {Error} When an identifier is unsafe or the operator is unsupported.
   * @category Joins
   * @example
   * ```ts
   * DB.table('users').join('orders', 'users.id', '=', 'orders.user_id');
   * ```
   */
  join(table: string, first: string, operator: string, second: string): this {
    return this._addJoin("inner", table, first, operator, second);
  }
  /**
   * `LEFT JOIN`. See {@link join}.
   * @throws {Error} When an identifier is unsafe or the operator is unsupported.
   * @category Joins
   */
  leftJoin(table: string, first: string, operator: string, second: string): this {
    return this._addJoin("left", table, first, operator, second);
  }
  /**
   * `RIGHT JOIN`. See {@link join}.
   * @throws {Error} When an identifier is unsafe or the operator is unsupported.
   * @category Joins
   */
  rightJoin(table: string, first: string, operator: string, second: string): this {
    return this._addJoin("right", table, first, operator, second);
  }
  /**
   * `CROSS JOIN table`. Only the table name is asserted.
   * @throws {Error} When `table` is not a safe SQL identifier.
   * @category Joins
   */
  crossJoin(table: string): this {
    _assertIdentifier(table, "crossJoin()");
    this._state.joins.push({ type: "cross", table });
    return this;
  }

  /**
   * Join a subquery, aliased. Pass a builder (or a callback that populates one)
   * plus an alias and the join condition. The subquery's bindings are merged
   * into the parent query.
   *
   * @remarks
   * The `alias`, `first` and `second` are asserted as safe identifiers and
   * `operator` against the allowed column-comparison set — the same guards
   * {@link join} applies. Only the subquery's own SQL comes from the passed
   * builder.
   * @category Joins
   * @example
   * ```ts
   * qb.joinSub(
   *   DB.table('orders').selectRaw('user_id, COUNT(*) c').groupBy('user_id'),
   *   'o', 'users.id', '=', 'o.user_id',
   * );
   * ```
   */
  joinSub(
    sub: QueryBuilder | ((q: QueryBuilder) => void),
    alias: string,
    first: string,
    operator: string,
    second: string,
    type: JoinType = "inner",
  ): this {
    _assertIdentifier(alias, "joinSub()");
    first = this._column(first);
    second = this._column(second);
    _assertIdentifier(first, "joinSub()");
    _assertIdentifier(second, "joinSub()");
    if (!COLUMN_OPERATORS.has(operator))
      throw new Error(`[Zerotal ORM] joinSub(): unsupported operator "${operator}".`);
    let builder: QueryBuilder;
    if (typeof sub === "function") {
      builder = new QueryBuilder("", this._sql);
      sub(builder);
    } else builder = sub;
    const { sql, bindings } = builder._compileSelect();
    this._state.joins.push({
      type,
      table: `(${sql}) AS ${alias}`,
      first,
      operator,
      second,
      bindings,
    });
    return this;
  }

  private _addJoin(
    type: JoinType,
    table: string,
    first: string,
    operator: string,
    second: string,
  ): this {
    _assertIdentifier(table, "join()");
    first = this._column(first);
    second = this._column(second);
    _assertIdentifier(first, "join()");
    _assertIdentifier(second, "join()");
    if (!COLUMN_OPERATORS.has(operator))
      throw new Error(`[Zerotal ORM] join(): unsupported operator "${operator}".`);
    this._state.joins.push({ type, table, first, operator, second });
    return this;
  }

  // ── Unions ────────────────────────────────────────────────────────────

  /**
   * Append `UNION` (or `UNION ALL` when `all` is true) with another builder's
   * compiled SELECT. The other query's bindings are merged.
   * @category Ordering & grouping
   */
  union(other: QueryBuilder, all = false): this {
    const { sql, bindings } = other._compileSelect();
    this._state.unions.push({ sql, bindings, all });
    return this;
  }
  /**
   * Append `UNION ALL` with another builder's SELECT. Shorthand for
   * `union(other, true)`.
   * @category Ordering & grouping
   */
  unionAll(other: QueryBuilder): this {
    return this.union(other, true);
  }

  // ── Pessimistic locking ───────────────────────────────────────────────

  /**
   * `SELECT … FOR UPDATE` — take an exclusive row lock. No-op on SQLite, which
   * lacks row locks (the suffix is omitted from the compiled SQL).
   * @category Select
   */
  lockForUpdate(): this {
    this._state.lock = "FOR UPDATE";
    return this;
  }

  /**
   * Take a shared row lock — `LOCK IN SHARE MODE` on MySQL, `FOR SHARE`
   * elsewhere. No-op on SQLite.
   * @category Select
   */
  sharedLock(): this {
    this._state.lock = dialectFor(this._sql) === "mysql" ? "LOCK IN SHARE MODE" : "FOR SHARE";
    return this;
  }

  /**
   * Add a raw SQL expression to the SELECT list.
   *
   * **Security:** The expression is injected verbatim into the query — never
   * interpolate user-controlled values directly. Build the expression from
   * trusted constants only, and pass dynamic values via `whereRaw()` bindings.
   *
   * @example
   * qb.selectRaw('COUNT(*) as total, MAX(score) as top')
   * qb.selectRaw('price * quantity as revenue')
   * @category Raw
   */
  selectRaw(expression: string): this {
    this._state.selects.push(expression);
    return this;
  }

  /**
   * Add a raw SQL WHERE clause.
   * Bindings are passed as the second argument to avoid SQL injection.
   *
   * @example
   * qb.whereRaw('LOWER(email) = ?', ['alice@example.com'])
   * qb.whereRaw('score BETWEEN ? AND ?', [10, 50])
   * @category Raw
   */
  whereRaw(sql: string, bindings: unknown[] = []): this {
    return this._pushRaw(sql, bindings, "and");
  }

  /**
   * `OR` form of {@link whereRaw}. The SQL fragment is trusted-input only;
   * pass dynamic values via `bindings`.
   * @category Raw
   */
  orWhereRaw(sql: string, bindings: unknown[] = []): this {
    return this._pushRaw(sql, bindings, "or");
  }

  private _pushRaw(sql: string, bindings: unknown[], boolean: "and" | "or"): this {
    this._state.wheres.push({ column: sql, operator: "__raw__", value: bindings, boolean });
    return this;
  }

  /**
   * Filter by a JSONB/JSON column path value using the `->>` text-extraction operator.
   *
   * Accepts `'column->key'` notation. Works natively on PostgreSQL (JSONB columns)
   * and MySQL (JSON columns). For SQLite use `whereRaw('json_extract(col, ?) = ?', …)`.
   *
   * The column name and key must be safe SQL identifiers (letters, digits, `_`, `.`).
   * Throws if either part fails validation — never pass user-controlled strings here.
   *
   * @throws {Error} When the column or path fails identifier validation.
   * @example
   * DB.table('users').whereJson('preferences->theme', 'dark')
   * // WHERE preferences->>'theme' = ?
   * @category Where clauses
   */
  whereJson(column: string, value: unknown): this {
    const arrowIdx = column.indexOf("->");
    if (arrowIdx === -1) return this.where(column, value);
    const col = this._column(column.slice(0, arrowIdx));
    const path = column.slice(arrowIdx + 2);
    if (!_isSafeIdentifier(col) || !_isSafeIdentifier(path)) {
      throw new Error(
        `[Zerotal ORM] whereJson(): unsafe identifier detected in "${column}". ` +
          `Column and path must match /^[a-zA-Z_][a-zA-Z0-9_.]*$/.`,
      );
    }
    return this.whereRaw(`${col}->>'${path}' = ?`, [value]);
  }

  /**
   * Add a raw SQL ORDER BY expression.
   *
   * @remarks Injected verbatim — trusted-input only. Prefer {@link orderBy} for
   * plain column ordering.
   * @example
   * qb.orderByRaw('RAND()')
   * qb.orderByRaw('created_at DESC, id ASC')
   * @category Raw
   */
  orderByRaw(expression: string): this {
    this._state.orders.push({ column: expression, direction: "__raw__" });
    return this;
  }

  /**
   * Cap the number of rows returned (`LIMIT`). The value is bound.
   * @category Pagination
   */
  limit(n: number): this {
    this._state.limit = n;
    return this;
  }

  /**
   * Skip a number of leading rows (`OFFSET`). The value is bound.
   * @category Pagination
   */
  offset(n: number): this {
    this._state.offset = n;
    return this;
  }

  /**
   * Conditionally apply builder mutations: when `condition` is truthy, invoke
   * `callback(this, condition)` and continue chaining. No `otherwise` branch.
   * @category Select
   * @example
   * ```ts
   * DB.table('users').when(search, (q, s) => q.whereLike('name', `%${s}%`));
   * ```
   */
  when(condition: unknown, callback: (q: QueryBuilder, value: unknown) => void): this {
    if (condition) callback(this, condition);
    return this;
  }

  /**
   * Deep-copy this builder so repeated paginated reads (chunk, cursor, …) do not
   * mutate the original. Subclasses override `_newInstance()` to preserve their
   * own state.
   * @category Execution
   */
  clone(): this {
    const c = this._newInstance();
    c._state = {
      ...this._state,
      selects: [...this._state.selects],
      joins: this._state.joins.map((j) => ({ ...j })),
      wheres: this._state.wheres.map((w) => ({ ...w })),
      orders: this._state.orders.map((o) => ({ ...o })),
      groupBys: [...this._state.groupBys],
      havings: this._state.havings.map((h) => ({ ...h })),
      unions: this._state.unions.map((u) => ({ ...u })),
    };
    return c as this;
  }

  protected _newInstance(): QueryBuilder {
    return new QueryBuilder(this._state.table, this._sql);
  }

  // ── Terminals ─────────────────────────────────────────────────────────

  /**
   * Compile and execute the SELECT, returning all matching rows.
   * @returns The result rows (plain records, or model instances under the
   *   model query builder).
   * @category Execution
   */
  async get<T = Record<string, unknown>>(): Promise<T[]> {
    this._beforeTerminal();
    return this._runSelect<T>();
  }

  /**
   * Execute the SELECT with `LIMIT 1` and return the first row, or `null` when
   * none match. Restores any previously-set limit afterward.
   * @category Execution
   */
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this._beforeTerminal();
    const prev = this._state.limit;
    this._state.limit = 1;
    const rows = await this._runSelect<T>();
    this._state.limit = prev;
    return rows[0] ?? null;
  }

  /**
   * Return an array of a single column's values.
   * Pass `key` to return an object keyed by that column instead.
   *
   * @example
   * await DB.table('users').pluck('email');            // ['a@x', 'b@y']
   * await DB.table('users').pluck('name', 'id');       // { 1: 'Al', 2: 'Bo' }
   * @category Execution
   */
  async pluck<V = unknown>(column: string, key?: string): Promise<V[] | Record<string, V>> {
    this._beforeTerminal();
    const col = this._column(column);
    const keyCol = key === undefined ? undefined : this._column(key);
    _assertSelectExpression(col, "pluck()");
    if (keyCol) _assertSelectExpression(keyCol, "pluck()");
    const c = this.clone();
    c._state.selects = keyCol ? [col, keyCol] : [col];
    const rows = await c.get<Record<string, unknown>>();
    // Readback goes through _keysetValue: the model builder hydrates rows into
    // instances whose properties are camelCase, so a snake_case column name
    // alone would miss the value.
    const colKey = col.split(".").pop()!.split(" ").pop()!;
    if (keyCol) {
      const keyKey = keyCol.split(".").pop()!;
      const out: Record<string, V> = {};
      for (const r of rows)
        out[String(this._keysetValue(r as Record<string, unknown>, keyKey))] = this._keysetValue(
          r as Record<string, unknown>,
          colKey,
        ) as V;
      return out;
    }
    return rows.map((r) => this._keysetValue(r as Record<string, unknown>, colKey) as V);
  }

  /**
   * Return a single column's value from the first matching row, or `null`.
   * @category Execution
   */
  async value<V = unknown>(column: string): Promise<V | null> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertSelectExpression(col, "value()");
    const c = this.clone();
    c._state.selects = [col];
    const row = await c.first<Record<string, unknown>>();
    if (!row) return null;
    const colKey = col.split(".").pop()!.split(" ").pop()!;
    return (this._keysetValue(row, colKey) as V) ?? null;
  }

  /**
   * `COUNT(*)` over the current query, ignoring any select list. Returns 0 when
   * there are no rows.
   *
   * Counts what the query *returns*. A grouped query returns one row per group, so
   * `groupBy("country").count()` is the number of countries, not the number of rows — the
   * previous implementation dropped the grouping and answered 1, which also made
   * `paginate()` report `total: 1` beside two rows of data. `DISTINCT` is likewise honoured
   * rather than forced off. Those cases count through a subquery, which is the only form
   * that gets both right.
   *
   * `ORDER BY` is always dropped: it cannot change a count, and retaining it makes the
   * count query illegal under PostgreSQL and MySQL's `ONLY_FULL_GROUP_BY` — so
   * `orderBy(...).paginate()`, the most common call in the framework, could not run there
   * at all.
   *
   * @category Aggregates
   */
  async count(): Promise<number> {
    this._beforeTerminal();
    const segs = this._countSegments();
    const rows = await this._run<{ _zerotal_count: number | bigint }>(segs);
    return Number(rows[0]?._zerotal_count ?? 0);
  }

  /**
   * `SUM(column)`, coerced to a number (0 when the sum is NULL/no rows).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Aggregates
   */
  async sum(column: string): Promise<number> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "sum()");
    const segs = this._selectSegments(`SUM(${col}) as _zerotal_sum`, false);
    const rows = await this._run<{ _zerotal_sum: number | bigint | null }>(segs);
    return Number(rows[0]?._zerotal_sum ?? 0);
  }

  /**
   * `AVG(column)`, coerced to a number (0 when NULL/no rows).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Aggregates
   */
  async avg(column: string): Promise<number> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "avg()");
    const segs = this._selectSegments(`AVG(${col}) as _zerotal_avg`, false);
    const rows = await this._run<{ _zerotal_avg: number | null }>(segs);
    return Number(rows[0]?._zerotal_avg ?? 0);
  }

  /**
   * `MIN(column)`, coerced to a number (0 when NULL/no rows).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Aggregates
   */
  async min(column: string): Promise<number> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "min()");
    const segs = this._selectSegments(`MIN(${col}) as _zerotal_min`, false);
    const rows = await this._run<{ _zerotal_min: number | null }>(segs);
    return Number(rows[0]?._zerotal_min ?? 0);
  }

  /**
   * `MAX(column)`, coerced to a number (0 when NULL/no rows).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Aggregates
   */
  async max(column: string): Promise<number> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "max()");
    const segs = this._selectSegments(`MAX(${col}) as _zerotal_max`, false);
    const rows = await this._run<{ _zerotal_max: number | null }>(segs);
    return Number(rows[0]?._zerotal_max ?? 0);
  }

  /**
   * Whether at least one row matches. Runs `SELECT 1 … LIMIT 1` and restores the
   * previous limit/select state afterward.
   * @category Aggregates
   */
  async exists(): Promise<boolean> {
    this._beforeTerminal();
    const prev = { limit: this._state.limit, selects: this._state.selects };
    this._state.limit = 1;
    this._state.selects = ["1 as _zerotal_exists"];
    const rows = await this._run(this._selectSegments("1 as _zerotal_exists", false));
    this._state.limit = prev.limit;
    this._state.selects = prev.selects;
    return rows.length > 0;
  }

  /**
   * Inverse of {@link exists} — true when no rows match.
   * @category Aggregates
   */
  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  /**
   * Return the single matching row, asserting uniqueness.
   * @throws {Error} When zero rows match, or when more than one row matches.
   * @category Execution
   */
  async sole<T = Record<string, unknown>>(): Promise<T> {
    const prev = this._state.limit;
    this._state.limit = 2;
    const rows = await this.get<T>();
    this._state.limit = prev;
    if (rows.length === 0) throw new Error("[Zerotal ORM] sole(): no records found.");
    if (rows.length > 1)
      throw new Error(`[Zerotal ORM] sole(): ${rows.length} records found, expected exactly one.`);
    return rows[0]!;
  }

  /**
   * Insert a single row. Object keys become columns (each asserted); values are
   * bound. An empty object is a no-op. Ignores any WHERE clauses on the builder.
   * @throws {Error} When any column key is not a safe SQL identifier.
   * @category Insert / update / delete
   * @example
   * ```ts
   * await DB.table('users').insert({ email: 'a@example.com', active: true });
   * ```
   */
  async insert(data: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(data).map((k) => this._column(k));
    const vals = Object.values(data);
    if (cols.length === 0) return;
    for (const c of cols) _assertIdentifier(c, "insert()");

    const segs: Segment[] = [`INSERT INTO ${this._state.table} (${cols.join(", ")}) VALUES (`];
    vals.forEach((v, i) => {
      if (i > 0) segs.push(", ");
      segs.push({ val: v });
    });
    segs.push(")");
    await this._run(segs);
  }

  /**
   * `UPDATE … SET …` for rows matching the current WHERE clauses. Object keys
   * become assigned columns (each asserted); values are bound. An empty object
   * is a no-op.
   * @throws {Error} When any column key is not a safe SQL identifier.
   * @category Insert / update / delete
   * @example
   * ```ts
   * await DB.table('users').where('id', 1).update({ active: false });
   * ```
   */
  async update(data: Record<string, unknown>): Promise<void> {
    this._beforeTerminal();
    const entries = Object.entries(data);
    if (entries.length === 0) return;

    const segs: Segment[] = [`UPDATE ${this._state.table} SET `];
    entries.forEach(([key, val], i) => {
      const col = this._column(key);
      _assertIdentifier(col, "update()");
      if (i > 0) segs.push(", ");
      segs.push(`${col} = `);
      segs.push({ val });
    });
    this._appendWhere(segs);
    await this._run(segs);
  }

  /**
   * Update rows matching `attributes`; insert a merged `{ ...attributes,
   * ...values }` row when none exist.
   * @returns `true` when a row was inserted, `false` when an existing row was
   *   updated.
   * @category Insert / update / delete
   */
  async updateOrInsert(
    attributes: Record<string, unknown>,
    values: Record<string, unknown> = {},
  ): Promise<boolean> {
    const probe = this.clone();
    for (const [k, v] of Object.entries(attributes)) probe.where(k, v);
    const existing = await probe.clone().first();
    if (existing) {
      if (Object.keys(values).length > 0) await probe.update(values);
      return false;
    }
    await this.clone().insert({ ...attributes, ...values });
    return true;
  }

  /**
   * `DELETE FROM …` for rows matching the current WHERE clauses.
   *
   * @remarks With no WHERE clauses this deletes every row in the table.
   * @category Insert / update / delete
   */
  async delete(): Promise<void> {
    this._beforeTerminal();
    const segs: Segment[] = [`DELETE FROM ${this._state.table}`];
    this._appendWhere(segs);
    await this._run(segs);
  }

  /**
   * Atomically add `amount` (default 1) to `column` for matching rows
   * (`SET column = column + ?`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Insert / update / delete
   */
  async increment(column: string, amount = 1): Promise<void> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "increment()");
    const segs: Segment[] = [`UPDATE ${this._state.table} SET ${col} = ${col} + `, { val: amount }];
    this._appendWhere(segs);
    await this._run(segs);
  }

  /**
   * Atomically subtract `amount` (default 1) from `column` for matching rows
   * (`SET column = column - ?`).
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Insert / update / delete
   */
  async decrement(column: string, amount = 1): Promise<void> {
    this._beforeTerminal();
    const col = this._column(column);
    _assertIdentifier(col, "decrement()");
    const segs: Segment[] = [`UPDATE ${this._state.table} SET ${col} = ${col} - `, { val: amount }];
    this._appendWhere(segs);
    await this._run(segs);
  }

  // ── Chunking / streaming ──────────────────────────────────────────────

  /**
   * Process results in fixed-size pages (offset-based). Return `false` from the
   * callback to stop early. Memory-safe for large tables.
   * @category Execution
   */
  async chunk<T = Record<string, unknown>>(
    size: number,
    callback: (rows: T[], page: number) => unknown | Promise<unknown>,
  ): Promise<void> {
    size = Math.max(1, size);
    let page = 1;
    for (;;) {
      const rows = await this.clone()
        .limit(size)
        .offset((page - 1) * size)
        .get<T>();
      if (rows.length === 0) break;
      const cont = await callback(rows, page);
      if (cont === false) break;
      if (rows.length < size) break;
      page++;
    }
  }

  /**
   * Like `chunk()` but pages by an incrementing key (keyset). Stable when rows
   * are inserted/deleted during iteration. `column` defaults to `id`.
   * @category Execution
   */
  async chunkById<T = Record<string, unknown>>(
    size: number,
    callback: (rows: T[]) => unknown | Promise<unknown>,
    column = "id",
  ): Promise<void> {
    size = Math.max(1, size);
    const col = this._column(column);
    let lastId: unknown = 0;
    for (;;) {
      const rows = await this.clone()
        .where(col, ">", lastId)
        .reorder(col, "asc")
        .limit(size)
        .get<T>();
      if (rows.length === 0) break;
      const cont = await callback(rows);
      if (cont === false) break;
      lastId = this._keysetValue(rows[rows.length - 1] as Record<string, unknown>, col);
      if (rows.length < size) break;
    }
  }

  /**
   * Async generator yielding one row at a time (offset-paged internally).
   * @category Execution
   */
  async *lazy<T = Record<string, unknown>>(size = 1000): AsyncGenerator<T> {
    size = Math.max(1, size);
    let page = 1;
    for (;;) {
      const rows = await this.clone()
        .limit(size)
        .offset((page - 1) * size)
        .get<T>();
      if (rows.length === 0) return;
      for (const r of rows) yield r;
      if (rows.length < size) return;
      page++;
    }
  }

  /**
   * Async generator yielding one row at a time (keyset-paged on `column`,
   * default `id`).
   * @category Execution
   */
  async *lazyById<T = Record<string, unknown>>(size = 1000, column = "id"): AsyncGenerator<T> {
    size = Math.max(1, size);
    const col = this._column(column);
    let lastId: unknown = 0;
    for (;;) {
      const rows = await this.clone()
        .where(col, ">", lastId)
        .reorder(col, "asc")
        .limit(size)
        .get<T>();
      if (rows.length === 0) return;
      for (const r of rows) yield r;
      lastId = this._keysetValue(rows[rows.length - 1] as Record<string, unknown>, col);
      if (rows.length < size) return;
    }
  }

  /**
   * Alias of {@link lazy} — stream rows one at a time.
   * @category Execution
   */
  cursor<T = Record<string, unknown>>(size = 1000): AsyncGenerator<T> {
    return this.lazy<T>(size);
  }

  /**
   * Invoke `callback` for each row, streaming in pages. Return `false` from the
   * callback to stop early.
   * @category Execution
   */
  async each<T = Record<string, unknown>>(
    callback: (row: T, index: number) => unknown | Promise<unknown>,
    size = 1000,
  ): Promise<void> {
    let i = 0;
    for await (const row of this.lazy<T>(size)) {
      const cont = await callback(row, i++);
      if (cont === false) break;
    }
  }

  // ── Debugging ─────────────────────────────────────────────────────────

  /**
   * Compiled SELECT SQL with `?` placeholders. Does not execute.
   * @category Execution
   */
  toSql(): string {
    return this._compileSelect().sql;
  }

  /**
   * `{ sql, bindings }` for the current SELECT. Does not execute.
   * @category Execution
   */
  toSqlWithBindings(): { sql: string; bindings: unknown[] } {
    return this._compileSelect();
  }

  /**
   * SQL with bindings inlined as literals — for logging only. The result is
   * **not safe to execute** (values are not re-escaped for a driver).
   * @category Execution
   */
  toRawSql(): string {
    const { sql, bindings } = this._compileSelect();
    let i = 0;
    return sql.replace(/\?/g, () => _inlineValue(bindings[i++]));
  }

  /**
   * Log the compiled SQL and bindings to the console, then return the builder
   * for continued chaining.
   * @category Execution
   */
  dump(): this {
    const { sql, bindings } = this._compileSelect();

    console.log("[Zerotal ORM] SQL:", sql, "\nbindings:", bindings);
    return this;
  }

  /**
   * Alias of {@link dump}. Note: despite the conventional `dd()` name, this does
   * NOT dump-and-die — it logs and returns for chaining.
   * @category Execution
   */
  dd(): this {
    return this.dump();
  }

  /**
   * Run the query plan for the current SELECT and return the plan rows —
   * `EXPLAIN QUERY PLAN` on SQLite, `EXPLAIN` elsewhere.
   * @category Execution
   */
  async explain<T = Record<string, unknown>>(): Promise<T[]> {
    const cols = this._state.selects.length > 0 ? this._state.selects.join(", ") : "*";
    const segs = this._selectSegments(cols);
    const prefix = dialectFor(this._sql) === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN ";
    segs[0] = prefix + (segs[0] as string);
    return this._run<T>(segs);
  }

  // ── Pagination ────────────────────────────────────────────────────────

  /**
   * Offset-based pagination.
   *
   * Runs COUNT then SELECT — count ignores LIMIT/OFFSET by temporarily clearing
   * them; SELECT uses `this.get()` so subclass overrides (ModelQueryBuilder)
   * get model instances and eager-load relations automatically.
   *
   * @param perPage - Rows per page (clamped to ≥ 1).
   * @param page - 1-based page number. Omit it to use the request's current page
   *   (the `?page=` query string, or a resolver a server-driven view registered).
   * @param pageName - Which paginator to read when `page` is omitted, so one request can
   *   drive several independently. Defaults to `"page"`.
   * @returns A {@link PaginateResult} with `data`, `total`, `lastPage` and URL helpers.
   * @category Pagination
   */
  async paginate<T = Record<string, unknown>>(
    perPage = 15,
    page?: number,
    pageName = "page",
  ): Promise<PaginateResult<T>> {
    this._beforeTerminal();
    // No page given: read the one belonging to the request in flight — the `?page=` query
    // string, or whatever a server-driven view registered instead. Outside a request it is 1.
    page = Math.max(1, page ?? currentPage(pageName));
    perPage = Math.max(1, perPage);

    // Save pagination state so we can restore after the two queries
    const savedLimit = this._state.limit;
    const savedOffset = this._state.offset;

    // Count without any LIMIT / OFFSET applied
    this._state.limit = undefined;
    this._state.offset = undefined;
    const total = await this.count();

    // Fetch the requested page — this.get() is polymorphic:
    // ModelQueryBuilder.get() maps rows → model instances + eager loads.
    this._state.limit = perPage;
    this._state.offset = (page - 1) * perPage;
    const data = await this.get<T>();

    // Restore
    this._state.limit = savedLimit;
    this._state.offset = savedOffset;

    return withPaginationHelpers({
      data,
      total,
      page,
      perPage,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    });
  }

  /**
   * Cursor-based pagination using `WHERE <column> > cursor ORDER BY <column> ASC`
   * (`column` defaults to `id`).
   *
   * Avoids a `COUNT(*)` entirely — ideal for very large tables and
   * infinite-scroll UIs. Fetches `limit + 1` rows to detect whether a next page
   * exists, trims the extra row, and sets `nextCursor` to the last returned id.
   *
   * Results flow through `this.get()`, so a `ModelQueryBuilder` returns model
   * instances (with eager-loaded relations), while a raw `QueryBuilder` returns
   * plain rows.
   *
   * Returns `{ data, nextCursor, prevCursor, hasMore }`:
   *  - `nextCursor` — pass to the next call's `cursor`; null on the last page.
   *  - `prevCursor` — the cursor that produced the page before this one
   *    (the incoming `cursor`), or null on the first page.
   *  - `hasMore`    — true when another page follows.
   *
   * Defaults: `{ cursor: 0, limit: 15, column: 'id' }`.
   *
   * @remarks Like {@link paginate}, the builder's clause state is snapshotted and
   * restored, so the query can be safely reused. `column` defaults to `id`; for
   * non-numeric sort keys and opaque cursors, prefer {@link keysetPaginate}.
   * @throws {Error} When `column` is not a safe SQL identifier.
   * @category Pagination
   */
  async cursorPaginate<T = Record<string, unknown>>(options?: {
    cursor?: number;
    limit?: number;
    column?: string;
  }): Promise<CursorPaginateResult<T>> {
    this._beforeTerminal();
    const limit = Math.max(1, options?.limit ?? 15);
    const cursor = options?.cursor ?? 0;
    const column = this._column(options?.column ?? "id");
    _assertIdentifier(column, "cursorPaginate()");

    // Snapshot clause state so the builder is left untouched — reusing it must
    // not compound the cursor WHERE/ORDER clauses across calls.
    const savedWheres = this._state.wheres.length;
    const savedOrders = this._state.orders.length;
    const savedLimit = this._state.limit;

    // Apply cursor filter when advancing past the first page
    if (cursor > 0) {
      this._state.wheres.push({ column, operator: ">", value: cursor, boolean: "and" });
    }

    // Always order by the cursor column ascending so the cursor is predictable
    this._state.orders.push({ column, direction: "asc" });

    // Fetch one extra row to know whether another page follows.
    // this.get() is polymorphic: ModelQueryBuilder maps rows → model instances.
    this._state.limit = limit + 1;
    const rows = await this.get<T>();

    // Restore the snapshotted clause state.
    this._state.wheres.length = savedWheres;
    this._state.orders.length = savedOrders;
    this._state.limit = savedLimit;

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows) as T[];
    const lastRow = data[data.length - 1] as Record<string, unknown> | undefined;
    const nextCursor: number | null =
      hasMore && lastRow
        ? ((this._keysetValue(lastRow, column) as number | undefined) ?? null)
        : null;
    const prevCursor: number | null = cursor > 0 ? cursor : null;

    return { data, nextCursor, prevCursor, hasMore };
  }

  /**
   * "Simple" offset pagination — next/prev only, **no `COUNT(*)`**.
   *
   * Fetches `perPage + 1` rows to detect whether another page follows, then
   * trims the probe row. Use this instead of `paginate()` when you don't need
   * a total row count or numbered page links (cheaper on large tables).
   *
   * Results flow through `this.get()`, so a `ModelQueryBuilder` returns model
   * instances. Returns a `SimplePaginateResult` with `hasMorePages`, `page`,
   * and URL helpers — but no `total` or `lastPage`. Omit `page` to use the
   * request's current page, exactly like `paginate()`.
   *
   * @example
   * const page = await Post.query().orderBy('id').simplePaginate(15);
   * page.hasMorePages;   // boolean
   * page.nextPageUrl();  // '?page=2' | null
   * @category Pagination
   */
  async simplePaginate<T = Record<string, unknown>>(
    perPage = 15,
    page?: number,
    pageName = "page",
  ): Promise<SimplePaginateResult<T>> {
    this._beforeTerminal();
    page = Math.max(1, page ?? currentPage(pageName));
    perPage = Math.max(1, perPage);

    const savedLimit = this._state.limit;
    const savedOffset = this._state.offset;

    // Fetch one extra row to know whether another page follows.
    this._state.limit = perPage + 1;
    this._state.offset = (page - 1) * perPage;
    const rows = await this.get<T>();

    this._state.limit = savedLimit;
    this._state.offset = savedOffset;

    const hasMore = rows.length > perPage;
    const data = (hasMore ? rows.slice(0, perPage) : rows) as T[];

    return withSimplePaginationHelpers<T>({
      data,
      perPage,
      page,
      hasMore,
    });
  }

  /**
   * Keyset (cursor) pagination — scales to any table size with no offset cost.
   *
   * Unlike `cursorPaginate()` this method:
   * - Accepts **any sort column** (not just `id`).
   * - Supports `'asc'` and `'desc'` ordering.
   * - Returns an **opaque base64 cursor** that encodes the sort value of the last
   *   row, so clients cannot interpret or tamper with it.
   * - Adds a secondary tiebreaker on the primary key when the sort column is not unique,
   *   ordered in the **same direction** as the primary sort, so page boundaries are stable.
   *
   * The tiebreaker's direction is not cosmetic. The cursor predicate compares the
   * tiebreaker with the primary sort's operator (`>` ascending, `<` descending), so an
   * `id ASC` tiebreaker under a `desc` sort asked for rows *before* the ones just
   * returned: within a tie group, page 1 emitted the lowest ids and page 2 then re-emitted
   * them while the rest of the group became unreachable.
   *
   * @example
   * // First page
   * const p1 = await db('posts').keysetPaginate({ column: 'created_at', direction: 'desc' });
   *
   * // Next page — pass the opaque cursor directly
   * const p2 = await db('posts').keysetPaginate({
   *   column: 'created_at', direction: 'desc', cursor: p1.nextCursor,
   * });
   * @throws {Error} When `options.column` is not a safe SQL identifier.
   * @category Pagination
   */
  async keysetPaginate<T = Record<string, unknown>>(
    options?: KeysetOptions,
  ): Promise<KeysetPaginateResult<T>> {
    const limit = Math.max(1, options?.limit ?? 15);
    const column = this._column(options?.column ?? "id");
    const direction = options?.direction ?? "asc";

    if (!_isSafeIdentifier(column)) {
      throw new Error(`keysetPaginate: unsafe column name "${column}"`);
    }

    // The unique column that breaks ties in the sort column. `id` for a plain builder;
    // ModelQueryBuilder overrides this with the model's actual primary key, since a model
    // keyed on something else had its ties broken by a column that may not exist.
    const tiebreaker = this._keysetTiebreaker();
    if (!_isSafeIdentifier(tiebreaker)) {
      throw new Error(`keysetPaginate: unsafe tiebreaker column "${tiebreaker}"`);
    }

    const cursor = options?.cursor ? _decodeCursor(options.cursor) : null;

    // Snapshot clause state so the builder is left untouched — reusing it (or
    // fetching the next page from the same query) must not stack keyset clauses.
    const savedWheres = this._state.wheres.length;
    const savedOrders = this._state.orders.length;
    const savedLimit = this._state.limit;

    if (cursor !== null) {
      const op = direction === "asc" ? ">" : "<";
      if (column === tiebreaker || cursor.id === undefined) {
        // Simple single-column keyset — the sort column is already unique.
        this._state.wheres.push({ column, operator: op, value: cursor.val, boolean: "and" });
      } else {
        // Compound: (col op val) OR (col = val AND tiebreaker op tie_val)
        // Uses whereRaw so the condition is parenthesised as a unit.
        this.whereRaw(`(${column} ${op} ? OR (${column} = ? AND ${tiebreaker} ${op} ?))`, [
          cursor.val,
          cursor.val,
          cursor.id,
        ]);
      }
    }

    // Primary sort, then the tiebreaker in the SAME direction — the cursor predicate above
    // compares it with the primary operator, so the two have to agree.
    this._state.orders.push({ column, direction });
    if (column !== tiebreaker) {
      this._state.orders.push({ column: tiebreaker, direction });
    }

    // Fetch one extra row to know whether another page follows.
    // this.get() is polymorphic: ModelQueryBuilder maps rows → model instances, applies
    // casts, strips `hidden` and runs eager loads. Calling _runSelect() directly skipped
    // all of that *and* the _beforeTerminal() hook that applies global scopes — so a
    // tenant- or soft-delete-scoped model came back unscoped, as raw rows, while typed as
    // KeysetPaginateResult<M>.
    this._state.limit = limit + 1;
    const rows = await this.get<Record<string, unknown>>();

    // Restore the snapshotted clause state.
    this._state.wheres.length = savedWheres;
    this._state.orders.length = savedOrders;
    this._state.limit = savedLimit;

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows) as T[];
    const lastRow = data[data.length - 1] as Record<string, unknown> | undefined;

    const nextCursor =
      hasMore && lastRow
        ? _encodeCursor({
            col: column,
            val: this._keysetValue(lastRow, column),
            id: column !== tiebreaker ? this._keysetValue(lastRow, tiebreaker) : undefined,
          })
        : null;

    return { data, nextCursor };
  }

  /**
   * The unique column that breaks ties in a keyset sort. `id` here; the model builder
   * overrides it with the model's declared primary key.
   * @internal
   */
  protected _keysetTiebreaker(): string {
    return "id";
  }

  /**
   * Read a keyset column off a result row.
   *
   * Rows come back as model instances under the model builder, where a `created_at` column
   * is exposed as `createdAt` — so the DB column name alone does not find the value, and a
   * cursor built from `undefined` restarts pagination from the top.
   * @internal
   */
  protected _keysetValue(row: Record<string, unknown>, column: string): unknown {
    if (column in row) return row[column];
    // Shared camel helper — its regex matches hydration exactly, so the lookup
    // always finds what fromRow() actually named the property.
    return row[toCamelKey(column)];
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _addWhere(
    column: string,
    op: WhereClause["operator"],
    value: unknown,
    boolean: "and" | "or",
  ): void {
    column = this._column(column);
    _assertIdentifier(column, "where()");
    value = this._bind(column, value, op as WhereOperator);
    // Normalize null comparisons: `col = NULL` / `col != NULL` never match in SQL,
    // so a null value with an (in)equality operator becomes IS [NOT] NULL.
    if (value === null && (op === "=" || op === "!=" || op === "<>")) {
      this._state.wheres.push({
        column,
        operator: op === "=" ? "is null" : "is not null",
        value: null,
        boolean,
      });
      return;
    }
    this._state.wheres.push({ column, operator: op, value, boolean });
  }

  private _runSelect<T = Record<string, unknown>>(): Promise<T[]> {
    const cols = this._state.selects.length > 0 ? this._state.selects.join(", ") : "*";
    return this._run<T>(this._selectSegments(cols));
  }

  private _compileSelect(): { sql: string; bindings: unknown[] } {
    const cols = this._state.selects.length > 0 ? this._state.selects.join(", ") : "*";
    const segs = this._selectSegments(cols);
    let sql = "";
    const bindings: unknown[] = [];
    for (const seg of segs) {
      if (typeof seg === "string") sql += seg;
      else {
        sql += "?";
        bindings.push(seg.val);
      }
    }
    return { sql, bindings };
  }

  /**
   * Build the segments for `count()`.
   *
   * Grouped, distinct and unioned queries return a different number of rows than a bare
   * `COUNT(*)` over the same WHERE clause, so those are counted by wrapping the query as a
   * subquery. Everything else takes the direct form, which avoids the extra nesting on the
   * overwhelmingly common case.
   */
  private _countSegments(): Segment[] {
    const needsSubquery =
      this._state.groupBys.length > 0 ||
      this._state.distinct ||
      this._state.unions.length > 0 ||
      this._state.havings.length > 0;

    // ORDER BY never affects a count and is invalid inside an aggregate over a grouped
    // query on Postgres/MySQL, so it is dropped in both forms.
    const inner = this.clone();
    inner._state.orders = [];

    if (!needsSubquery) {
      return inner._selectSegments("COUNT(*) as _zerotal_count", false);
    }

    // The inner query keeps its own select list: with DISTINCT, *what* is being made
    // distinct is the whole question, and replacing it with `*` counts raw rows again.
    const cols = inner._state.selects.length > 0 ? inner._state.selects.join(", ") : "*";
    const segs: Segment[] = ["SELECT COUNT(*) as _zerotal_count FROM ("];
    segs.push(...inner._selectSegments(cols));
    segs.push(") as _zerotal_count_sub");
    return segs;
  }

  private _selectSegments(cols: string, applyDistinct = true): Segment[] {
    const distinct = applyDistinct && this._state.distinct ? "DISTINCT " : "";
    const segs: Segment[] = [`SELECT ${distinct}${cols} FROM ${this._state.table}`];

    this._appendJoins(segs);
    this._appendWhere(segs);

    if (this._state.groupBys.length > 0) {
      segs.push(` GROUP BY ${this._state.groupBys.join(", ")}`);
    }

    if (this._state.havings.length > 0) {
      this._state.havings.forEach((h, i) => {
        segs.push(i === 0 ? " HAVING " : " AND ");
        segs.push(`${h.column} ${h.operator} `);
        segs.push({ val: h.value });
      });
    }

    for (const u of this._state.unions) {
      segs.push(` UNION ${u.all ? "ALL " : ""}`);
      _pushSqlWithBindings(segs, u.sql, u.bindings);
    }

    if (this._state.orders.length > 0) {
      const ords = this._state.orders
        .map((o) =>
          o.direction === "__raw__" ? o.column : `${o.column} ${o.direction.toUpperCase()}`,
        )
        .join(", ");
      segs.push(` ORDER BY ${ords}`);
    }

    if (this._state.limit !== undefined) {
      segs.push(" LIMIT ");
      segs.push({ val: this._state.limit });
    }

    if (this._state.offset !== undefined) {
      segs.push(" OFFSET ");
      segs.push({ val: this._state.offset });
    }

    if (this._state.lock && dialectFor(this._sql) !== "sqlite") {
      segs.push(` ${this._state.lock}`);
    }

    return segs;
  }

  private _appendJoins(segs: Segment[]): void {
    for (const j of this._state.joins) {
      if (j.type === "cross") {
        segs.push(` CROSS JOIN ${j.table}`);
        continue;
      }
      const kw = j.type === "left" ? "LEFT JOIN" : j.type === "right" ? "RIGHT JOIN" : "INNER JOIN";
      segs.push(` ${kw} `);
      _pushSqlWithBindings(segs, j.table, j.bindings ?? []);
      segs.push(` ON ${j.first} ${j.operator} ${j.second}`);
    }
  }

  /**
   * Build a parenthesised group of predicates from a callback.
   *
   * The callback receives a scratch builder; whatever it accumulates is appended as one
   * `__group__` clause. This is what lets an `OR` chain be contained:
   * `.where("a", 1).where(q => q.where("b", 2).orWhere("c", 3))` compiles to
   * `a = ? AND (b = ? OR c = ?)` rather than `a = ? AND b = ? OR c = ?`.
   *
   * @category Where clauses
   * @internal
   */
  private _addWhereGroup(build: (query: this) => void, boolean: "and" | "or"): this {
    const scratch = this.clone() as this;
    scratch._state.wheres = [];
    build(scratch);
    const inner = scratch._state.wheres;
    if (inner.length === 0) return this; // nothing to add — do not emit an empty ()
    this._state.wheres.push({
      column: "",
      operator: "__group__",
      value: undefined,
      boolean,
      group: inner,
    });
    return this;
  }

  /**
   * Wrap every predicate added since {@link _userWhereStart} in a single group.
   *
   * Framework-injected predicates — the soft-delete `deleted_at IS NULL` seeded by
   * `BaseModel.query()`, and global scopes appended at terminal time — must AND with the
   * caller's predicates as a whole, not join their chain. They did not:
   *
   *   User.query().where("role","admin").orWhere("role","owner")
   *   -> WHERE deleted_at IS NULL AND role = ? OR role = ? AND tenant_id = ?
   *
   * The bare `OR` splits the chain, so the second arm carried neither the soft-delete
   * predicate nor the tenant scope — returning trashed rows and other tenants' rows. Grouping
   * produces `deleted_at IS NULL AND (role = ? OR role = ?) AND tenant_id = ?`.
   *
   * Only groups when the caller's predicates actually contain an `OR`; a pure `AND` chain is
   * unaffected by grouping, and skipping it keeps the emitted SQL unchanged in the common case.
   *
   * Idempotent: a second call finds a single already-grouped clause and does nothing.
   *
   * @category Where clauses
   * @internal
   */
  /**
   * Record that all subsequent predicates are caller-supplied.
   *
   * Called by `BaseModel.query()` once framework predicates (soft deletes) are seeded.
   *
   * @category Where clauses
   * @internal
   */
  _markUserWhereStart(): void {
    this._userWhereStart = this._state.wheres.length;
  }

  protected _groupUserWheres(): void {
    const start = this._userWhereStart;
    const wheres = this._state.wheres;
    if (start >= wheres.length) return;

    const userWheres = wheres.slice(start);
    if (userWheres.length < 2) return;
    if (!userWheres.some((w) => w.boolean === "or")) return;

    this._state.wheres = [
      ...wheres.slice(0, start),
      {
        column: "",
        operator: "__group__",
        value: undefined,
        // The group as a whole joins with AND. Its first member's own boolean is irrelevant,
        // since the renderer skips the connective for index 0.
        boolean: "and",
        group: userWheres,
      },
    ];
  }

  private _appendWhere(segs: Segment[]): void {
    this._renderWheres(segs, this._state.wheres, true);
  }

  /**
   * Render a list of WHERE predicates, recursing into `__group__` clauses.
   *
   * @param top - True for the outermost list, which emits the ` WHERE ` keyword. Nested groups
   *   emit parentheses instead.
   */
  private _renderWheres(segs: Segment[], wheres: WhereClause[], top: boolean): void {
    wheres.forEach((w, i) => {
      if (i === 0) segs.push(top ? " WHERE " : "");
      else segs.push(` ${w.boolean.toUpperCase()} `);

      if (w.operator === "__group__") {
        const inner = w.group ?? [];
        if (inner.length === 0) {
          // An empty group must not emit `()`, which is a syntax error. `1 = 1` is the
          // identity for the AND it sits in.
          segs.push("1 = 1");
          return;
        }
        segs.push("(");
        this._renderWheres(segs, inner, false);
        segs.push(")");
        return;
      }

      if (w.operator === "__raw__") {
        // whereRaw: column holds the SQL fragment, value holds the bindings array.
        // One shared splicer — this used to be a second copy that dropped an unbound `?`.
        _pushSqlWithBindings(segs, w.column, w.value as unknown[]);
      } else if (w.operator === "is null") {
        segs.push(`${w.column} IS NULL`);
      } else if (w.operator === "is not null") {
        segs.push(`${w.column} IS NOT NULL`);
      } else if (w.operator === "in" || w.operator === "not in") {
        const inVals = w.value as unknown[];
        const kw = w.operator === "in" ? "IN" : "NOT IN";
        if (inVals.length === 0) {
          segs.push(w.operator === "in" ? `1 = 0` : `1 = 1`); // empty IN() false; empty NOT IN() true
        } else {
          segs.push(`${w.column} ${kw} (`);
          inVals.forEach((v, j) => {
            if (j > 0) segs.push(", ");
            segs.push({ val: v });
          });
          segs.push(")");
        }
      } else {
        segs.push(`${w.column} ${w.operator} `);
        segs.push({ val: w.value });
      }
    });
  }

  /**
   * Hook invoked at the top of every terminal method — the last point at which a subclass may
   * still mutate builder state before SQL is compiled.
   *
   * The base builder has nothing to do here. {@link ModelQueryBuilder} overrides it to apply
   * global scopes (tenancy, soft deletes, and any `addGlobalScope` registration). Scopes were
   * previously applied only in `get()` and `first()`, which left `update()`, `delete()`,
   * `count()` and every aggregate running **unscoped** — a tenant-scoped mass update crossed
   * the tenant boundary and soft-deleted rows were counted. Routing every terminal through one
   * hook is what makes the scope contract in `Tenantable`'s docblock actually true.
   *
   * Implementations must be idempotent: `clone()`-based terminals can reach it more than once.
   *
   * @category Execution
   * @internal
   */
  protected _beforeTerminal(): void {}

  private async _run<T = Record<string, unknown>>(segs: Segment[]): Promise<T[]> {
    // Read the transaction from AsyncLocalStorage, never from RequestContext._transaction.
    //
    // `ctx._transaction` is a single slot on the per-request context, so it cannot represent
    // two transactions at once. This method used to prefer it over `this._sql`, which meant
    // that when two transactions overlapped within one request, statements from one landed on
    // the other's connection — a transfer's debit and credit could end up in different
    // transactions, so rolling one back debited without crediting. DB.transaction()'s `finally`
    // clearing the same slot made it worse, since the inner transaction's cleanup blanked the
    // outer one's entry.
    //
    // TransactionContext is an ALS store, so it follows the async call stack and is correct
    // under concurrency. Priority matches _resolveConn's documented contract: an active ALS
    // transaction wins, otherwise the connection this builder was constructed with — which
    // _resolveConn has already resolved (including the legacy ctx._transaction fallback) at
    // build time.
    return _runSegments<T>(TransactionContext.getStore() ?? this._sql, segs, true);
  }
}

// ── Module-private helpers ────────────────────────────────────────────────────

/** Split a SQL fragment on `?` and interleave binding segments. */
/**
 * Split raw SQL on `?` and interleave the supplied bindings.
 *
 * A `?` with no binding left to consume is emitted back as a literal `?`. Dropping it — the
 * previous behaviour — silently rewrote the SQL: `whereRaw("name LIKE 'Who?%'")` became
 * `LIKE 'Who%'` and returned the wrong rows with no error, and PostgreSQL's jsonb
 * key-existence operator (`data ? 'key'`) was destroyed outright.
 */
function _pushSqlWithBindings(segs: Segment[], sql: string, bindings: unknown[]): void {
  const parts = sql.split("?");
  parts.forEach((part, idx) => {
    segs.push(part);
    if (idx === parts.length - 1) return; // trailing fragment — no `?` followed it
    if (idx < bindings.length) segs.push({ val: bindings[idx] });
    else segs.push("?");
  });
}

/**
 * Inline a binding value as a SQL literal. Used for display SQL (`toRawSql`)
 * and by the model builder's relation-aggregate sub-selects, whose constrained
 * form inlines its bindings — so Carbon/Date values must render as their DB
 * representation, not `String(new Date())`. Quote-doubling is the only
 * escaping; treat output as executable only in the aggregate-subquery path,
 * whose inputs already flowed through the builder's identifier/binding guards.
 */
export function _inlineValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Carbon) return `'${v.toDatabase()}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Keyset cursor helpers (module-private) ────────────────────────────────────

interface _CursorPayload {
  col: string;
  val: unknown;
  id?: unknown;
}

function _encodeCursor(payload: _CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function _decodeCursor(cursor: string): _CursorPayload | null {
  return rescueSync(() => JSON.parse(atob(cursor)) as _CursorPayload, null);
}
