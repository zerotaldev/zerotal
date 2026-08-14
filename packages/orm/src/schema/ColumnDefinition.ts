import { getDialect } from "../db/dialects/index.ts";
import type { DialectName } from "../db/dialects/types.ts";

// ── Type-State Phantom Type ───────────────────────────────────────────────────
//
// `Locked` accumulates applied modifier traits.  Once a trait is in the union
// the corresponding method(s) return `never`, giving a compile-time error for
// any illegal re-application:
//
//   col.nullable().nullable()    → TS error (same lock)
//   col.nullable().notNullable() → TS error (shared 'nullability' lock)
//   col.nullable().unique()      → ✅ different trait, always fine
//
// Inside each method body we return `this as any`.  TypeScript cannot reduce
// a deferred conditional in a generic body, so `as any` is the standard idiom
// used by Kysely, Zod, and Prisma for exactly this pattern.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── ColumnBuilder ─────────────────────────────────────────────────────────────

/**
 * Fluent per-column builder returned by every column-type method on
 * {@link Blueprint} (e.g. `table.string('email')`). Modifier methods mutate the
 * builder and return it for chaining; the column is compiled to a SQL fragment
 * only when the surrounding {@link Blueprint} calls {@link ColumnBuilder.toColumnSQL}.
 *
 * @typeParam Locked - A phantom string union that accumulates the "traits" already
 * applied. Once a trait is present, methods sharing that trait return `never`, so
 * illegal re-application (e.g. `.nullable().notNullable()`) is a compile-time error
 * rather than a runtime one. The lock a method participates in is noted as
 * `@locked` in its docs; distinct traits can always be combined freely.
 *
 * @remarks
 * SQLite is the primary dialect. Modifiers that have no SQLite representation
 * (`unsigned`, `comment`, `after`, `before`, `useCurrentOnUpdate`) are accepted
 * and tracked but emit no SQL there. Column modifications via {@link ColumnBuilder.alter}
 * are dialect-specific and unsupported on SQLite (see {@link Blueprint.toAlterSQL}).
 *
 * @example
 * ```ts
 * table.string('email').unique().notNullable();
 * table.integer('age').unsigned().check('age >= 0').default(0);
 * table.uuid('id').primary();
 * table.dateTime('created_at').useCurrent();
 * ```
 */
export class ColumnBuilder<Locked extends string = never> {
  private _isNullable = false;
  private _isUnique = false;
  private _hasDefault = false;
  private _default: unknown = undefined;
  private _needsIndex = false;
  private _isUnsigned = false;
  private _isPrimary = false;
  private _isAutoIncr = false;
  private _useCurrent = false;
  private _check: string | null = null;
  private _generated: { expr: string; mode: "STORED" | "VIRTUAL" } | null = null;
  private _isAlter = false;

  constructor(
    readonly name: string,
    private _sqlType: string,
    isPrimary = false,
    isAutoIncrement = false,
  ) {
    this._isPrimary = isPrimary;
    this._isAutoIncr = isAutoIncrement;
  }

  // ── Modifiers ─────────────────────────────────────────────────────────────

  /**
   * Allow NULL.
   * @locked `nullability` — shared with `notNullable()`.
   * @category Nullability & defaults
   */
  nullable(): "nullability" extends Locked ? never : ColumnBuilder<Locked | "nullability"> {
    this._isNullable = true;
    return this as any;
  }

  /**
   * Enforce NOT NULL explicitly (the default for non-PK columns).
   * @locked `nullability` — shared with `nullable()`.
   * @category Nullability & defaults
   */
  notNullable(): "nullability" extends Locked ? never : ColumnBuilder<Locked | "nullability"> {
    this._isNullable = false;
    return this as any;
  }

  /**
   * Add a `DEFAULT` clause. `null` serialises to `NULL`, JS booleans to `1` / `0`,
   * strings are single-quoted (with quotes escaped), everything else stringified.
   * @param value - The default value.
   * @locked `default`
   * @category Nullability & defaults
   */
  default(value: unknown): "default" extends Locked ? never : ColumnBuilder<Locked | "default"> {
    this._default = value;
    this._hasDefault = true;
    this._useCurrent = false;
    return this as any;
  }

  /**
   * Alias for {@link ColumnBuilder.default} — identical behaviour, common alternative name.
   * @locked `default`
   * @category Nullability & defaults
   */
  defaultTo(value: unknown): "default" extends Locked ? never : ColumnBuilder<Locked | "default"> {
    return this.default(value) as any;
  }

