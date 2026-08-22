---
title: Query Builder
description: Build parameterized SQL with a fluent, model-free chain that runs only when you call a terminal method.
---

# Query Builder

The query builder is Zerotal's fluent, model-free interface for building SQL. You
get one by calling `DB.table(name)` — every clause method returns the builder, so
calls chain, and nothing runs until you call a terminal like `get()`, `first()`,
or `count()`. Values are always parameterized, never interpolated.

```typescript
// in a controller or service
import { DB } from "@zerotal/orm";

const builder = DB.table("posts"); // a QueryBuilder bound to the "posts" table
```

> **Note** — The same builder powers the [ORM](/docs/orm/queries) — `Model.query()`
> returns a `ModelQueryBuilder` that adds relations, casts, and model hydration on top
> of everything here. For transactions, raw SQL, replicas, and N+1 detection, see
> [Database](/docs/database).

## Getting Started

The query builder ships with `@zerotal/orm`. If you have the
[database](/docs/database) set up there is nothing further to install:

```typescript
import { DB } from "@zerotal/orm";
```

## When to reach for it

The query builder sits between two neighbours, and picking the right one keeps your
code both safe and readable:

- **Use a model (`Post.query()`)** when you're working with a table that has a model
  and you want relations, casts, accessors, or hydrated instances back. This is the
  default for domain logic — you get typed records and lifecycle hooks.
- **Use the query builder (`DB.table()`)** for tables without a model (pivot tables,
  reporting views, ad-hoc joins), for bulk writes where you don't need model events,
  and for read-heavy aggregate or analytics queries where hydrating models is wasted
  work. It returns plain rows, so it's lighter.
- **Drop to raw SQL** (`whereRaw`, `selectRaw`, or `DB.raw` — see
  [Database](/docs/database)) only for the slice a clause method can't express. Keep
  the rest of the query fluent so you don't lose parameterization.

Because nothing executes until a terminal method, you can build a query up across
several lines, branches, or helper functions and pass the builder around freely — it's
just a description of a query until you `await` it.

## Selecting columns

```typescript fragment
// in a controller or service
DB.table("posts").select("id", "title", "created_at");
DB.table("posts").distinct().select("status");
```

With no `select()`, all columns (`*`) are returned. For computed columns use
`selectRaw("price * quantity AS revenue")` — the expression is injected verbatim,
so build it only from trusted constants.

## Where clauses

```typescript fragment
// in a controller or service
DB.table("posts").where("status", "published"); // column = value
DB.table("posts").where("views", ">", 1000); // explicit operator
DB.table("posts").where("title", "like", "%bun%");

DB.table("posts").where("status", "published").orWhere("featured", true); // OR

DB.table("users").whereIn("id", [1, 2, 3]);
DB.table("users").whereNotIn("role", ["banned", "guest"]);
DB.table("posts").whereNull("deleted_at");
DB.table("posts").whereNotNull("published_at");
DB.table("posts").whereBetween("views", [100, 1000]);
DB.table("posts").whereLike("title", "%release%");
DB.table("users").whereJson("preferences->theme", "dark"); // JSON column path
```

