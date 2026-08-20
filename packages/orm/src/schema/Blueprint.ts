import { ColumnBuilder, ForeignIdColumnBuilder, ForeignKeyBuilder } from "./ColumnDefinition.ts";

// ── Storage interface ─────────────────────────────────────────────────────────
// Blueprint stores columns as `IColumnSQL` so the phantom `Locked` type is
// erased at the array boundary.  The SQL compilation loop only ever calls
// `toColumnSQL()`, `name`, and `wantsIndex`.

interface IColumnSQL {
  readonly name: string;
  readonly wantsIndex: boolean;
  readonly isAlter: boolean;
  toColumnSQL(dialect?: "sqlite" | "mysql" | "postgres"): string;
}

interface IndexEntry {
  columns: string[];
  name: string | undefined;
  unique: boolean;
}

interface RenameEntry {
  from: string;
  to: string;
}

interface DropIndexEntry {
  nameOrColumns: string | string[];
}

// ── Blueprint ─────────────────────────────────────────────────────────────────

/**
 * The fluent table builder passed as `table` to the callbacks of
 * {@link Schema.create}, {@link Schema.createIfNotExists} and {@link Schema.table}.
 *
 * Each method call records an intent (a column, an index, a foreign key, a drop,
 * a rename) on the blueprint; the accumulated intent is compiled to SQL only when
 * the surrounding `Schema` helper calls {@link Blueprint.toCreateSQL} (for
 * `create`) or {@link Blueprint.toAlterSQL} (for `table`). Column-type methods
 * return a {@link ColumnBuilder} (or {@link ForeignIdColumnBuilder}) so per-column
 * modifiers can be chained; table-level methods return `this` so index and
 * constraint calls can be chained.
 *
 * @remarks
 * This ORM targets SQLite (via `Bun.sql`) as its primary dialect, so the concrete
 * storage type of every column collapses to one of SQLite's storage classes:
 * `INTEGER`, `REAL`, `TEXT` or `BLOB`. The many distinct column-type methods
 * (`bigInteger`, `mediumText`, `char`, `decimal`, …) exist for a familiar,
 * expressive schema API and multi-database portability, but on SQLite several of
 * them compile to
 * the same underlying type and length/precision arguments are accepted yet
 * ignored. Notes on the affected methods call this out. Dialect-specific
 * behaviour (MySQL `MODIFY COLUMN`, PostgreSQL per-attribute `ALTER COLUMN`,
 * fulltext/spatial indexes) is only exercised on the ALTER path via
 * {@link Blueprint.toAlterSQL}.
 *
 * @example
 * ```ts
 * await Schema.create('posts', (table) => {
 *   table.id();
 *   table.string('title');
 *   table.text('body').nullable();
 *   table.enum('status', ['draft', 'published']).default('draft');
 *   table.foreignId('author_id').constrained('users').cascadeOnDelete();
 *   table.timestamps();
 *
 *   table.unique('title');
 *   table.index(['status', 'author_id']);
 * });
 * ```
 */
export class Blueprint {
  private _cols: IColumnSQL[] = [];
  private _fks: ForeignKeyBuilder[] = [];
  private _indexes: IndexEntry[] = [];
  private _drops: string[] = [];
  private _renames: RenameEntry[] = [];
  private _dropIndexes: DropIndexEntry[] = [];
  private _dropForeigns: Array<string | string[]> = [];
  private _fulltexts: IndexEntry[] = [];
  private _tablePK: string[] | null = null;

  // ── Integer columns ───────────────────────────────────────────────────────

  /**
   * Auto-incrementing integer primary key.
   * Shorthand: `table.id()` is identical to `table.increments('id')`.
   *
   * @param name - Column name, defaults to `"id"`.
   * @returns The column builder for the new `INTEGER PRIMARY KEY AUTOINCREMENT` column.
   * @category Column types
   */
  id(name = "id"): ColumnBuilder {
    return this.increments(name);
  }

