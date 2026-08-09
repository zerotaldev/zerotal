# Changelog — @zerotal/orm

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.1.0] — 2026-08-08

### Fixed

- **A `json` column returns the type it was given.** Writing skipped `JSON.stringify` for values that were already strings, so a string went into the column as bare characters — `62812345678`, not `"62812345678"` — and the read side's `JSON.parse` turned it back into a number. A `json`-cast setting holding an account number came back as a number, and only for *some* values, since a string that fails to parse fell through unchanged. Encoding is now symmetric in both directions, and `where()` against a `json` column encodes the same way, so a query finds what a write stores. **Upgrade note:** rows written by an older version hold bare scalars, so a string column may still read back as a number, and a `where()` on a string will not match those older rows — they are stored unquoted. Only affects bare scalars in `json`/`array` columns; objects and arrays were always encoded and are untouched.
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
