---
title: Queries
description: Read and write model records with a fluent, type-aware query builder.
---

# Queries

The query builder is a fluent, type-aware API over your database tables. This page
covers reading and writing records, the full builder surface, instance methods, and
query scopes — everything you reach for after [defining a model](/docs/orm).

`Model` static methods (`find`, `create`, …) cover the common cases; `Model.query()`
returns a [`ModelQueryBuilder`](#references) for anything more complex. The same
fluent API is available on `DB.table()` for unmodelled tables (see
[Query builder](/docs/query-builder)).

## Basic finders

```typescript
// in a controller or service
// By primary key — returns null if not found
const user = await User.find(1);

// By primary key — throws ModelNotFoundError if not found
const user = await User.findOrFail(1);

// By any column — returns null if not found
const user = await User.findBy("email", "alice@example.com");

// Multiple by IDs
const users = await User.findMany([1, 2, 3]);

// All rows
const users = await User.all();

// First matching row — null if not found
const admin = await User.query().where("role", "admin").first();

// First matching row — throws ModelNotFoundError
const post = await Post.query().where("slug", "hello-world").firstOrFail();

// All matching rows
const admins = await User.query().where("role", "admin").get<User>();
```

> **Note** — `findOrFail`, `firstOrFail`, and `findManyOrFail`-style calls throw
> `ModelNotFoundError` from `@zerotal/orm`, which the HTTP layer renders as a 404.

## Create, update, delete

```typescript
// in a controller or service
// INSERT a single record
const user = await User.create({ name: "Alice", email: "alice@example.com" });

// INSERT multiple records
const posts = await Post.createMany([{ title: "A" }, { title: "B" }]);

// UPDATE via instance
user.name = "Alice Smith";
await user.save();

// Mass UPDATE — all matching rows
await User.query().where("role", "guest").update({ role: "user" });

// Delete a single row
await post.delete();
```

By default `delete()` removes the row permanently. Opt a model into **soft deletes**
by composing the `SoftDeletes` mixin — only then do `delete()` set `deleted_at`,
`forceDelete()`, and `restore()` apply:

```typescript
// app/models/Post.ts
import { Model, SoftDeletes, table, column } from "@zerotal/orm";

@table("posts")
export class Post extends Model.using(SoftDeletes) {
  @column() title!: string;
}
```

```typescript
// in a controller or service
// Soft delete — sets deleted_at; row hidden from default queries
await post.delete();

// Hard delete — bypasses soft deletes, removes the row permanently
await post.forceDelete();

// Restore a soft-deleted row (deleted_at = NULL)
await post.restore();

// Query including soft-deleted rows
await Post.withTrashed().get();

// Only soft-deleted rows
await Post.onlyTrashed().get();
```

> **Warning** — `withTrashed()` and `onlyTrashed()` are **static** methods added by
> the `SoftDeletes` mixin (`Post.withTrashed()`), not chainable off `Post.query()`.
> A plain `Model` has no soft-delete API at all — `delete()` is permanent.

## Upsert

`upsert` inserts a row, or updates the named columns when a conflict on `conflictKeys`
occurs:

```typescript
function upsert(
  data: InsertPayload<T>,
  conflictKeys: (keyof T & string)[],
  updateCols?: (keyof T & string)[],
): Promise<void>;
```

```typescript
// in a controller or service
// Conflict on email → update name and role; omit updateCols to update every column
await User.upsert(
  { email: "alice@example.com", name: "Alice", role: "admin" },
  ["email"], // conflict columns
  ["name", "role"], // columns to update on conflict (optional)
);
```

> **Note** — `upsert` is a `Model` static. For unmodelled tables, perform the
> insert/update explicitly via `DB.table()` — the raw query builder has no `upsert`
> helper.

## Convenience finders

```typescript
// in a controller or service
// Find or create — returns the existing or newly-created instance
const user = await User.firstOrCreate(
  { email: "alice@example.com" }, // search criteria
  { name: "Alice", role: "user" }, // defaults if creating
);

// Update existing, or create if not found
await User.updateOrCreate(
  { email: "alice@example.com" },
  { name: "Alice", lastSeenAt: new Date() },
);

// Build a new (unsaved) instance if not found — does not save automatically
const user = await User.firstOrNew({ email: "alice@example.com" }, { name: "Alice" });
if (!user.id) await user.save();

// Find by PK, build a new (unsaved) instance if not found
const user = await User.findOrNew(1);
```

## Query builder

`Model.query()` returns a `ModelQueryBuilder`. Most methods are also available on
`DB.table()` for unmodelled raw queries — see [Query builder](/docs/query-builder).

### Filtering

```typescript
// in a controller or service
Post.query()
  .where("status", "published")
  .where("views", ">", 100)
  .orWhere("featured", true)
  .whereIn("tag_id", [1, 2, 3])
  .whereNotIn("status", ["draft", "archived"])
  .whereNull("deleted_at")
  .whereNotNull("published_at")
  .whereBetween("views", [100, 1000])
  .whereDate("created_at", "2024-01-01")
  .whereColumn("updated_at", ">", "created_at")
  .whereLike("title", "%zerotal%")
  .whereAny(["title", "body"], "LIKE", "%zerotal%") // match any column
  .whereAll(["title", "body"], "!=", "") // all columns must match
  .whereExists((q) => q.from("comments").whereColumn("comments.post_id", "posts.id"))
  .whereNotExists((q) => /* … */ undefined)
  .whereRaw("LOWER(title) LIKE ?", ["%zerotal%"]);
```

### Selecting

```typescript
// in a controller or service
Post.query().select("id", "title", "slug").get();
Post.query().selectRaw("COUNT(*) as total, MAX(score) as top").get();
Post.query().distinct().select("user_id").get();
```

### Ordering and limits

```typescript
// in a controller or service
Post.query().orderBy("published_at", "desc").orderBy("id", "asc").limit(10).offset(20).get();
```

### Joins

```typescript
// in a controller or service
// Inner join
Post.query()
  .join("users", "posts.user_id", "=", "users.id")
  .select("posts.*", "users.name as authorName")
  .get();

// Left / right / cross joins
Post.query().leftJoin("comments", "posts.id", "=", "comments.post_id").get();
Post.query().rightJoin("users", "posts.user_id", "=", "users.id").get();
Post.query().crossJoin("tags").get();

// Subquery join
Post.query()
  .joinSub(
    DB.table("comments").selectRaw("post_id, COUNT(*) as comment_count").groupBy("post_id"),
    "comment_stats",
    "posts.id",
    "=",
    "comment_stats.post_id",
  )
  .select("posts.*", "comment_stats.comment_count")
  .get();
```

### Grouping and aggregates

```typescript
// in a controller or service
// Terminal aggregates — return a single value
const total = await Post.query().where("status", "published").count();
const views = await Post.query().sum("views");
const avg = await Post.query().avg("score");
const lowest = await Post.query().min("price");
const peak = await Post.query().max("price");

// GROUP BY + HAVING
await DB.table("posts")
  .select("user_id")
  .selectRaw("COUNT(*) as total")
  .groupBy("user_id")
  .having("total", ">", 5)
  .get();
```

### Subquery aggregates on results

Load aggregate values alongside model instances without extra queries:

```typescript
// in a controller or service
const posts = await Post.query()
  .withCount("comments")
  .withCount({ comments: (q) => q.where("approved", true) }) // filtered count
  .withSum("comments", "votes")
  .withAvg("comments", "rating")
  .withMin("comments", "created_at")
  .withMax("comments", "created_at")
  .get();

posts[0].commentsCount; // number
posts[0].commentsSum_votes; // number | null
posts[0].commentsAvg_rating; // number | null
```

### Relation existence filtering

```typescript
// in a controller or service
// Posts that have at least one comment
Post.query().has("comments").get();

// Posts with 3+ comments
Post.query().has("comments", ">=", 3).get();

// Posts with no comments
Post.query().doesntHave("comments").get();

// Posts with at least one approved comment
Post.query()
  .whereHas("comments", (q) => q.where("approved", true))
  .get();

// Posts without any approved comment
Post.query()
  .whereDoesntHave("comments", (q) => q.where("approved", true))
  .get();

// Filter by relation AND eager-load with the same constraint
Post.query()
  .withWhereHas("comments", (q) => q.where("approved", true))
  .get();
```

### Conditional query building

Build queries dynamically based on optional inputs without branching `if` statements:

```typescript
// in a controller
const posts = await Post.query()
  .when(ctx.query("status"), (q, status) => q.where("status", status))
  .when(ctx.query("author"), (q, author) => q.where("user_id", author))
  .when(ctx.query("q"), (q, term) => q.whereLike("title", `%${term}%`))
  .orderBy("created_at", "desc")
  .paginate(20, ctx.query("page", 1));
```

`.when(condition, callback)` only calls the callback when `condition` is truthy,
making it easy to chain optional filters.

### Pessimistic locking

```typescript
// in a controller or service
// Exclusive write lock — SELECT … FOR UPDATE
await DB.transaction(async (trx) => {
  const user = await User.query().where("id", 1).lockForUpdate().first();
  user.balance -= 100;
  await user.save();
});

// Shared read lock — SELECT … LOCK IN SHARE MODE
const post = await Post.query().where("id", postId).sharedLock().first();
```

> **Warning** — Row locks only hold inside a transaction. Call `lockForUpdate()` /
> `sharedLock()` within `DB.transaction()` (see [Database](/docs/database)), or the
> lock is released the moment the statement returns.

## Pagination

### Which pagination should I use?

| Strategy          | Method           | Best for                                                |
| ----------------- | ---------------- | ------------------------------------------------------- |
| Offset (page no.) | `paginate`       | Small/medium tables where users jump to any page        |
| Cursor (last ID)  | `cursorPaginate` | Simple "load more" feeds, stable across inserts         |
| Keyset (indexed)  | `keysetPaginate` | Infinite scroll and large datasets — scales to any size |

### Offset pagination

Classic page-number pagination. Best for small-to-medium tables where users jump to
arbitrary pages:

```typescript
// in a controller
const page = await Post.query()
  .where("status", "published")
  .orderBy("published_at", "desc")
  .paginate(10, pageNumber); // (perPage, page)

// page.data     — Post[]
// page.total    — total row count
// page.page     — current page number
// page.perPage  — rows per page
// page.lastPage — last page number
```

### Cursor pagination

Simple, performant pagination using the last-seen ID as a cursor. Stable against
inserts/deletes between pages:

```typescript
// in a controller
const p1 = await Post.query().cursorPaginate({ limit: 20 });
const p2 = await Post.query().cursorPaginate({ cursor: p1.nextCursor, limit: 20 });

// p1.data       — Post[]
// p1.nextCursor — number | null
```

### Keyset pagination

Scales to any table size. Uses an indexed column value as the cursor instead of an
offset. The best choice for infinite scroll and large datasets:

```typescript
// in a controller
const p1 = await Post.query()
  .where("status", "published")
  .keysetPaginate({ column: "published_at", direction: "desc", limit: 20 });

const p2 = await Post.query()
  .where("status", "published")
  .keysetPaginate({ column: "published_at", direction: "desc", limit: 20, cursor: p1.nextCursor });

// p1.data       — Post[]
// p1.nextCursor — opaque base64 string | null
```

`keysetPaginate` options:

| Option      | Default | Description                                         |
| ----------- | ------- | --------------------------------------------------- |
| `column`    | `'id'`  | The indexed column to paginate by                   |
| `direction` | `'asc'` | `'asc'` or `'desc'`                                 |
| `limit`     | `15`    | Rows per page                                       |
| `cursor`    | —       | Opaque string from the previous page's `nextCursor` |

Non-unique columns automatically get a compound `id` tiebreaker to ensure stable
ordering.

## Chunking and streaming

Use these for large datasets to avoid loading thousands of rows into memory at once:

```typescript
// in a console command or job
// Process in fixed-size batches
await Post.query().chunk(100, async (posts) => {
  for (const post of posts) await index(post);
});

// Chunk by primary key — stable even if rows are inserted/deleted mid-run
await Post.query().chunkById(100, async (posts) => {
  for (const post of posts) await sendEmail(post);
});

// Async generator — pull one row at a time
for await (const post of Post.query().lazy()) {
  await process(post);
}

// cursor() is an alias for lazy()
for await (const post of Post.query().cursor()) {
  await process(post);
}

// Callback per row — simpler than for-await for linear processing
await Post.query().each(async (post) => {
  await process(post);
});
```

## Debugging queries

The builder compiles to SQL without executing, so you can inspect exactly what will
run:

```typescript
// in a controller or service
// Compiled SQL with `?` placeholders (no bindings)
const sql = Post.query().where("status", "published").toSql();
console.log(sql); // SELECT * FROM posts WHERE status = ?

// SQL plus the bound values
const { sql, bindings } = Post.query().where("status", "published").toSqlWithBindings();
console.log(bindings); // ['published']

// SQL with bindings inlined — for logging only, NOT safe to execute
const raw = Post.query().where("status", "published").toRawSql();

// Log the compiled SQL + bindings and keep chaining
Post.query().where("active", 1).dump().get();
```

> **Danger** — `toRawSql()` inlines values into the SQL string and is for logging
> only. Never feed its output back to the database — it bypasses parameterisation
> and is vulnerable to SQL injection.

Clone a base query to reuse it with different conditions:

```typescript
// in a controller or service
const base = Post.query().where("active", 1);
const admins = await base.clone().where("role", "admin").get();
const editors = await base.clone().where("role", "editor").get();
```

## Instance methods

### Loading and refreshing

```typescript
// in a controller or service
// Reload a fresh copy from the database (returns a new instance, doesn't mutate)
const fresh = await post.fresh();

// Reload into the same instance (mutates in place)
await post.refresh();

// Lazy-load relations onto an existing instance
await post.load(["author", "comments"]);

// Load relations only if not already loaded
await post.loadMissing(["author"]);

// Load aggregate values onto an instance
await post.loadCount("comments");
await post.loadCount(["comments", "likes"]);
await post.loadSum("comments", "votes");
await post.loadAvg("comments", "rating");
await post.loadMin("comments", "score");
await post.loadMax("comments", "score");
```

### Dirty tracking

Know which fields have changed since the last database read or save:

```typescript
// in a controller or service
post.name = "Changed";

post.isDirty(); // true — at least one column changed
post.isDirty("name"); // true — specifically "name" changed
post.isDirty("email"); // false — "email" is unchanged

// Force a field dirty even if its value hasn't changed:
post.markDirty("slug");
```

> **Warning** — Dirty means _changed since **this instance** was loaded_, not
> "differs from the database". If another code path updated the row after your
> instance was loaded, assigning the value your instance already holds is not
> dirty — `save()` writes nothing, silently:
>
> ```typescript
> const quote = await Quote.find(id); // status: "DRAFT"
> await markSent(id); //             …loads its own copy, sets status: "SENT"
> quote.status = "DRAFT"; //          matches this instance's value → not dirty
> await quote.save(); //              no UPDATE — the row stays "SENT"
> ```
>
> When an instance may be stale — it crossed a service boundary, or time passed
> since the load — either `await quote.refresh()` before mutating, or
> `quote.markDirty("status")` to force the write. Services that accept an id and
> load their own fresh copy sidestep the problem entirely.

### Incrementing and touch

```typescript
// in a controller or service
await post.increment("views"); // +1
await post.increment("views", 5); // +5
await post.decrement("stock", 2); // -2

// Update updated_at without changing any other field
await post.touch();
```

### Comparison and copying

```typescript
// in a controller or service
// True if both are the same model class with the same primary key
post.is(otherPost); // boolean
post.isNot(otherPost); // boolean

// Duplicate the instance — new unsaved record, no id/timestamps
const copy = post.replicate();
copy.title = "Copy of " + post.title;
await copy.save();

// Exclude specific columns from the replica
const copy = post.replicate(["slug", "viewCount"]);
```

### Saving without updating timestamps

```typescript
// in a controller or service
await User.withoutTimestamps(async () => {
  user.role = "admin";
  await user.save(); // updated_at is NOT changed
});
```

## Query scopes

### Named scopes

Group reusable query constraints on the model itself with `Model.scope`:

```typescript
// app/models/Post.ts
import { Model, table } from "@zerotal/orm";

@table("posts")
export class Post extends Model {
  static published = Model.scope((q) => q.whereNotNull("published_at"));

  static byAuthor = Model.scope((q, userId: number) => q.where("user_id", userId));

  static recent = Model.scope((q, days = 7) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    q.where("created_at", ">", cutoff.toISOString());
  });
}
```

Apply them via `withScopes()`. The callback receives a proxy whose methods invoke each
scope in turn — call them as separate statements (the proxy methods return `void`, so
they do not chain):

```typescript
// in a controller
const posts = await Post.query()
  .withScopes((s) => {
    s.published();
    s.byAuthor(http.user!.id);
    s.recent(30);
  })
  .orderBy("published_at", "desc")
  .paginate(20, 1);
```

### Global scopes

Global scopes are applied automatically to every query on the model. Register them in
a [service provider's](/docs/providers) `onBooting()`:

```typescript
// in AppServiceProvider.onBooting()
Post.addGlobalScope("tenant", (q) => q.where("tenant_id", currentTenantId()));

// Disable for a single query
Post.query().withoutGlobalScope("tenant").get();
Post.query().withoutGlobalScopes().get(); // disable all global scopes

// Remove permanently (until the next boot)
Post.removeGlobalScope("tenant");
```

Child models inherit all global scopes registered on a parent model.

> **Tip** — Global scopes are the backbone of [multi-tenancy](/docs/tenancy): a single
> `tenant` scope keeps every query partitioned without touching call sites.

## References

`Model` statics — the entry points for reads and writes:

| Method              | Signature                                                | Description                                          |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| `find`              | `find(id): Promise<T \| null>`                           | Fetch by primary key, or `null`.                     |
| `findOrFail`        | `findOrFail(id): Promise<T>`                             | Fetch by primary key, or throw `ModelNotFoundError`. |
| `findBy`            | `findBy(column, value): Promise<T \| null>`              | Fetch the first row matching a column.               |
| `findMany`          | `findMany(ids): Promise<T[]>`                            | Fetch multiple rows by primary key.                  |
| `all`               | `all(): Promise<T[]>`                                    | Fetch every row.                                     |
| `create`            | `create(data): Promise<T>`                               | Insert and return the new instance.                  |
| `createMany`        | `createMany(rows): Promise<T[]>`                         | Insert multiple rows.                                |
| `upsert`            | `upsert(data, conflictKeys, updateCols?): Promise<void>` | Insert, or update on conflict.                       |
| `firstOrCreate`     | `firstOrCreate(attrs, defaults?): Promise<T>`            | Find the first match, or insert it.                  |
| `updateOrCreate`    | `updateOrCreate(attrs, values): Promise<T>`              | Update the match, or insert.                         |
| `firstOrNew`        | `firstOrNew(attrs, defaults?): Promise<T>`               | Find, or build an unsaved instance.                  |
| `findOrNew`         | `findOrNew(id): Promise<T>`                              | Find by PK, or build an unsaved instance.            |
| `query`             | `query(): ModelQueryBuilder<T>`                          | Start a fluent query.                                |
| `scope`             | `scope(fn): (...args) => ScopeApplicator`                | Define a reusable named scope.                       |
| `addGlobalScope`    | `addGlobalScope(name, callback): void`                   | Register an always-on scope.                         |
| `removeGlobalScope` | `removeGlobalScope(name): void`                          | Remove a global scope until next boot.               |
| `withoutTimestamps` | `withoutTimestamps(cb): Promise<R>`                      | Run `cb` without touching `updated_at`.              |

`ModelQueryBuilder` / `QueryBuilder` terminals and helpers:

| Method                                  | Signature                                               | Description                               |
| --------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `first`                                 | `first<T>(): Promise<T \| null>`                        | First matching row, or `null`.            |
| `firstOrFail`                           | `firstOrFail(): Promise<M>`                             | First row, or throw `ModelNotFoundError`. |
| `get`                                   | `get<T>(): Promise<T[]>`                                | All matching rows.                        |
| `update`                                | `update(data): Promise<void>`                           | Mass-update matching rows.                |
| `count` / `sum` / `avg` / `min` / `max` | `(column?): Promise<number>`                            | Terminal aggregates.                      |
| `paginate`                              | `paginate(perPage?, page?): Promise<PaginateResult<T>>` | Offset pagination.                        |
| `cursorPaginate`                        | `cursorPaginate(opts?): Promise<…>`                     | ID-cursor pagination.                     |
| `keysetPaginate`                        | `keysetPaginate(opts): Promise<…>`                      | Indexed keyset pagination.                |
| `chunk`                                 | `chunk(size, cb): Promise<void>`                        | Process rows in fixed batches.            |
| `chunkById`                             | `chunkById(size, cb): Promise<void>`                    | Batch by primary key (insert-safe).       |
| `lazy` / `cursor`                       | `lazy(size?): AsyncGenerator<T>`                        | Stream one row at a time.                 |
| `each`                                  | `each(cb): Promise<void>`                               | Callback per row.                         |
| `when`                                  | `when(condition, cb): this`                             | Apply `cb` only when truthy.              |
| `lockForUpdate`                         | `lockForUpdate(): this`                                 | `SELECT … FOR UPDATE` (in a transaction). |
| `sharedLock`                            | `sharedLock(): this`                                    | Shared read lock.                         |
| `withScopes`                            | `withScopes(cb): this`                                  | Apply named scopes.                       |
| `withoutGlobalScope`                    | `withoutGlobalScope(...names): this`                    | Skip named global scopes.                 |
| `toSql`                                 | `toSql(): string`                                       | Compiled SQL with `?` placeholders.       |
| `toSqlWithBindings`                     | `toSqlWithBindings(): { sql, bindings }`                | SQL plus bound values.                    |
| `toRawSql`                              | `toRawSql(): string`                                    | SQL with values inlined (logging only).   |
| `clone`                                 | `clone(): this`                                         | Copy the builder to branch conditions.    |

## Next steps

- [ORM](/docs/orm) — model definition, columns, and configuration.
- [ORM relationships](/docs/orm/relationships) — eager-load and constrain related records.
- [ORM lifecycle](/docs/orm/lifecycle) — model events and observers around save/delete.
- [Pagination](/docs/pagination) — render paginated results in views and APIs.
- [Query builder](/docs/query-builder) — the same fluent API for unmodelled tables.