  /**
   * Set the column default to `CURRENT_TIMESTAMP`.
   * Useful for `created_at`-style columns without `timestamps()`.
   * @locked `default`
   * @category Nullability & defaults
   */
  useCurrent(): "default" extends Locked ? never : ColumnBuilder<Locked | "default"> {
    this._useCurrent = true;
    this._hasDefault = false;
    return this as any;
  }

  /**
   * On MySQL / MariaDB: automatically update the column to `CURRENT_TIMESTAMP`
   * on every row change. No-op on SQLite and PostgreSQL.
   * @category Nullability & defaults
   */

  useCurrentOnUpdate(): this {
    return this;
  }

  /**
   * Add inline `UNIQUE` to the column definition.
   * @locked `unique`
   * @category Constraints
   */
  unique(): "unique" extends Locked ? never : ColumnBuilder<Locked | "unique"> {
    this._isUnique = true;
    return this as any;
  }

  /**
   * Request a standalone `CREATE INDEX` on this column after the table is created.
   * Ignored when the column is also `unique()` (a unique index already covers it).
   * @locked `index`
   * @category Constraints
   */
  index(): "index" extends Locked ? never : ColumnBuilder<Locked | "index"> {
    this._needsIndex = true;
    return this as any;
  }

  /**
   * Mark the column as unsigned. Tracked for documentation and multi-DB
   * compatibility — SQLite has no `UNSIGNED` type so no SQL is emitted.
   * @locked `unsigned`
   * @category Modifiers
   */
  unsigned(): "unsigned" extends Locked ? never : ColumnBuilder<Locked | "unsigned"> {
    this._isUnsigned = true;
    return this as any;
  }

  /**
   * Promote this column to the primary key. Use this when you need a PK
   * without auto-increment (e.g. UUID PKs).
   * @locked `primary`
   * @category Constraints
   */
  primary(): "primary" extends Locked ? never : ColumnBuilder<Locked | "primary"> {
    this._isPrimary = true;
    return this as any;
  }

  /**
   * Add a `CHECK (expression)` constraint.
   *
   * @param expression - A raw SQL boolean expression; not escaped or validated.
   * @example
   * ```ts
   * table.integer('age').unsigned().check('age >= 0');
   * table.string('status').check("status IN ('active','inactive')");
   * ```
   * @locked `check`
   * @category Constraints
   */
  check(expression: string): "check" extends Locked ? never : ColumnBuilder<Locked | "check"> {
    this._check = expression;
    return this as any;
  }

  /**
   * Define a generated stored column (computed and physically stored).
   * Requires SQLite ≥ 3.31.
   *
   * @example
   * ```ts
   * table.string('full_name').storedAs("first_name || ' ' || last_name");
   * ```
   * @locked `generated`
   * @category Modifiers
   */
  storedAs(
    expression: string,
  ): "generated" extends Locked ? never : ColumnBuilder<Locked | "generated"> {
    this._generated = { expr: expression, mode: "STORED" };
    return this as any;
  }

  /**
   * Define a generated virtual column (computed on read, never stored).
   * Requires SQLite ≥ 3.31.
   * @locked `generated`
   * @category Modifiers
   */
  virtualAs(
    expression: string,
  ): "generated" extends Locked ? never : ColumnBuilder<Locked | "generated"> {
    this._generated = { expr: expression, mode: "VIRTUAL" };
    return this as any;
  }

  /**
   * Mark this column as a modification of an existing column rather than a
   * new addition. Used inside {@link Schema.table} callbacks:
   *
   * ```ts
   * Schema.table('users', (table) => {
   *   table.string('password').nullable().alter();
   * });
   * ```
   *
   * On MySQL / MariaDB emits `MODIFY COLUMN`; on PostgreSQL each attribute change
   * becomes a separate `ALTER COLUMN` sub-command. On SQLite this is a no-op — a
   * console warning is emitted and the statement is skipped (structural changes
   * require a full table rebuild).
   * @category Modifiers
   */
  alter(): this {
    this._isAlter = true;
    return this;
  }

  /**
   * Alias of {@link ColumnBuilder.alter} — mark this as a modification of an existing column.
   * @category Modifiers
   */
  change(): this {
    return this.alter();
  }

  /**
   * Attach a column comment. No-op on SQLite; intended to emit a `COMMENT` on
   * MySQL/Postgres.
   * @category Modifiers
   */
  comment(_text: string): this {
    return this;
  }

  /**
   * Place this column after `column` in the table (MySQL / MariaDB only).
   * Accepted but ignored on SQLite and PostgreSQL.
   * @category Modifiers
   */

