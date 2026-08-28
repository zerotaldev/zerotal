# Changelog — @zerotal/orm

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **`zt db:backup`** — a verified snapshot of the SQLite database. SQLite is the default
  driver, which makes the database one file and makes `cp` look like a backup; it is not one,
  because copying a live database can capture a half-written page and produce a file that
  restores as corrupt, months later, from the one file you were relying on. This uses
  `VACUUM INTO`, which takes a read lock and writes a complete database while the server
  keeps serving, and needs no `sqlite3` binary on the box.

  Every snapshot is opened and integrity-checked the moment it is written, and every failure
  path exits non-zero — a backup job that reports success while writing nothing buys the
  confidence without the file. `--require-rows` names the tables whose loss would end the
  business and fails when the snapshot has none of them; `--rehearse` performs the actual
  restore, because a backup nobody has restored is a hope. A snapshot that fails any check is
  removed rather than left in the retention directory, where it would be indistinguishable
  from a good one and, being newest, would push a verified older one out on the next prune.
  Retention (`--keep`) only ever touches files this command wrote.

## [1.7.4] — 2026-08-21

### Fixed

- **A string column could not carry an index on MySQL.** `table.string()` compiled to `TEXT`
  on every engine and discarded its `length` argument — the parameter existed and was
  documented as "accepted for multi-DB compatibility", wired to nothing. MySQL refuses to key
  a TEXT column without a prefix length, so `table.string("email").unique()` failed at
  `CREATE TABLE`:

  ```text
  BLOB/TEXT column 'email' used in key specification without a key length
  ```

  Any natural key — an email, a slug — was unusable on MySQL, and `index()` the same. The
  storage type now comes from the dialect, beside `booleanType` and `autoIncrementColumn`:
  MySQL gets `VARCHAR(length)`, while SQLite and PostgreSQL keep `TEXT`, which PostgreSQL
  indexes happily. `char()` had the identical bug and the identical fix.

  Found by the new MySQL smoke suite on its first run against a real server.

## [1.7.3] — 2026-08-20

### Fixed

- **A boolean column could not hold a boolean on PostgreSQL.** `table.boolean()` compiled to
  `INTEGER` on every engine — correct on SQLite, which has no boolean type, and rejected outright
  by PostgreSQL: `column "…" is of type integer but expression is of type boolean` (42804) on the
  first insert, and again on any `where(column, true)`. `DEFAULT` clauses failed the same way, a
  boolean default having been serialised to `1`. The storage type now comes from the dialect, as
  the auto-increment column already did. SQLite and MySQL are unchanged; existing PostgreSQL
  tables keep their integer columns until a migration alters them. Found by the new smoke suite
  that runs the ORM against a real PostgreSQL in CI.

## [1.7.2] — 2026-08-18

### Fixed

- **A seeder that failed partway left its rows behind.** `Seeder.call()` has always wrapped
  _composed_ seeders in a transaction, so a `DatabaseSeeder` that delegates was atomic and one that
  does its work inline — which is most of them — was not. A failure on the fourth table committed
  the first three, so the obvious next move, running it again, died on a unique constraint, and the
  only way out was `migrate:fresh`. Migrations became transactional in 1.7.0; this closes the
  asymmetry.

  `db:seed` now wraps the whole run. Nesting is safe — `DB.transaction` opens a `SAVEPOINT` when one
  is already open, so an inner `call()` still rolls back independently. The wrapper is skipped when
  no connection is bound, because a seeder is not obliged to touch the database and an app that has
  not configured one should not fail to seed over a transaction it never needed.

- **`DatabaseProvider` now runs in `worker`, so `zt queue:work` can boot.** It did not, and the
  consequence was total rather than partial: `QueueProvider` _does_ run in `worker`, the
  queue's own default driver is `sqlite`, and so the worker asked for a connection this
  provider had not made and died on startup —

  ```
  error: [Zerotal ORM] No database connection. Is DatabaseProvider registered?
  ```

  — while it plainly was registered.

  It was never only the queue. Nine providers run in `worker` — notifications, audit, media,
  tenancy, scheduler among them — and a job exists to do work with models. `AuthProvider` and
  `SessionProvider` are absent from `worker` correctly, having neither a request nor a
  session; the ORM being absent was an oversight, dating to 1.0.2.

  Found building the first cookbook app, whose first queued job could not run.

## [1.7.1] — 2026-08-16

### Fixed

