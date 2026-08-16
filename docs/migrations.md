---
title: Migrations
description: Version-control your database schema with up/down migration files the ORM applies in order.
---

# Migrations

Migrations are version-controlled database schema changes — the schema half of the
[ORM](/docs/orm) story, evolving the tables your models map to. Each migration is a
class with an `up()` method that applies the change and a `down()` method that reverses it.

Migrations ship inside `@zerotal/orm` and are wired up by its `DatabaseProvider`, so
there is no separate package to install — if you have the ORM, you have migrations.

> **Note** — For querying and transactions at runtime (the raw `DB` layer), see [Database](/docs/database).

## Getting Started

Migrations ship with `@zerotal/orm`. If you have the [database](/docs/database)
set up there is nothing further to install:

```typescript
import { Migration, Schema } from "@zerotal/orm";
```

Run `bun zt migrate` to apply them — see [References](#references) for the full
command set.

## Creating a migration

```bash
# in your project root
bun zt make:migration create_posts_table
```

Files are numbered in creation order, so this writes
`database/migrations/001_create_posts_table.ts` (the next file becomes `002_…`):

```typescript
// database/migrations/001_create_posts_table.ts
import { Migration, Schema } from "@zerotal/orm";

export default class CreatePostsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.integer("user_id").index();
      table.string("title");
      table.string("slug").unique();
      table.text("body");
      table.dateTime("published_at").nullable();
      table.softDeletes();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("posts");
  }
}
```

`Migration` is an abstract class with two abstract methods — `up()` and `down()`,
both returning `Promise<void>`. The default export of every migration file must
extend it.

## Running migrations

```bash
# in your project root
# Run all pending migrations
bun zt migrate

# Drop all tables and re-run every migration from scratch
bun zt migrate --fresh

# Roll back the most recent batch
bun zt migrate:rollback

# Show which migrations have run (name | ran | batch | ranAt)
bun zt migrate:status
```

`migrate --fresh`, `migrate:fresh` and `migrate:refresh` all do the same thing:
roll everything back through each migration's `down()`, then re-run from scratch.
`migrate:refresh` exists because that is the name the command has elsewhere,
and a command you reach for and don't find is a `down()` you never exercise.

Add `--seed` to repopulate afterwards, which is usually why the database was wiped
in the first place:

```bash
bun zt migrate:fresh --seed        # rebuild the schema, then run the seeders
bun zt migrate --fresh --seed      # the same thing
bun zt migrate --seed              # apply pending migrations, then seed
```

`--seed` runs the same seeders as `bun zt db:seed`. If seeding fails, the command
says so but does not fail: the migrations above already committed, and reporting
otherwise would suggest they need repeating when only the seeders do — fix the
seeder and run `bun zt db:seed`.

Migrations run in filename order. The `make:migration` numeric prefix keeps them
ordered automatically (`001_…`, `002_…`); see [Migration file naming](#migration-file-naming).

> **Warning** — `migrate --fresh` and `migrate:fresh` **drop every table** before
> re-running. Never run them against a database whose data you care about.

### Which command do I use?

- **`migrate`** — day-to-day: apply the migrations that haven't run yet.
- **`migrate --fresh` / `migrate:fresh` / `migrate:refresh`** — local resets: throw the
  schema away and rebuild it. Destroys all data. Because they run every `down()` on the
  way, they are also the cheapest way to find out that a rollback is broken.
- **`migrate:rollback`** — undo the last batch you ran (calls each migration's `down()`).
- **`migrate:status`** — inspect what has and hasn't run before deciding.

### What happens when a migration fails

On **PostgreSQL and SQLite**, each migration and its tracking-table row are written in one
transaction. A migration that throws half way leaves nothing behind — not the tables it
managed to create, and not a record claiming it ran. Fix the file and run `migrate` again;
the schema is exactly as it was. Migrations that committed before the failure stay
committed, so a retry only has the failure left to deal with.

This is what makes [`zt deploy:<env>`](/docs/deployment) safe to interrupt: the only two
states a deploy can be caught in are _not applied_ and _applied and recorded_.

> **Warning** — **MySQL and MariaDB have no transactional DDL.** Every DDL statement
> implicitly commits, so a migration that fails on its third `ALTER` leaves the first two
> applied and cannot be rolled back — the engine has nothing left to undo. `bun zt migrate`
> says so before it starts. Keep migrations small so a failure is easy to unpick by hand,
> and take a backup before running them against production.

Rollback carries the same guarantee in reverse: a `down()` that fails part-way undoes
nothing and keeps the migration recorded as applied, rather than leaving the schema and the
tracking table disagreeing.

## Auto-generating from models

Zerotal can diff your `@column()` declarations against the live schema and generate
a migration for the difference. Pass a name for the file it writes:

```bash
# in your project root
bun zt migrate:generate add_published_at
```

The command loads your model files (default glob `app/Models/**/*.ts`), compares each
model's columns against the database, and writes one migration containing the new
tables and added columns it found. Point it at a different location with `--models`:

```bash
# in your project root
bun zt migrate:generate add_published_at --models "src/models/**/*.ts"
```

> **Note** — `migrate:generate` only emits **additive** changes (new tables, new
> columns). It does not generate drops or column-type changes — author those by hand.

## Auto-migration

For local development and tests you can skip migration files entirely and have Zerotal
sync the schema additively at boot — create missing tables and add missing columns to
match your models (TypeORM-style). This is configured in `config/database.ts` via the
`synchronize` field:

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";
import { env } from "zerotal";

export default DatabaseConfig({
  driver: "sqlite",
  url: env("DATABASE_URL", "./database/db.sqlite"), // raw path — no sqlite:// prefix
  synchronize: env("APP_ENV") !== "production", // local/test only
});
```

> **Note** — For SQLite, pass a raw file path (or `:memory:`) as `url` — the
> `sqlite://` protocol prefix is not required and the docstring on `DatabaseConfig`
> advises against it. The provider normalises the URL internally.

It is **opt-in** (off unless enabled), **additive only by default** (creates missing
tables, adds missing columns — never drops), and **hard-off in production** regardless
of the value, where you run `migrate` with generated files.

### Disruptive sync

Additive sync leaves columns in place even after you delete them from a model, so your
database accumulates orphaned columns over time. To let Zerotal also **drop** columns that
no model declares anymore, opt in explicitly with the object form:

```typescript
// config/database.ts
export default DatabaseConfig({
  url: env("DATABASE_URL", "./database/db.sqlite"),
  synchronize: { enabled: true, disruptive: true },
});
```

`synchronize` accepts a boolean or an object:

| Value                                  | Effect                                             |
| -------------------------------------- | -------------------------------------------------- |
| `false` _(default)_                    | No sync.                                           |
| `true`                                 | Additive: create tables, add columns. Never drops. |
| `{ enabled: true, disruptive: false }` | Same as `true`, written explicitly.                |
| `{ enabled: true, disruptive: true }`  | Additive **plus** drops columns no model declares. |

> **Danger** — Disruptive sync **destroys the data** in any column it drops and logs a
> warning before each drop. The primary key is never dropped. Keep `disruptive: true` to
> local and test environments — production is hard-off regardless.

See [Conventions](/docs/conventions#auto-migration) for how the
boot-time sync is wired in.

## Schema API

`Schema` is an object of `async` helpers that compile and run DDL against the current
connection. Call them from inside `up()` / `down()`.

### Creating tables

```typescript
// inside a migration's up()
await Schema.create("users", (table) => {
  table.increments("id"); // INTEGER PRIMARY KEY AUTOINCREMENT
  table.string("name");
  table.string("email").unique();
  table.string("password");
  table.timestamps(); // created_at + updated_at (nullable TEXT)
});

// Idempotent — no error if table already exists
await Schema.createIfNotExists("settings", (table) => {
  table.string("key").primary();
  table.text("value").nullable();
});
```

> **Warning** — `Schema.create()` throws if the table already exists. Use
> `createIfNotExists()` when a migration may run more than once.

### Modifying tables

```typescript
// inside a migration's up()
await Schema.table("users", (table) => {
  table.string("role").default("user"); // ADD COLUMN
  table.boolean("email_verified").default(false);
  table.dropColumn("legacy_field"); // DROP COLUMN
  table.renameColumn("bio", "biography"); // RENAME COLUMN
  table.index(["role", "created_at"], "idx_role_created");
});
```

### Other Schema methods

```typescript
// inside a migration
await Schema.drop("users");
await Schema.dropIfExists("temp_table");
await Schema.rename("old_name", "new_name");

// Introspection
const exists = await Schema.hasTable("users");
const hasCol = await Schema.hasColumn("users", "email");
```

## Blueprint column types

The `t` argument to `create()` / `table()` is a `Blueprint`. Each method below adds a
column; SQL types reflect the SQLite mappings (other drivers use their native types).

| Method                                       | SQL type                | Notes                             |
| -------------------------------------------- | ----------------------- | --------------------------------- |
| `id(name?)`                                  | INTEGER PK AUTOINCR     | Alias for `increments()`          |
| `increments(name?)`                          | INTEGER PK AUTOINCR     |                                   |
| `bigIncrements(name?)`                       | INTEGER PK AUTOINCR     |                                   |
| `integer(name)`                              | INTEGER                 |                                   |
| `bigInteger(name)`                           | INTEGER                 |                                   |
| `tinyInteger / smallInteger / mediumInteger` | INTEGER                 |                                   |
| `unsignedInteger(name)`                      | INTEGER                 | Marked unsigned (tracked only)    |
| `unsignedBigInteger(name)`                   | INTEGER                 | Marked unsigned (tracked only)    |
| `float(name)`                                | REAL                    |                                   |
| `double(name, precision?, scale?)`           | REAL                    |                                   |
| `decimal(name, precision?, scale?)`          | REAL                    |                                   |
| `boolean(name)`                              | INTEGER                 | 0/1                               |
| `string(name, length?)`                      | TEXT                    | `length` ignored on SQLite        |
| `char(name, length?)`                        | TEXT                    |                                   |
| `text(name)`                                 | TEXT                    |                                   |
| `tinyText / mediumText / longText`           | TEXT                    |                                   |
| `uuid(name)`                                 | TEXT                    | 36-char UUID                      |
| `ulid(name)`                                 | TEXT                    | 26-char ULID                      |
| `dateTime(name)`                             | TEXT                    | ISO 8601                          |
| `timestamp(name)`                            | TEXT                    | Alias for `dateTime`              |
| `date(name)`                                 | TEXT                    |                                   |
| `time(name)`                                 | TEXT                    |                                   |
| `year(name)`                                 | INTEGER                 |                                   |
| `binary(name)`                               | BLOB                    |                                   |
| `json(name)`                                 | TEXT                    | Serialised JSON                   |
| `enum(name, values[])`                       | TEXT + CHECK constraint |                                   |
| `set(name, values[])`                        | TEXT                    | MySQL `SET`; plain TEXT on SQLite |
| `ipAddress(name)` / `macAddress(name)`       | TEXT                    |                                   |
| `foreignId(name)`                            | INTEGER                 | See [Foreign keys](#foreign-keys) |
| `foreignUuid(name)`                          | TEXT                    |                                   |

## Column modifiers

Chain modifiers on any column:

```typescript
// inside a Blueprint callback
t.string("bio").nullable();
t.string("role").default("user");
t.string("slug").unique();
t.integer("views").default(0);
t.dateTime("published_at").nullable().useCurrent();
```

| Modifier                                | Effect                                            |
| --------------------------------------- | ------------------------------------------------- |
| `.nullable()`                           | Allow NULL                                        |
| `.notNullable()`                        | Enforce NOT NULL                                  |
| `.default(value)` / `.defaultTo(value)` | Set DEFAULT clause                                |
| `.useCurrent()`                         | DEFAULT CURRENT_TIMESTAMP                         |
| `.unique()`                             | Unique index on this column                       |
| `.index()`                              | Non-unique index                                  |
| `.unsigned()`                           | Mark as unsigned (tracked; no SQLite type change) |
| `.primary()`                            | Set as primary key                                |
| `.check(expr)`                          | Add a `CHECK (expression)` constraint             |

> **Note** — Each modifier locks at the type level: re-applying the same one (or its
> partner, like `.nullable()` after `.notNullable()`) is a compile-time error.

## Indexes

```typescript
// inside a migration's up()
await Schema.create("posts", (table) => {
  table.increments("id");
  table.integer("user_id");
  table.string("slug");
  table.dateTime("published_at").nullable();

  // Single-column index
  table.index("user_id");

  // Multi-column index
  table.index(["published_at", "slug"], "idx_posts_pub_slug");

  // Unique constraint
  table.unique("slug");

  // Full-text index (plain index on SQLite)
  table.fulltext(["title", "body"], "ft_posts");

  // Composite primary key
  table.primary(["post_id", "tag_id"]);
});
```

## Foreign keys

```typescript
// inside a migration's up()
await Schema.create("comments", (table) => {
  table.increments("id");
  table.integer("user_id").index();
  table.integer("post_id").index();

  // Fluent foreign key definition
  table.foreign("user_id").references("id").on("users");
  table.foreign("post_id").references("id").on("posts").onDelete("CASCADE");
});
```

`foreignId()` is shorthand for an unsigned integer column; chain `.constrained()` to
add the foreign-key constraint, inferring the referenced table from the column name:

```typescript
// inside a Blueprint callback
t.foreignId("user_id").constrained(); // references users.id
t.foreignId("post_id").constrained("posts"); // explicit table
t.foreignId("author_id").references("id").on("users").onDelete("CASCADE");
```

The `onDelete` / `onUpdate` actions are `"CASCADE"`, `"SET NULL"`, `"RESTRICT"`, or
`"NO ACTION"`. Shorthands `cascadeOnDelete()`, `nullOnDelete()`, and `restrictOnDelete()`
read more fluently.

## Soft deletes

```typescript
// inside a Blueprint callback
t.softDeletes(); // adds nullable deleted_at TEXT column
t.softDeletes("removed_at"); // custom column name
```

Compose `SoftDeletes` into a model (`Model.using(SoftDeletes)`) and rows with a
non-null `deleted_at` are excluded from queries automatically.

## Pivot / join tables

```typescript
// inside a migration's up()
await Schema.create("post_tags", (table) => {
  table.integer("post_id");
  table.integer("tag_id");
  table.primary(["post_id", "tag_id"]);
  table.foreign("post_id").references("id").on("posts").onDelete("CASCADE");
  table.foreign("tag_id").references("id").on("tags").onDelete("CASCADE");
});
```

## Conditional changes

Check schema state before making changes to keep migrations idempotent:

```typescript
// inside a migration
async up(): Promise<void> {
  if (await Schema.hasColumn("users", "role")) return;

  await Schema.table("users", (table) => {
    table.string("role").default("user");
  });
}
```

## Migration file naming

Files in `database/migrations/` are loaded in alphabetical order. `make:migration`
writes a zero-padded numeric prefix so order is preserved as you add files:

```
001_create_users_table.ts
002_create_posts_table.ts
003_add_role_to_users_table.ts
```

Timestamp-prefixed names (`2024_01_15_120000_create_users.ts`) also sort correctly if
you prefer them.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Migrations get
tested twice over, and only one of those is deliberate.

**Every suite already tests `up()`.** `refreshDatabase()` runs your migrations
before the suite, so a migration that throws fails everything loudly. That is
free coverage, and it is why a broken migration rarely reaches production.

**Almost nobody tests `down()`**, which is why rollbacks fail at the worst
moment. A migration is only reversible if you have run it backwards at least
once:

```typescript
// tests/migrations/AddArchivedToPosts.test.ts
import { test, expect } from "bun:test";
import { Schema } from "@zerotal/orm";
import AddArchivedToPosts from "../../database/migrations/0004_add_archived_to_posts.ts";

test("the migration reverses cleanly", async () => {
  const migration = new AddArchivedToPosts();

  await migration.up();
  expect(await Schema.hasColumn("posts", "archived_at")).toBe(true);

  await migration.down();
  expect(await Schema.hasColumn("posts", "archived_at")).toBe(false);
});
```

Run it twice in the same test if the migration is meant to be idempotent — the
second `up()` should either succeed or fail for a reason you have chosen.

**A data migration deserves a real test**, because it is the only kind whose
mistakes are unrecoverable. Arrange rows in the old shape, run the migration,
assert the new shape:

```typescript
// tests/migrations/BackfillSlugs.test.ts
test("backfills a slug for every existing post", async () => {
  await DB.table("posts").insert({ title: "Hello World", slug: null });

  await new BackfillSlugs().up();

  await assertDatabaseHas("posts", { slug: "hello-world" });
});
```

> **Warning** — Test the migration class directly, not through
> `bun zt migrate`. Shelling out to the CLI runs against your development
> database, not the suite's.

## References

### Migration commands

| Command                                     | Description                                                   |
| ------------------------------------------- | ------------------------------------------------------------- |
| `make:migration <name>`                     | Scaffold a numbered migration file in `database/migrations/`. |
| `migrate [--fresh]`                         | Run pending migrations; `--fresh` drops all tables first.     |
| `migrate:fresh`                             | Roll everything back, then re-run from scratch.               |
| `migrate:rollback`                          | Roll back the most recent batch (runs each `down()`).         |
| `migrate:status`                            | Show each migration's ran / batch / ranAt state.              |
| `migrate:generate <name> [--models <glob>]` | Diff models against the DB and write an additive migration.   |

### Schema methods

| Method              | Signature                                                          | Description                           |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `create`            | `create(table: string, cb: (t: Blueprint) => void): Promise<void>` | Create a table (throws if it exists). |
| `createIfNotExists` | `createIfNotExists(table: string, cb): Promise<void>`              | Create a table only if absent.        |
| `table`             | `table(name: string, cb: (t: Blueprint) => void): Promise<void>`   | Alter an existing table.              |
| `drop`              | `drop(table: string): Promise<void>`                               | Drop a table (throws if absent).      |
| `dropIfExists`      | `dropIfExists(table: string): Promise<void>`                       | Drop a table only if present.         |
| `rename`            | `rename(from: string, to: string): Promise<void>`                  | Rename a table.                       |
| `hasTable`          | `hasTable(table: string): Promise<boolean>`                        | Whether a table exists.               |
| `hasColumn`         | `hasColumn(table: string, column: string): Promise<boolean>`       | Whether a column exists.              |

## Next steps

- [ORM](/docs/orm) — the models your migrations build tables for.
- [Seeding](/docs/seeding) — populate tables with factory data.
- [Database](/docs/database) — raw SQL, transactions, and connections.
- [Query builder](/docs/query-builder) — query the tables you create.