  /**
   * Auto-incrementing `INTEGER PRIMARY KEY AUTOINCREMENT` column.
   *
   * @param name - Column name, defaults to `"id"`.
   * @category Column types
   */
  increments(name = "id"): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER", true, true));
  }

  /**
   * Auto-incrementing big-integer primary key. On SQLite this is identical to
   * {@link Blueprint.increments} (both use the `INTEGER` storage class).
   *
   * @param name - Column name, defaults to `"id"`.
   * @category Column types
   */
  bigIncrements(name = "id"): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER", true, true));
  }

  /**
   * Signed `INTEGER` column.
   * @category Column types
   */
  integer(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  /**
   * Big-integer column. Stored as `INTEGER` on SQLite (no distinct `BIGINT` type).
   * @category Column types
   */
  bigInteger(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  /**
   * Tiny-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  tinyInteger(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  /**
   * Small-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  smallInteger(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  /**
   * Medium-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  mediumInteger(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  /**
   * Unsigned integer column. The unsigned flag is tracked for multi-DB
   * compatibility only — SQLite has no `UNSIGNED` type, so no extra SQL is emitted.
   * @category Column types
   */
  unsignedInteger(name: string): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "INTEGER")).unsigned();
  }

  /**
   * Unsigned big-integer column — the conventional type for foreign-key columns.
   * Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  unsignedBigInteger(name: string): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "INTEGER")).unsigned();
  }

  /**
   * Unsigned small-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  unsignedSmallInteger(name: string): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "INTEGER")).unsigned();
  }

  /**
   * Unsigned tiny-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  unsignedTinyInteger(name: string): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "INTEGER")).unsigned();
  }

  /**
   * Unsigned medium-integer column. Stored as `INTEGER` on SQLite.
   * @category Column types
   */
  unsignedMediumInteger(name: string): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "INTEGER")).unsigned();
  }

  // ── String / text columns ─────────────────────────────────────────────────

  /**
   * Variable-length string column (`VARCHAR`-style), stored as `TEXT`.
   * @param name - Column name.
   * @param _length - Max length; accepted for multi-DB compatibility but ignored on SQLite.
   * @category Column types
   */
  string(name: string, _length = 255): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Fixed-length `CHAR` column. Stored as `TEXT` on SQLite; `_length` is ignored.
   * @category Column types
   */
  char(name: string, _length = 255): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * `TEXT` column for arbitrary-length strings.
   * @category Column types
   */
  text(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Tiny-text column. Stored as `TEXT` on SQLite.
   * @category Column types
   */
  tinyText(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Medium-text column. Stored as `TEXT` on SQLite.
   * @category Column types
   */
  mediumText(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Long-text column. Stored as `TEXT` on SQLite.
   * @category Column types
   */
  longText(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  // ── UUID / ULID ───────────────────────────────────────────────────────────

  /**
   * UUID column — stored as `TEXT` (36 chars).
   *
   * @example
   * ```ts
   * table.uuid('id').primary();
   * table.uuid('id').primary().defaultTo(sql`gen_random_uuid()`);
   * ```
   * @category Column types
   */
  uuid(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * ULID column — stored as `TEXT` (26 chars).
   * ULIDs are lexicographically sortable and URL-safe.
   * @category Column types
   */
  ulid(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  // ── Numeric columns ───────────────────────────────────────────────────────

  /**
   * Single-precision floating-point column, stored as `REAL`.
   * @category Column types
   */
  float(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "REAL"));
  }

  /**
   * Double-precision floating-point column, stored as `REAL`.
   * `_precision`/`_scale` are accepted for multi-DB compatibility but ignored on SQLite.
   * @category Column types
   */
  double(name: string, _precision?: number, _scale?: number): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "REAL"));
  }

  /**
   * Fixed-point decimal column. Stored as `REAL` on SQLite (no exact `DECIMAL`
   * type); `_precision`/`_scale` are accepted but ignored.
   * @category Column types
   */
  decimal(name: string, _precision = 8, _scale = 2): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "REAL"));
  }

  /**
   * Unsigned fixed-point decimal column. Stored as `REAL` on SQLite; the unsigned
   * flag is tracked for compatibility only.
   * @category Column types
   */
  unsignedDecimal(name: string, _precision = 8, _scale = 2): ColumnBuilder<"unsigned"> {
    return this._add(new ColumnBuilder(name, "REAL")).unsigned();
  }

  // ── Boolean ───────────────────────────────────────────────────────────────

  /**
   * Boolean column. The storage type is the engine's: `INTEGER` holding 0 / 1 on
   * SQLite and MySQL, a real `BOOLEAN` on PostgreSQL — which rejects the integer
   * form for both assignment and comparison, so emitting `INTEGER` everywhere
   * built a column that would not take its own booleans. JS booleans passed to
   * {@link ColumnBuilder.default} follow the same engine's spelling.
   * @category Column types
   */
  boolean(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER", false, false, true));
  }

  // ── Date / time columns ───────────────────────────────────────────────────

  /**
   * Date-and-time column, stored as `TEXT` (ISO-8601).
   * @category Column types
   */
  dateTime(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Alias of {@link Blueprint.dateTime}, spelled the way the column *type* is.
   *
   * The type string is lowercase (`@column({ type: "datetime" })`) while the builder
   * method is camelCase, so reaching for `table.datetime(...)` is the natural mistake —
   * and the blueprint is loosely typed, so it surfaced as a `TypeError` mid-migration
   * rather than a compile error.
   * @category Column types
   */
  datetime(name: string): ColumnBuilder {
    return this.dateTime(name);
  }

  /**
   * Timestamp column. Alias of {@link Blueprint.dateTime} — stored as `TEXT` (ISO-8601).
   * @category Column types
   */
  timestamp(name: string): ColumnBuilder {
    return this.dateTime(name);
  }

  /**
   * Date-only column, stored as `TEXT` (`YYYY-MM-DD`).
   * @category Column types
   */
  date(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * Time-of-day column, stored as `TEXT` (`HH:MM:SS`).
   * @category Column types
   */
  time(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * 4-digit year column, stored as `INTEGER`.
   * @category Column types
   */
  year(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "INTEGER"));
  }

  // ── Binary ────────────────────────────────────────────────────────────────

  /**
   * Binary column, stored as `BLOB`.
   * @category Column types
   */
  binary(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "BLOB"));
  }

  // ── JSON ──────────────────────────────────────────────────────────────────

  /**
   * JSON column, stored as `TEXT` (serialised JSON).
   * @category Column types
   */
  json(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  // ── Enum / set ────────────────────────────────────────────────────────────

  /**
   * Enum column — stored as `TEXT` with a `CHECK` constraint enforcing the
   * allowed values. Single quotes in values are escaped.
   *
   * @param name - Column name.
   * @param values - The permitted string values.
   * @example
   * ```ts
   * table.enum('status', ['active', 'inactive', 'suspended']);
   * ```
   * @category Column types
   */
  enum(name: string, values: string[]): ColumnBuilder<"check"> {
    const quoted = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    return this._add(new ColumnBuilder(name, "TEXT")).check(`${name} IN (${quoted})`);
  }

  /**
   * MySQL `SET` column — stored as `TEXT` on SQLite. Unlike {@link Blueprint.enum},
   * no `CHECK` constraint is emitted, so `_values` is not enforced on SQLite.
   * @category Column types
   */

  set(name: string, _values: string[]): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  // ── Network / IP ─────────────────────────────────────────────────────────

  /**
   * IPv4 / IPv6 address column — stored as `TEXT` (up to 45 chars for IPv6).
   * @category Column types
   */
  ipAddress(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  /**
   * MAC address column — stored as `TEXT` (17 chars, `xx:xx:xx:xx:xx:xx`).
   * @category Column types
   */
  macAddress(name: string): ColumnBuilder {
    return this._add(new ColumnBuilder(name, "TEXT"));
  }

  // ── Foreign keys (fluent) ─────────────────────────────────────────────────

  /**
   * Unsigned big-integer foreign-key column. Chain `.constrained()` on the
   * returned {@link ForeignIdColumnBuilder} to add the `FOREIGN KEY` constraint
   * automatically, inferring the referenced table from the column name.
   *
   * ```ts
   * table.foreignId('user_id').constrained().nullOnDelete();
   * table.foreignId('post_id').constrained('blog_posts');
   * ```
   *
   * @category Foreign keys
   */
  foreignId(name: string): ForeignIdColumnBuilder {
    const col = new ForeignIdColumnBuilder(name, "INTEGER", (c) => this.foreign(c));
    col.unsigned();
    this._cols.push(col as unknown as IColumnSQL);
    return col;
  }

  /**
   * UUID (`TEXT`) foreign-key column. Chain `.constrained()` on the returned
   * {@link ForeignIdColumnBuilder} to add the FK constraint:
   *
   * ```ts
   * table.foreignUuid('user_id').constrained();
   * ```
   *
   * @category Foreign keys
   */
  foreignUuid(name: string): ForeignIdColumnBuilder {
    const col = new ForeignIdColumnBuilder(name, "TEXT", (c) => this.foreign(c));
    this._cols.push(col as unknown as IColumnSQL);
    return col;
  }

  // ── Shorthands ────────────────────────────────────────────────────────────

  /**
   * Add nullable `created_at` and `updated_at` (`TEXT`) columns.
   * @category Table modifiers
   */
  timestamps(): void {
    this.dateTime("created_at").nullable();
    this.dateTime("updated_at").nullable();
  }

  /**
   * Alias for {@link Blueprint.timestamps} — both columns are always nullable.
   * @category Table modifiers
   */
  nullableTimestamps(): void {
    this.timestamps();
  }

  /**
   * Add a nullable `deleted_at` (`TEXT`) column for soft-delete support.
   * @param column - Column name, defaults to `"deleted_at"`.
   * @category Table modifiers
   */
  softDeletes(column = "deleted_at"): void {
    this.dateTime(column).nullable();
  }

  /**
   * Add `remember_token` — a nullable 100-char string used by session-based
   * "remember me" functionality.
   * @category Table modifiers
   */
  rememberToken(): ColumnBuilder<"nullability"> {
    return this.string("remember_token", 100).nullable();
  }

  /**
   * Add `{name}_id` (unsigned big-integer) and `{name}_type` (string) columns
   * plus a composite index — the standard polymorphic-relation pattern.
   *
   * @param name - Relation base name (e.g. `"taggable"`).
   * @param indexName - Optional explicit name for the composite index.
   * @example
   * ```ts
   * table.morphs('taggable');
   * // adds: taggable_id INTEGER, taggable_type TEXT, index on both
   * ```
   * @category Table modifiers
   */
  morphs(name: string, indexName?: string): void {
    this.unsignedBigInteger(`${name}_id`);
    this.string(`${name}_type`);
    this.index([`${name}_id`, `${name}_type`], indexName);
  }

  /**
   * Same as {@link Blueprint.morphs} but both columns are nullable.
   * @category Table modifiers
   */
  nullableMorphs(name: string, indexName?: string): void {
    this.unsignedBigInteger(`${name}_id`).nullable();
    this.string(`${name}_type`).nullable();
    this.index([`${name}_id`, `${name}_type`], indexName);
  }

  /**
   * UUID-based polymorphic relation columns: `{name}_id` (`TEXT` UUID) and
   * `{name}_type` (string) plus a composite index.
   * @category Table modifiers
   */
  uuidMorphs(name: string, indexName?: string): void {
    this.uuid(`${name}_id`);
    this.string(`${name}_type`);
    this.index([`${name}_id`, `${name}_type`], indexName);
  }

  // ── Foreign keys (explicit) ───────────────────────────────────────────────

  /**
   * Begin an explicit foreign-key constraint on an existing column, returning a
   * {@link ForeignKeyBuilder} to configure the referenced table/column and
   * referential actions.
   *
   * @example
   * ```ts
   * table.foreign('user_id').references('id').on('users').onDelete('CASCADE');
   * ```
   * @category Foreign keys
   */
  foreign(column: string): ForeignKeyBuilder {
    const fk = new ForeignKeyBuilder(column);
    this._fks.push(fk);
    return fk;
  }

  // ── Table-level constraints ───────────────────────────────────────────────

  /**
   * Define a table-level (optionally composite) primary key. Only applied on
   * `CREATE TABLE` and only when no column already declares itself the primary key.
   *
   * @param columns - One column name or several for a composite key.
   * @param _name - Constraint name; accepted for compatibility but unused on SQLite.
   * @example
   * ```ts
   * table.primary(['user_id', 'role_id']);
   * ```
   * @category Indexes
   */
  primary(columns: string | string[], _name?: string): this {
    this._tablePK = _arr(columns);
    return this;
  }

  /**
   * Add a non-unique index across one or more columns. When `name` is omitted the
   * index name is derived as `{table}_{cols}_index`.
   * @category Indexes
   */
  index(columns: string | string[], name?: string): this {
    this._indexes.push({ columns: _arr(columns), unique: false, name });
    return this;
  }

  /**
   * Add a unique index across one or more columns. When `name` is omitted the
   * index name is derived as `{table}_{cols}_unique`.
   * @category Indexes
   */
  unique(columns: string | string[], name?: string): this {
    this._indexes.push({ columns: _arr(columns), unique: true, name });
    return this;
  }

  /**
   * Full-text index. On MySQL/Postgres this is intended to emit a `FULLTEXT`/GIN
   * index; on SQLite a plain `CREATE INDEX` is emitted (use FTS5 virtual tables
   * for true full-text search there).
   * @category Indexes
   */
  fulltext(columns: string | string[], name?: string): this {
    this._fulltexts.push({ columns: _arr(columns), unique: false, name });
    return this;
  }

  /**
   * Spatial (GIS) index. Falls back to a plain `CREATE INDEX` on SQLite.
   * @category Indexes
   */
  spatialIndex(columns: string | string[], name?: string): this {
    this._fulltexts.push({ columns: _arr(columns), unique: false, name });
    return this;
  }

  // ── ALTER TABLE helpers ───────────────────────────────────────────────────

  /**
   * Drop one or more columns (`ALTER TABLE … DROP COLUMN`). Only meaningful on the
   * ALTER path, i.e. inside a {@link Schema.table} callback.
   * @category Dropping
   */
  dropColumn(...names: string[]): this {
    this._drops.push(...names);
    return this;
  }

  /**
   * The columns this blueprint will drop.
   *
   * Read by {@link Schema.table} so it can refuse an impossible drop on SQLite
   * *before* running any statement, rather than after the earlier ones have
   * already applied.
   *
   * @internal
   */
  get _pendingDrops(): readonly string[] {
    return this._drops;
  }

  /**
   * Rename a column (`ALTER TABLE … RENAME COLUMN from TO to`).
   * @category Table modifiers
   */
  renameColumn(from: string, to: string): this {
    this._renames.push({ from, to });
    return this;
  }

  /**
   * Drop an index by name, or by deriving `{table}_{cols}_index` from a column list.
   * Emits `DROP INDEX IF EXISTS`; a no-op when the name cannot be determined.
   * @category Dropping
   */
  dropIndex(nameOrColumns: string | string[]): this {
    this._dropIndexes.push({ nameOrColumns });
    return this;
  }

  /**
   * Drop a unique index. On SQLite unique constraints are implemented as indexes,
   * so this is identical to {@link Blueprint.dropIndex}.
   * @category Dropping
   */
  dropUnique(nameOrColumns: string | string[]): this {
    return this.dropIndex(nameOrColumns);
  }

  /**
   * Drop a foreign-key constraint by name (or derived `{table}_{cols}_foreign`).
   * Emits `ALTER TABLE … DROP FOREIGN KEY` (MySQL) / `DROP CONSTRAINT` (Postgres).
   * No SQL is emitted on SQLite, which cannot drop FK constraints without a full
   * table rebuild — use a rebuild migration there.
   * @category Dropping
   */
  dropForeign(nameOrColumns: string | string[]): this {
    this._dropForeigns.push(nameOrColumns);
    return this;
  }

  /**
   * Drop the table primary key.
   *
   * @remarks
   * Currently a no-op for every dialect: it records no intent and emits no SQL.
   * Dropping a primary key on SQLite requires a full table rebuild.
   * @category Dropping
   */
  dropPrimary(): this {
    return this;
  }

  // ── SQL generation ────────────────────────────────────────────────────────

  /**
   * Compile the accumulated column/constraint/index intent into the statements
   * that create the table. Called by {@link Schema.create}.
   *
   * @param table - Target table name.
   * @returns `[ "CREATE TABLE …", ...("CREATE INDEX …")* ]` — the create statement
   * first, followed by one statement per index.
   * @category Table modifiers
   */
  toCreateSQL(table: string, dialect: "sqlite" | "mysql" | "postgres" = "sqlite"): string[] {
    const inlineParts: string[] = [];

    for (const col of this._cols) inlineParts.push(col.toColumnSQL(dialect));

    // Table-level composite primary key (only when no column-level PK exists)
    if (this._tablePK) {
      inlineParts.push(`PRIMARY KEY (${this._tablePK.join(", ")})`);
    }

    for (const fk of this._fks) inlineParts.push(fk.toConstraintSQL());

    return [
      `CREATE TABLE ${table} (\n  ${inlineParts.join(",\n  ")}\n)`,
      ...this._indexStatements(table),
    ];
  }

  /**
   * Compile the accumulated intent into `ALTER TABLE` / `CREATE INDEX IF NOT
   * EXISTS` / `DROP INDEX` statements. Called by {@link Schema.table}.
   *
   * @param table - Target table name.
   * @param dialect - Governs column-modification and drop-foreign SQL; defaults to `"sqlite"`.
   * @returns The ordered list of DDL statements to execute.
   * @category Table modifiers
   */
  toAlterSQL(table: string, dialect: "sqlite" | "mysql" | "postgres" = "sqlite"): string[] {
    const statements: string[] = [];

    for (const col of this._cols) {
      if (!col.isAlter) {
        // New column — all dialects support ADD COLUMN.
        statements.push(`ALTER TABLE ${table} ADD COLUMN ${col.toColumnSQL(dialect)}`);
      } else {
        // Column modification — dialect-specific.
        statements.push(..._alterColumnSQL(table, col, dialect));
      }
    }
    for (const name of this._drops) statements.push(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    for (const r of this._renames)
      statements.push(`ALTER TABLE ${table} RENAME COLUMN ${r.from} TO ${r.to}`);
    for (const di of this._dropIndexes) {
      const idxName = _resolveIndexName(table, di.nameOrColumns);
      if (idxName) statements.push(`DROP INDEX IF EXISTS ${idxName}`);
    }
    for (const df of this._dropForeigns) {
      const fkName = _resolveForeignName(table, df);
      if (dialect === "mysql") statements.push(`ALTER TABLE ${table} DROP FOREIGN KEY ${fkName}`);
      else if (dialect === "postgres")
        statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${fkName}`);
      // SQLite: cannot drop a FK constraint in place — no statement emitted.
    }

    statements.push(...this._indexStatements(table, true));
    return statements;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _add<L extends string>(col: ColumnBuilder<L>): ColumnBuilder<L> {
    this._cols.push(col as unknown as IColumnSQL);
    return col;
  }

  private _indexStatements(table: string, ifNotExists = false): string[] {
    const stmts: string[] = [];
    const guard = ifNotExists ? "IF NOT EXISTS " : "";

    for (const idx of this._indexes) {
      const name =
        idx.name ?? `${table}_${idx.columns.join("_")}_${idx.unique ? "unique" : "index"}`;
      const unique = idx.unique ? "UNIQUE " : "";
      stmts.push(`CREATE ${unique}INDEX ${guard}${name} ON ${table} (${idx.columns.join(", ")})`);
    }

    for (const ft of this._fulltexts) {
      const name = ft.name ?? `${table}_${ft.columns.join("_")}_fulltext`;
      stmts.push(`CREATE INDEX ${guard}${name} ON ${table} (${ft.columns.join(", ")})`);
    }

    for (const col of this._cols) {
      if (col.wantsIndex) {
        stmts.push(`CREATE INDEX ${guard}${table}_${col.name}_index ON ${table} (${col.name})`);
      }
    }

    return stmts;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _arr(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

function _resolveForeignName(table: string, nameOrColumns: string | string[]): string {
  if (typeof nameOrColumns === "string") return nameOrColumns;
  return `${table}_${nameOrColumns.join("_")}_foreign`;
}

function _resolveIndexName(table: string, nameOrColumns: string | string[]): string | null {
  if (typeof nameOrColumns === "string" && !nameOrColumns.includes(",")) {
    return nameOrColumns; // already a name
  }
  const cols = _arr(nameOrColumns);
  return `${table}_${cols.join("_")}_index`;
}

// ── Dialect-aware ALTER COLUMN ────────────────────────────────────────────────

interface IAlterCol {
  readonly name: string;
  toColumnSQL(dialect?: "sqlite" | "mysql" | "postgres"): string;
}

/**
 * Emit the correct SQL to modify an existing column, per dialect.
 *
 * MySQL / MariaDB:
 *   ALTER TABLE t MODIFY COLUMN col TEXT NOT NULL DEFAULT 'x'
 *
 * PostgreSQL:
 *   ALTER TABLE t ALTER COLUMN col TYPE TEXT,
 *   ALTER COLUMN col SET/DROP NOT NULL,
 *   ALTER COLUMN col SET/DROP DEFAULT …
 *   (PostgreSQL requires one sub-command per attribute change.)
 *
 * SQLite:
 *   SQLite does not support modifying column definitions without a full table
 *   rebuild.  A console warning is emitted and the statement is skipped.
 *   Use a manual table-rebuild migration when you need structural changes on
 *   SQLite.
 */
function _alterColumnSQL(
  table: string,
  col: IAlterCol,
  dialect: "sqlite" | "mysql" | "postgres",
): string[] {
  if (dialect === "mysql") {
    return [`ALTER TABLE ${table} MODIFY COLUMN ${col.toColumnSQL("mysql")}`];
  }

  if (dialect === "postgres") {
    // Parse the full column SQL to extract type + constraints.
    // col.toColumnSQL() returns e.g. "name TEXT NOT NULL DEFAULT 'x'"
    return _postgresAlterStatements(table, col);
  }

  // SQLite — warn and skip.
  console.warn(
    `[Zerotal ORM] Warning: .alter() on column "${col.name}" in table "${table}" ` +
      `is not supported by SQLite and was skipped.\n` +
      `SQLite requires a full table rebuild to change a column's type or constraints.\n` +
      `Consider creating a new column, migrating data, and dropping the old one instead.`,
  );
  return [];
}

/**
 * Break a full column definition into individual PostgreSQL ALTER COLUMN
 * sub-commands so each attribute can be changed independently.
 *
 * Example: "email TEXT NOT NULL DEFAULT 'x'"  →
 *   ALTER TABLE users ALTER COLUMN email TYPE TEXT
 *   ALTER TABLE users ALTER COLUMN email SET NOT NULL
 *   ALTER TABLE users ALTER COLUMN email SET DEFAULT 'x'
 */
function _postgresAlterStatements(table: string, col: IAlterCol): string[] {
  const sql = col.toColumnSQL(); // e.g. "email TEXT NOT NULL DEFAULT 'val' UNIQUE"
  const name = col.name;
  const stmts: string[] = [];

  // Extract the SQL type (first token after the column name).
  const afterName = sql.slice(name.length).trim();
  const typeMatch = afterName.match(/^([A-Z]+(?:\([^)]*\))?)/i);
  if (typeMatch) {
    stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${name} TYPE ${typeMatch[1]}`);
  }

  // NOT NULL / nullable.
  if (/\bNOT NULL\b/i.test(afterName)) {
    stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${name} SET NOT NULL`);
  } else {
    stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${name} DROP NOT NULL`);
  }

  // DEFAULT.
  const defMatch = afterName.match(
    /\bDEFAULT\s+(\S+(?:\s+\S+)*?)(?:\s+(?:NOT NULL|NULL|UNIQUE|CHECK|GENERATED)\b|$)/i,
  );
  if (defMatch) {
    stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${name} SET DEFAULT ${defMatch[1]}`);
  } else {
    stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${name} DROP DEFAULT`);
  }

  return stmts;
}