  after(_column: string): this {
    return this;
  }

  /**
   * Place this column before `column` in the table (MySQL / MariaDB only).
   * No-op on SQLite / PostgreSQL.
   * @category Modifiers
   */

  before(_column: string): this {
    return this;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Whether a standalone `CREATE INDEX` should be emitted for this column
   * (`index()` was called and the column is not `unique()`).
   * @internal
   */
  get wantsIndex(): boolean {
    return this._needsIndex && !this._isUnique;
  }

  /**
   * Whether this column is the table primary key (set via constructor or `primary()`).
   * @internal
   */
  get isPrimary(): boolean {
    return this._isPrimary;
  }

  /**
   * True when this column should modify an existing column rather than add a new one.
   * @internal
   */
  get isAlter(): boolean {
    return this._isAlter;
  }

  /**
   * Compile this column into its SQL fragment, e.g.
   * `email TEXT NOT NULL DEFAULT 'x' UNIQUE`. Consumed by {@link Blueprint}.
   * @internal
   */
  toColumnSQL(dialect: DialectName = "sqlite"): string {
    // Auto-increment is the one column shape no two engines spell alike, so the whole
    // fragment comes from the dialect rather than being assembled here. Emitting SQLite's
    // `INTEGER PRIMARY KEY AUTOINCREMENT` unconditionally made the first migrate against
    // PostgreSQL a syntax error and against MySQL a 1064.
    if (this._isAutoIncr) return getDialect(dialect).autoIncrementColumn(this.name);

    const parts: string[] = [`${this.name} ${this._sqlType}`];

    if (this._isPrimary) parts.push("PRIMARY KEY");
    if (!this._isNullable && !this._isPrimary) parts.push("NOT NULL");

    if (this._useCurrent) parts.push("DEFAULT CURRENT_TIMESTAMP");
    else if (this._hasDefault) parts.push(`DEFAULT ${this._serializeDefault()}`);

    if (this._isUnique) parts.push("UNIQUE");
    if (this._check) parts.push(`CHECK (${this._check})`);
    if (this._generated)
      parts.push(`GENERATED ALWAYS AS (${this._generated.expr}) ${this._generated.mode}`);

    return parts.join(" ");
  }

  private _serializeDefault(): string {
    const v = this._default;
    if (v === null) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
    return String(v);
  }
}

// ── ForeignIdColumnBuilder ────────────────────────────────────────────────────

/**
 * Returned by `foreignId()` and `foreignUuid()`.  Extends `ColumnBuilder` with
 * a `.constrained()` helper that wires the foreign-key constraint, inferring
 * the referenced table from the column name.
 *
 * @example
 *   table.foreignId('user_id').constrained();                  // → users.id
 *   table.foreignId('author_id').constrained('users');          // → users.id
 *   table.foreignId('author_id').constrained('users', 'uuid');  // → users.uuid
 *   table.foreignId('user_id').nullable().constrained().nullOnDelete();
 */
export class ForeignIdColumnBuilder<Locked extends string = never> extends ColumnBuilder<Locked> {
  constructor(
    name: string,
    sqlType: string,
    private readonly _addFk: (col: string) => ForeignKeyBuilder,
  ) {
    super(name, sqlType);
  }

  /**
   * Allow NULL, keeping `.constrained()` reachable.
   *
   * The base `nullable()` returns `ColumnBuilder`, which drops the subclass — so
   * the documented `foreignId('user_id').nullable().constrained()` did not
   * compile, and a nullable foreign key is the commonest kind there is. These
   * two overrides re-declare the return as this builder while keeping the
   * phantom lock, so `.nullable().notNullable()` is still a compile error.
   *
   * @locked `nullability` — shared with `notNullable()`.
   * @category Nullability & defaults
   */
  override nullable(): "nullability" extends Locked
    ? never
    : ForeignIdColumnBuilder<Locked | "nullability"> {
    super.nullable();
    // `as any` per this file's own convention (see the header note): TypeScript
    // cannot reduce a deferred conditional inside a generic body.
    return this as any;
  }

  /**
   * Enforce NOT NULL explicitly, keeping `.constrained()` reachable.
   *
   * @locked `nullability` — shared with `nullable()`.
   * @category Nullability & defaults
   */
  override notNullable(): "nullability" extends Locked
    ? never
    : ForeignIdColumnBuilder<Locked | "nullability"> {
    super.notNullable();
    return this as any;
  }