- **Relation keys now accept the JS spelling, like every other identifier.** The convention is
  camelCase in the application and snake_case in the database, converted on the way through —
  and relation keys were the one place it did not happen. `@hasMany(() => Issue, { foreignKey:
"projectId" })` type-checked and then emitted `no such column: issues.projectId`, with the
  error naming a column rather than the relation that produced it.

  `_relationSubquery()` builds its subquery with a plain `QueryBuilder`, and the `_column()`
  hook that converts is an override on `ModelQueryBuilder`, so nothing was converting these.
  The keys are now converted where they are qualified, which covers `withCount`, `withSum`,
  `has`/`whereHas` and `withExists` for `hasMany`, `belongsTo`, `manyToMany` and the morph
  relations. Both spellings resolve to the column, so apps already passing `project_id` are
  unaffected.

  Found building the first cookbook app, where a project list would not count its issues.

## [1.7.0] — 2026-08-16

### Fixed

- **Migrations are now actually transactional.** The runner wrapped each `up()` in
  `begin()` and the docblock promised all-or-nothing, but the wrapper governed nothing:
  `Schema` resolved the _global_ connection, so the migration's DDL ran on a pooled
  connection and committed independently of the transaction around it. On PostgreSQL a
  migration that failed on its third statement left the first two behind, and the enclosing
  `ROLLBACK` had nothing to undo.

  Three changes close it. `Schema` resolves the enclosing transaction when there is one
  (new `_getScopedDbConnection`), so DDL issued inside `DB.transaction()` joins it —
  migrations included. The tracking-table insert moved _inside_ the transaction, because
  recording after the commit leaves a window where the schema has moved and nothing says so,
  and the next deploy re-runs the migration against a schema it already changed. And
  rollback got the same treatment: a `down()` that fails part-way now undoes nothing rather
  than leaving the schema and the tracking table disagreeing.

  This was invisible to the test suite by construction — `new SQL(":memory:")` is a single
  handle, so the "global" and transaction connections are the same object and DDL joined the
  transaction by accident. The new tests use a fake that keeps them distinguishable.

### Added

- **`MigrationRunner.willRollBackOnFailure`** and `SqlDialect.supportsTransactionalDdl`.
  MySQL and MariaDB implicitly commit on every DDL statement, so a transaction around a
  migration there is a promise that cannot be kept — the runner no longer opens one, and
  `bun zt migrate` warns before it starts rather than after something breaks. PostgreSQL
  and SQLite report `true`.

- **Two DevTools tabs the ORM already had the data for.** `ModelChanged`,
  `TransactionCommitted` and `TransactionRolledBack` were on the framework event bus and went
  nowhere: a request that wrote four rows and one that wrote none looked identical in the
  panel, and a transaction that rolled back showed only as queries that appeared to succeed.

  The observability bridge now declares a **Models** channel (grouped per model) and a
  **Transactions** channel (marking a rollback as a warning, with its reason). Both are
  declared as data, so DevTools ships no ORM-specific code — and both are skipped entirely
  when DevTools is not installed, as every other bridge here is.

## [1.6.0] — 2026-08-15

### Fixed

- **Auto-`synchronize` was never hard-off in production.** The guard compared
  `APP_ENV` against `"production"`, but `setAppEnv()` replaces that with the runtime
  mode before the app boots — so it read `"web"` and never fired. The only thing standing
  between a production database and boot-time schema sync was the config default in
  `config/database.ts`. It reads `deployEnv()` now, and covers `staging` too.

- **`forceState()` did not refuse to run in production.** Its throw exists so a
  state-machine escape hatch cannot be used on live data; the same `APP_ENV` comparison
  meant it never triggered.

- **The N+1 detector's own environment gate never matched**, so the detector returned early
  even in development. (The provider-level gate that installs it was fixed in 1.5.0; this is
  the second gate inside the detector itself.)

## [1.5.0] — 2026-08-15

### Fixed

- **N+1 detection was running in production.** The gate read `Bun.env.APP_ENV`, which
  by the time a provider boots holds the runtime mode (`web`) rather than the
  deployment name — `setAppEnv()` overwrote it. So the check that exists to help in
  development was wrapping every query on live apps, to warn about something nobody
  was there to read. It now asks `deployEnv()`, which is what the deployment name
  survives in.

### Added

