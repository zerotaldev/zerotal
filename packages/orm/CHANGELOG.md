# Changelog — @zerotal/orm

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