| Method                                             | SQL                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `where(col, value)`                                | `col = ?`                                                                |
| `where(col, op, value)`                            | `col <op> ?`                                                             |
| `orWhere(...)`                                     | `OR …`                                                                   |
| `whereIn(col, values)` / `whereNotIn(col, values)` | `col IN (…)` / `NOT IN`                                                  |
| `whereNull(col)` / `whereNotNull(col)`             | `col IS NULL` / `IS NOT NULL`                                            |
| `whereBetween(col, [a, b])`                        | `col BETWEEN ? AND ?`                                                    |
| `whereLike(col, pattern)`                          | `col LIKE ?`                                                             |
| `whereColumn(a, op, b)`                            | `a <op> b` — compare two columns                                         |
| `whereJson(col, value)`                            | match a JSON column (see [Database](/docs/database#json-column-queries)) |

Most filters have an `orX` partner (`orWhereIn`, `orWhereNull`, `orWhereLike`, …)
that joins with `OR` instead of `AND`, plus date helpers (`whereDate`, `whereMonth`,
`whereYear`) and subquery filters (`whereExists`, `whereNotExists`). For anything the
fluent methods don't cover, drop to `whereRaw(sql, bindings)` — bindings keep it
parameterized.

> **Warning** — `whereBetween`, `whereLike`, `whereColumn`, and `whereJson` validate
> the column name as a SQL identifier and throw on anything outside
> `[a-zA-Z_][a-zA-Z0-9_.]*`. Never pass a user-controlled string as a column name.

## Joins

```typescript fragment
// in a controller or service
DB.table("posts")
  .join("users", "posts.user_id", "=", "users.id")
  .leftJoin("comments", "comments.post_id", "=", "posts.id")
  .select("posts.title", "users.name");

DB.table("a").crossJoin("b");
```

`join`, `leftJoin`, and `rightJoin` take `(table, first, operator, second)`;
`crossJoin` takes just the table. To join a derived table, use `joinSub(builder,
alias, first, operator, second)`.

## Ordering, grouping, limits

```typescript fragment
// in a controller or service
DB.table("posts").orderBy("created_at", "desc");
DB.table("posts").orderByDesc("created_at"); // shorthand for the line above
DB.table("posts").latest(); // orderBy("created_at", "desc")
DB.table("posts").oldest(); // orderBy("created_at", "asc")
DB.table("posts").oldest("published_at");
DB.table("posts").inRandomOrder(); // RANDOM() / RAND()

DB.table("posts").groupBy("user_id").having("post_count", ">", 5);

DB.table("posts").limit(10).offset(20);
```

`latest()` / `oldest()` default to the `created_at` column; pass a column name to
order by something else. `reorder(col?, dir?)` clears all existing `ORDER BY`
clauses and optionally applies a fresh one.

## Conditional clauses — when

Apply clauses only when a condition is truthy — handy for optional filters without
breaking the chain:

```typescript fragment
// in a controller or service
DB.table("posts")
  .when(status, (q, value) => q.where("status", value))
  .when(search, (q, value) => q.whereLike("title", `%${value}%`))
  .orderBy("created_at", "desc");
```

The callback receives the builder and the (truthy) condition value.

## Retrieving results

```typescript fragment
// in a controller or service
const rows = await DB.table("posts").where("status", "published").get();
const row = await DB.table("posts").where("id", 1).first(); // first row or null

const title = await DB.table("posts").where("id", 1).value("title"); // single column
const ids = await DB.table("posts").pluck("id"); // column → array
const map = await DB.table("posts").pluck("title", "id"); // keyed by a column

const has = await DB.table("posts").where("user_id", userId).exists(); // boolean
```

Pass a row type to `get<T>()` / `first<T>()` for typed results:

```typescript fragment
// in a controller or service
const rows = await DB.table("posts").get<{ id: number; title: string }>();
```

> **Tip** — `sole<T>()` returns the one matching row and throws if zero or more than
> one row matches — a guard against accidentally acting on the wrong record.

### Aggregates

```typescript fragment
// in a controller or service
await DB.table("posts").count();
await DB.table("posts").where("status", "published").sum("views");
await DB.table("posts").avg("rating");
await DB.table("posts").min("created_at");
await DB.table("posts").max("views");
```

For paged result sets, see [Pagination](/docs/pagination).

## Streaming large tables

For result sets too large to hold in memory, page through them instead of calling
`get()`:

```typescript fragment
// in a command or job
await DB.table("posts").chunk(500, async (rows, page) => {
  for (const row of rows) await archive(row);
  // return false to stop early
});

for await (const row of DB.table("posts").lazy()) {
  await process(row); // one row at a time
}
```

> **Tip** — Prefer `chunkById()` / `lazyById()` when rows may be inserted or deleted
> during iteration: they page by an incrementing key instead of `OFFSET`, so they
> never skip or repeat a row.

## Writing rows

```typescript fragment
// in a controller or service
// INSERT
await DB.table("post_tags").insert({ post_id: 1, tag_id: 3 });

// UPDATE — scope with where() first
await DB.table("posts").where("id", 1).update({ status: "published" });

// DELETE
await DB.table("sessions").where("user_id", userId).delete();

// Atomic counters
await DB.table("posts").where("id", 1).increment("views"); // +1
await DB.table("posts").where("id", 1).increment("views", 10); // +10
await DB.table("accounts").where("id", 1).decrement("balance", 100);
```

Use `updateOrInsert(attributes, values)` to update a matching row or insert a merged
one if none exists; it returns `true` when a row was inserted.

> **Danger** — `update()` and `delete()` apply to **every** matching row — always set
> your `where()` constraints first, or you will overwrite or wipe the whole table.

## Locking

Inside a [transaction](/docs/database#transactions), lock the selected rows:

```typescript fragment
// in a controller or service
await DB.transaction(async (trx) => {
  const row = await trx.table("accounts").where("id", 1).lockForUpdate().first();
  // … exclusive lock held until the transaction commits
});
```

| Method            | SQL                            |
| ----------------- | ------------------------------ |
| `lockForUpdate()` | `FOR UPDATE` — exclusive       |
| `sharedLock()`    | `FOR SHARE` — shared read lock |

> **Note** — Row locks are no-ops on SQLite, which has no `FOR UPDATE` / `FOR SHARE`.
> `sharedLock()` emits `LOCK IN SHARE MODE` on MySQL and `FOR SHARE` elsewhere.

## Debugging

```typescript fragment
// in a controller or service
DB.table("posts").where("status", "published").toSql(); // SQL with ? placeholders
DB.table("posts").where("status", "published").toRawSql(); // values inlined (logging only)
DB.table("posts").where("id", 1).dump(); // log SQL + bindings, keep chaining
await DB.table("posts").where("status", "published").explain(); // EXPLAIN / EXPLAIN QUERY PLAN
```

> **Warning** — `toRawSql()` inlines bindings for readability and is **not** safe to
> execute. Use it for logging only — `toSql()` plus `toSqlWithBindings()` give you the
> parameterized form.

## Recipes

A few patterns that come up constantly, shown end to end.

### A filtered, sorted, paginated listing

The bread and butter of any index page or list endpoint. `when()` lets every filter
be optional without a tangle of `if` statements, and `paginate()` returns the rows
plus the page metadata in one call:

```typescript fragment
// in a controller — req.query holds the optional filters
const posts = await DB.table("posts")
  .when(req.query.status, (q, status) => q.where("status", status))
  .when(req.query.search, (q, term) => q.whereLike("title", `%${term}%`))
  .when(req.query.author, (q, id) => q.where("user_id", id))
  .latest() // newest first
  .paginate(20, req.query.page ?? 1);
```

Each `when()` only fires when its value is truthy, so an empty filter is simply
skipped. See [Pagination](/docs/pagination) for the shape of the returned object.

### Idempotent pivot / settings writes

For join tables and key/value rows, `updateOrInsert` avoids the "check then insert"
race — it updates the row matching the first argument, or inserts the two merged if
none exists:

```typescript fragment
await DB.table("user_settings").updateOrInsert(
  { user_id: userId, key: "theme" }, // how to find the row
  { value: "dark" }, // what to set
);
```

### A lightweight report without models

When you only need numbers, skip model hydration entirely and let the database do the
aggregation:

```typescript fragment
const byAuthor = await DB.table("posts")
  .select("user_id")
  .selectRaw("COUNT(*) AS post_count")
  .where("status", "published")
  .groupBy("user_id")
  .having("post_count", ">", 5)
  .orderByDesc("post_count")
  .get<{ user_id: number; post_count: number }>();
```

### Backfilling a large table safely

Never load a big table with `get()`. Page through it with `chunkById`, which walks an
incrementing key so concurrent inserts or deletes can't make it skip or repeat rows:

```typescript fragment
// in a command or job
await DB.table("posts")
  .whereNull("slug")
  .chunkById(500, async (rows) => {
    for (const row of rows) {
      await DB.table("posts")
        .where("id", row.id)
        .update({ slug: slugify(row.title) });
    }
  });
```

### Guarding against the wrong row

When exactly one row should match — looking a user up by email, say — `sole()` turns
"zero or many matches" into a thrown error instead of a silent bug:

```typescript fragment
const user = await DB.table("users").where("email", email).sole();
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). The builder
gives you two ways to test a query, and they answer different questions.

**Assert the SQL when the shape is the point.** `toSql()` returns the statement
with placeholders and `toSqlWithBindings()` adds the values, so a complex
condition can be pinned without touching the database:

```typescript
// tests/queries/ActiveSubscribers.test.ts
import { test, expect } from "bun:test";
import { DB } from "@zerotal/orm";

test("only active, non-trial subscribers are selected", () => {
  const { sql, bindings } = DB.table("users")
    .where("status", "active")
    .whereNull("trial_ends_at")
    .toSqlWithBindings();

  expect(sql).toContain('where "status" = ?');
  expect(sql).toContain('"trial_ends_at" is null');
  expect(bindings).toEqual(["active"]);
});
```

This catches the mistake that matters most in a query builder — a condition
silently dropped by a mis-chained `orWhere` — without needing rows to prove it.

**Assert the rows when the result is the point.** Arrange with factories and run
the query for real:

```typescript fragment
// tests/queries/ActiveSubscribers.test.ts
test("excludes users still in trial", async () => {
  await UserFactory.create({ status: "active", trialEndsAt: null });
  await UserFactory.create({ status: "active", trialEndsAt: new Date() });

  const rows = await DB.table("users").where("status", "active").whereNull("trial_ends_at").get();

  expect(rows).toHaveLength(1);
});
```

> **Warning** — `toRawSql()` inlines the bindings for display. It is for reading
> in a log or a failure message, never for executing: a value with a quote in it
> produces a statement you do not want to run.

## References

### Filtering

| Method                                   | Signature                                         | Description                                    |
| ---------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `where`                                  | `where(col, value)` / `where(col, op, value)`     | `AND` equality or operator clause.             |
| `orWhere`                                | `orWhere(col, value)` / `orWhere(col, op, value)` | Same, joined with `OR`.                        |
| `whereIn` / `whereNotIn`                 | `whereIn(col, values[])`                          | `col IN (…)` / `NOT IN`.                       |
| `whereNull` / `whereNotNull`             | `whereNull(col)`                                  | `IS NULL` / `IS NOT NULL`.                     |
| `whereBetween` / `whereNotBetween`       | `whereBetween(col, [a, b])`                       | Range bounds (inclusive).                      |
| `whereColumn`                            | `whereColumn(a, op?, b)`                          | Compare two columns.                           |
| `whereLike` / `whereNotLike`             | `whereLike(col, pattern)`                         | `LIKE` / `NOT LIKE`.                           |
| `whereDate` / `whereMonth` / `whereYear` | `whereDate(col, op?, value)`                      | Match a date part.                             |
| `whereExists` / `whereNotExists`         | `whereExists((q) => …)`                           | Correlated `EXISTS` subquery.                  |
| `whereJson`                              | `whereJson("col->path", value)`                   | JSON path equality (PostgreSQL/MySQL).         |
| `whereRaw` / `orWhereRaw`                | `whereRaw(sql, bindings[])`                       | Raw clause with parameter bindings.            |
| `when`                                   | `when(condition, (q, value) => …)`                | Apply clauses only when `condition` is truthy. |

### Shaping

| Method                            | Signature                                      | Description                                     |
| --------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `select`                          | `select(...columns)`                           | Choose columns (default `*`).                   |
| `selectRaw`                       | `selectRaw(expression)`                        | Add a raw SELECT expression.                    |
| `distinct`                        | `distinct()`                                   | Emit `SELECT DISTINCT`.                         |
| `join` / `leftJoin` / `rightJoin` | `join(table, first, op, second)`               | Add a join.                                     |
| `crossJoin`                       | `crossJoin(table)`                             | Cartesian join.                                 |
| `joinSub`                         | `joinSub(sub, alias, first, op, second)`       | Join a derived table.                           |
| `union` / `unionAll`              | `union(otherBuilder)`                          | Combine with another query.                     |
| `orderBy` / `orderByDesc`         | `orderBy(col, dir?)`                           | Sort rows.                                      |
| `latest` / `oldest`               | `latest(col = "created_at")`                   | Sort by a timestamp column.                     |
| `inRandomOrder`                   | `inRandomOrder()`                              | Random row order.                               |
| `reorder`                         | `reorder(col?, dir?)`                          | Clear existing `ORDER BY`, optionally re-apply. |
| `groupBy` / `having`              | `groupBy(...cols)` / `having(col, op?, value)` | Group and filter groups.                        |
| `limit` / `offset`                | `limit(n)` / `offset(n)`                       | Slice the result set.                           |

### Terminals

| Method                                     | Signature                           | Description                                         |
| ------------------------------------------ | ----------------------------------- | --------------------------------------------------- |
| `get`                                      | `get<T>(): Promise<T[]>`            | Run the query, return all rows.                     |
| `first`                                    | `first<T>(): Promise<T \| null>`    | First matching row or `null`.                       |
| `sole`                                     | `sole<T>(): Promise<T>`             | The one row; throws on zero or many.                |
| `value`                                    | `value<V>(col): Promise<V \| null>` | Single column of the first row.                     |
| `pluck`                                    | `pluck<V>(col, key?)`               | Array of one column, or object keyed by `key`.      |
| `exists` / `doesntExist`                   | `exists(): Promise<boolean>`        | Whether any row matches.                            |
| `count` / `sum` / `avg` / `min` / `max`    | `count(): Promise<number>`          | Aggregates.                                         |
| `insert`                                   | `insert(data): Promise<void>`       | Insert a row.                                       |
| `update`                                   | `update(data): Promise<void>`       | Update matching rows.                               |
| `updateOrInsert`                           | `updateOrInsert(attrs, values?)`    | Update a match or insert; returns `true` on insert. |
| `delete`                                   | `delete(): Promise<void>`           | Delete matching rows.                               |
| `increment` / `decrement`                  | `increment(col, amount = 1)`        | Atomic counter update.                              |
| `chunk` / `chunkById`                      | `chunk(size, (rows, page) => …)`    | Page through a large table.                         |
| `lazy` / `lazyById` / `cursor` / `each`    | `lazy<T>(size = 1000)`              | Stream rows one at a time.                          |
| `clone`                                    | `clone(): this`                     | Deep-copy the builder (used by pagination).         |
| `toSql` / `toSqlWithBindings` / `toRawSql` | `toSql(): string`                   | Inspect the compiled SQL.                           |
| `dump` / `dd` / `explain`                  | `dump(): this`                      | Log SQL/bindings or run `EXPLAIN`.                  |

## Next steps

- [Database](/docs/database) — transactions, raw SQL, replicas, multiple connections, N+1 detection.
- [Pagination](/docs/pagination) — `paginate()`, `simplePaginate()`, and cursor pagination.
- [ORM Queries](/docs/orm/queries) — the model query builder layered on top of this.