- **A missing table now offers to run the migration that would create it.**
  When a query fails because a table or column does not exist, the development
  error page reports which migrations have not run and offers to run them.
  Detection is by driver error code where there is one — `42P01` / `42703` on
  PostgreSQL, `1146` / `1054` on MySQL — and by message on SQLite, which has
  none worth branching on.

  **The half that matters is when it does _not_ offer the button.** With nothing
  pending, running every migration changes nothing and leaves the developer back
  where they started, so instead it says whether any migration on disk even
  mentions the missing name — if none does, the migration was probably never
  written, which is a different problem with a different fix.

  The endpoint behind the button carries three guards, each checked on its own
  rather than inferred from the overlay being dev-only: `devSurfacesEnabled()`
  at request time (which **fails closed** — unlike `!isProdLike()`, an unset
  `APP_ENV` does not qualify), a single-use token minted into the page, and the
  same origin check the raw Flow endpoints use, since a raw route sits outside
  CSRF middleware. Outside development the route is never registered at all.

- **`migrate:refresh`** — the same command as `migrate:fresh`, under the name it has
  elsewhere. Nothing otherwise pushes anyone to run their `down()` methods, and a
  rollback nobody has exercised is a rollback that does not work.

- **`--seed` on `migrate` and `migrate:fresh`.** Wiping a database and repopulating it is
  one thought, and it took two commands — `bun zt migrate:fresh && bun zt db:seed` — with
  the second easy to forget and nothing to remind you. The flag closes that:

  ```bash
  bun zt migrate:fresh --seed        # rebuild the schema, then seed it
  bun zt migrate --fresh --seed      # the same thing
  bun zt migrate --seed              # apply pending migrations, then seed
  ```

  `migrate --seed` seeds even when nothing was pending, because topping up an
  already-current dev database is a normal reason to run it.

  A seeding failure is reported but does not fail the command. The migrations above have
  already committed by then, and exiting non-zero would suggest the whole operation needs
  repeating when only the seeders do — so the output says the schema was rebuilt and
  points at `bun zt db:seed` for the retry.

  The seeder-loading logic is now shared with `db:seed` rather than duplicated, so all
  three commands accept the same shapes: a class-based `DatabaseSeeder` (named or default
  export) and the legacy `database/seeders/index.ts` default function.

### Changed

- **The N+1 detector reads the bindings, not just the SQL text.** Grouping by SQL alone
  made a legitimate loop over six months — identical SQL, a different `period` each
  time — indistinguishable from a per-row lookup, so it told you to eager-load a
  relation that does not exist. The warning now says which of the two it found: _same
  SQL, different arguments_ points at eager loading or `whereIn`; _same SQL, same
  arguments_ points at `RequestContext.remember()`, because there is nothing to
  eager-load when the answer never changes. `NPlusOneError.distinctArgs` carries the
  count.

### Fixed