  /**
   * Add a `FOREIGN KEY` constraint for this column. The referenced table is
   * inferred from the column name (`user_id` → `users`) unless supplied
   * explicitly; note the inference is naive — it strips a trailing `_id` and
   * appends `s`, so irregular plurals (`category_id` → `categorys`) need an
   * explicit table argument.
   *
   * @param table - Referenced table; defaults to the name inferred from the column.
   * @param column - Referenced column; defaults to `"id"`.
   * @returns The {@link ForeignKeyBuilder} so `.onDelete()` etc. can be chained.
   * @category Foreign keys
   */
  constrained(table?: string, column = "id"): ForeignKeyBuilder {
    const tbl = table ?? _inferTable(this.name);
    return this._addFk(this.name).references(column).on(tbl);
  }
}

function _inferTable(column: string): string {
  // 'user_id' → 'user' → 'users',  'category_id' → 'categories' (naive +s)
  const base = column.replace(/_id$/, "");
  return base.endsWith("s") ? base : base + "s";
}

// ── ForeignKeyBuilder ─────────────────────────────────────────────────────────

/** Referential action for a foreign key's `ON DELETE` / `ON UPDATE` clause. */
export type FKAction = "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";

/**
 * Builds a table-level `FOREIGN KEY` constraint. Obtained from
 * {@link Blueprint.foreign}, or indirectly via
 * {@link ForeignIdColumnBuilder.constrained}. Configure the referenced
 * table/column and referential actions by chaining, then the constraint is
 * compiled by {@link ForeignKeyBuilder.toConstraintSQL} when the table is built.
 *
 * @example
 * ```ts
 * table.foreign('user_id').references('id').on('users').onDelete('CASCADE');
 * table.foreign('user_id').references('users.id').nullOnDelete();
 * ```
 */
export class ForeignKeyBuilder {
  private _refTable = "";
  private _refColumn = "id";
  private _onDelete?: FKAction;
  private _onUpdate?: FKAction;

  constructor(private readonly _column: string) {}

  /**
   * Set the referenced column. Accepts either a bare column name (`'id'`) or a
   * `'table.column'` shorthand that also sets the referenced table:
   *
   * ```ts
   * table.foreign('user_id').references('users.id').onDelete('CASCADE');
   * table.foreign('user_id').references('id').on('users').onDelete('CASCADE');
   * ```
   *
   * @param columnOrTableDotColumn - `"col"` or `"table.col"`.
   * @category Foreign keys
   */
  references(columnOrTableDotColumn: string): this {
    if (columnOrTableDotColumn.includes(".")) {
      const [tbl, col] = columnOrTableDotColumn.split(".", 2);
      this._refTable = tbl ?? "";
      this._refColumn = col ?? "id";
    } else {
      this._refColumn = columnOrTableDotColumn;
    }
    return this;
  }

  /**
   * Set the referenced table.
   * @category Foreign keys
   */
  on(table: string): this {
    this._refTable = table;
    return this;
  }

  /**
   * Set the `ON DELETE` referential action.
   * @category Foreign keys
   */
  onDelete(action: FKAction): this {
    this._onDelete = action;
    return this;
  }

  /**
   * Set the `ON UPDATE` referential action.
   * @category Foreign keys
   */
  onUpdate(action: FKAction): this {
    this._onUpdate = action;
    return this;
  }

  /**
   * Shorthand for `.onDelete('CASCADE')`.
   * @category Foreign keys
   */
  cascadeOnDelete(): this {
    return this.onDelete("CASCADE");
  }

  /**
   * Shorthand for `.onUpdate('CASCADE')`.
   * @category Foreign keys
   */
  cascadeOnUpdate(): this {
    return this.onUpdate("CASCADE");
  }

  /**
   * Shorthand for `.onDelete('SET NULL')`.
   * @category Foreign keys
   */
  nullOnDelete(): this {
    return this.onDelete("SET NULL");
  }

  /**
   * Shorthand for `.onDelete('RESTRICT')`.
   * @category Foreign keys
   */
  restrictOnDelete(): this {
    return this.onDelete("RESTRICT");
  }

  /**
   * Compile this foreign key into its inline constraint SQL, e.g.
   * `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.
   * @internal
   */
  toConstraintSQL(): string {
    let sql = `FOREIGN KEY (${this._column}) REFERENCES ${this._refTable}(${this._refColumn})`;
    if (this._onDelete) sql += ` ON DELETE ${this._onDelete}`;
    if (this._onUpdate) sql += ` ON UPDATE ${this._onUpdate}`;
    return sql;
  }
}