- **A `Date` in a query-builder write is no longer silently discarded.**
  `update({ read_at: new Date() })` bound the `Date` object straight through; SQLite
  dropped it and **reported no error**, so a "mark all as read" feature shipped as a
  latent no-op whose source read correctly. The asymmetry made it easy to write, too —
  `model.save()` applies casts, so the identical value through a model worked. Dates
  and `Carbon` instances are now serialised at the single point every bind passes
  through, dialect-aware (MySQL DATETIME rejects ISO 8601's `T`/`Z`), which covers
  `update`, `insert`, `where` and every builder at once. The comparison path had
  already learned this lesson separately; now there is one place it lives.

- **`foreignId(...).nullable().constrained()` type-checks.** `nullable()` returned
  `ColumnBuilder`, so the chain left `ForeignIdColumnBuilder` and `.constrained()` was
  gone — the form the class's own docblock documents, and the first one anyone reaches
  for, since a nullable foreign key is the commonest kind. The two modifiers now
  preserve the subclass while keeping the `nullability` lock, so
  `.nullable().notNullable()` is still a compile error.

- **SQLite refuses an impossible `dropColumn` before applying anything.** SQLite cannot
  drop a column a foreign key still names, and it says so _after_ every earlier
  statement in the same `Schema.table()` block has run — the difference between a
  migration that did nothing and one that has to be unpicked by hand. A `PRAGMA
foreign_key_list` check now runs first and throws a message naming the column, the
  table it references, and the table-rebuild way out. The rebuild itself is still not
  implemented; this makes its absence safe rather than expensive.

- **Altering a Postgres column no longer silently drops its NOT NULL and DEFAULT.**
  The regexes that split a column definition into `ALTER COLUMN` sub-commands
  carried literal backspace characters (0x08) where `\b` word boundaries were
  meant — invisible in any editor, and impossible for either pattern to match. So
  `table.string("email").notNullable().alter()` emitted `DROP NOT NULL`, and a
  declared default emitted `DROP DEFAULT`, on every alter, regardless of the
  definition. Found by the lint ratchet (`no-control-regex`); the statements are
  now pinned by tests, not just the column name.

## [1.4.0] — 2026-08-10

### Added

- **Encrypted columns.** A column can now hold ciphertext at rest and plaintext on
  the model, keyed by `APP_KEY` with AES-256-GCM. Declare it per-column or as a
  list; the two mean the same thing and resolve to the same cast:

  ```ts
  @column("encrypted", { nullable: true }) idNumber?: string;
  @column("encrypted:json") medical?: MedicalInfo;

  // …the same, spelled out — `encrypted` is a cast, not a storage type:
  @column({ type: "text", nullable: true, cast: "encrypted" }) passportNumber?: string;

  static encryptable = ["idNumber", "passportNumber"];
  ```

  `encrypted` and `encrypted:json` join the `@column("…")` shorthands, resolving
  to `{ type: "text", cast: "encrypted" }` — so the storage type is right without
  having to know that ciphertext outgrows its plaintext.

  Encryption happens on the way to the database rather than to the instance, so —
  unlike `hashable` — it is non-destructive: after `save()` the property still
  holds what you assigned. `$dirty` compares plaintext, so an unchanged column is
  not rewritten with a fresh IV on every unrelated save.

  A column listed in `encryptable` whose `@column({ type })` is `json` encrypts as
  `encrypted:json`, so it round-trips as the structure it was instead of reaching
  the cipher as `"[object Object]"`.

  **`where()` on an encrypted column throws** rather than returning nothing. The
  bind path runs a column's cast over the search value, which would encrypt it
  under a fresh IV and compare it against ciphertext written with a different one:
  zero rows, no error, and a screen reading "no such client" for a client who is
  right there. `EncryptedColumnError` says so and points at a blind index.

  **A value the key cannot open fails the read**, naming the model, the column and
  the two causes (a rotated `APP_KEY`, or plaintext that predates the cast).
  Returning the ciphertext instead would put an unreadable value where the
  application expects a real one — displayed, reported on, or re-encrypted by the
  next save, which destroys the original.

  `migrate:generate` and `synchronize()` widen an encrypted column to TEXT
  whatever it was declared as. A payload is ~1.4× the plaintext plus 28 bytes, and
  MySQL outside strict mode truncates rather than failing — a truncated payload
  never decrypts, so the row would be destroyed silently at write time.

## [1.3.0] — 2026-08-09

### Changed — BREAKING

- **`BaseModelWith(...)` is replaced by the `Model.using(...)` static.** Mixin composition is now
  a property of the base class rather than a helper shipped alongside it, so there is one idiom to
  learn and nothing extra to import.

  ```ts
  // before
  import { BaseModelWith } from "@zerotal/orm";
  class User extends BaseModelWith(Authenticatable, Permissions, Roles) {}

  // after
  import { Model } from "@zerotal/orm";
  class User extends Model.using(Authenticatable, Permissions, Roles) {}
  ```

  Run `bun run scripts/codemod-mixin-composition.ts` to rewrite call sites and imports.

  How mixins are **authored** is unchanged — `<T extends Constructor>(Base: T) => class extends Base`
  still works exactly as before, and every shipped mixin (`SoftDeletes`, `State`, `Authenticatable`,
  `Roles`, `Permissions`, `Notifiable`, `Tenantable`, `Auditable`, …) keeps its signature. The
  `Constructor` and `Mixin` types are still exported; `Compose` (the type of `Model.using`) joins
  them. Mixin authors declaring columns still call `registerColumn` imperatively.

  `with` was deliberately **not** used for this. It is reserved for the eager-load static
  (`User.with("posts")`), the one conspicuous gap in the model's existing query-forwarder family
  (`where`, `whereIn`, `orderBy`, `latest`, `first`, `paginate`, `find`, `all`, `count`, …).

### Changed

- **`Model` is now the canonical name for the base class; `BaseModel` is the alias.** They are the
  same class object and both remain exported, so no code breaks — but `class User extends Model {}`
  is the documented form from here, mirroring Flow's `class PostsPage extends Component {}`.
  `BaseModel` was previously the canonical name and `Model` an unused compat alias added in 1.0.2.

### Added

- **`using` composes onto any class in the chain, not just the root.** An app-level base model can
  now carry mixins without being flattened out of the prototype chain — `AppModel.using(SoftDeletes)`
  keeps `AppModel` and its statics in the lineage. `BaseModelWith` hardcoded `BaseModel`, so this
  previously required hand-nesting.
- **Composition chains.** The composed class carries `using` itself, so
  `Model.using(a, b).using(c, d)` works past the 8-mixin overload set — which is why the overload
  set shrank from 20 hand-written arities to 8 without losing any capability.

## [1.1.0] — 2026-08-08

### Fixed

- **A `json` column returns the type it was given.** Writing skipped `JSON.stringify` for values that were already strings, so a string went into the column as bare characters — `62812345678`, not `"62812345678"` — and the read side's `JSON.parse` turned it back into a number. A `json`-cast setting holding an account number came back as a number, and only for _some_ values, since a string that fails to parse fell through unchanged. Encoding is now symmetric in both directions, and `where()` against a `json` column encodes the same way, so a query finds what a write stores. **Upgrade note:** rows written by an older version hold bare scalars, so a string column may still read back as a number, and a `where()` on a string will not match those older rows — they are stored unquoted. Only affects bare scalars in `json`/`array` columns; objects and arrays were always encoded and are untouched.
- **`bun zt make:model` generates a file that parses.** The stub emitted `@table('posts').withTimestamps()`, which is not valid decorator syntax — the grammar allows a call at the end of the chain, not in the middle — so every generated model failed with `Expected "class" but found "."`. The stub now emits plain `@table('posts')`; timestamps are on by default and the chained form needs outer parentheses, `@(table("x").withoutTimestamps())`. The same broken form is corrected in the `BaseModel` docblocks, and every generated stub is now parsed by a test rather than checked for substrings.
- **A column `default` is applied on insert.** A declared field that was never assigned was written as an explicit `NULL`, so the INSERT named the column, the database never applied its own default, and a `NOT NULL` column failed outright — on a model and migration that both declared `default: 0`. `undefined` now means "I didn't say": the declared default is used, or the column is omitted so the database decides. An explicit `null` still stores `NULL`.
- **A `Date` compared against a timestamp column matches again.** Bound values are serialised through the column's cast metadata, but the framework-managed `created_at` / `updated_at` / `deleted_at` carry no `@column` registration — so a `Date` was bound raw and matched nothing. `where("created_at", ">=", monthStart)` is the commonest reporting query there is, and it silently returned zero rows: a dashboard reading "0 this month" looks like a quiet month, not a broken query.

### Added

- `Schema.alter(...)` as an alias of `Schema.table(...)`, and `table.datetime(...)` as an alias of `table.dateTime(...)`. Both are the names other frameworks use, neither was a type error because the blueprint callback is loosely typed, and both therefore failed as a `TypeError` mid-migration — after earlier statements had already run, leaving the schema half-changed.
- `@column("string", { nullable: true })` — a two-argument form. The shorthand keeps its type and cast; the options cannot contradict them.
- `@column({ unique: true })` and `@column({ index: true })`, carried through to both `migrate:generate` and `synchronize`. Uniqueness is usually a correctness property, and it was not expressible at all.
- Generated migrations index any `*_id` column. The reference cannot always be inferred, but the index can, and an unindexed foreign key is a table scan on every join.
- `"text"` is its own storage type rather than an alias for `"string"`, so a real `TEXT` column is expressible — the distinction matters on Postgres and MySQL.

### Changed

- **`create()` narrows its payload to the mass-assignable columns** when a model declares `fillable` as a literal tuple (`as const`). A required column deliberately kept out of `fillable` was demanded by `InsertPayload` and refused by `fill()` at runtime: the type required exactly what the runtime forbade, and there was no spelling of `create()` that satisfied both. Models without a literal list are unaffected.
- `static fillable` / `static guarded` accept `readonly string[]`.
- A migration that fails with "already exists" now says that `database.synchronize` is the usual cause, since the raw driver error names nothing actionable.
- `make:model` generates `fillable` as a literal tuple and documents that a nullable column is declared `?: T | undefined` — under the scaffold's `exactOptionalPropertyTypes`, `?: T` cannot be assigned `undefined`, so the field could never be cleared.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
