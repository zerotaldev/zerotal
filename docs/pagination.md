---
title: Pagination
description: Split large query results into pages with the metadata and URL helpers a UI needs.
---

# Pagination

The [query builder](/docs/query-builder) and [ORM](/docs/orm/queries) share four
paginators, each a terminal method on any query. Each returns a result object
carrying the rows plus the metadata, cursors, and URL helpers a UI needs.

| Method                                  | Strategy               | Runs `COUNT`? | Best for                                |
| --------------------------------------- | ---------------------- | ------------- | --------------------------------------- |
| `paginate(perPage, page)`               | Offset + total         | Yes           | Numbered page UIs (1, 2, 3, …)          |
| `simplePaginate(perPage, page)`         | Offset, next/prev only | No            | "Previous / Next" without page numbers  |
| `cursorPaginate({ cursor, limit })`     | Keyset on `id`         | No            | Infinite scroll, very large tables      |
| `keysetPaginate({ column, direction })` | Keyset on any column   | No            | Cursor paging on a sort other than `id` |

> **Note** — This is **data-layer** pagination. For Flow's reactive,
> server-driven paginated components, see
> [Flow › Pagination](/docs/flow/pagination).

## Getting Started

Pagination ships with `@zerotal/orm` as query-builder methods — nothing to
install or register. Call them at the end of any query:

```typescript
const page = await Post.query().latest().paginate();
```

## paginate — full numbered pages

```typescript
// in a controller
const page = await Post.query()
  .where("status", "published")
  .orderBy("created_at", "desc")
  .paginate(15); // reads ?page= from the request

page.data; // Post[] for this page
page.total; // total matching rows
page.lastPage; // total number of pages
```

It runs a `COUNT` (ignoring limit/offset) then fetches the page, so you get a
complete picture — at the cost of the extra count query. `perPage` defaults to 15;
omit `page` and it reads the request's current page (`?page=`, or the page a Flow
component registered).

```typescript
async paginate<T>(perPage?: number, page?: number): Promise<PaginateResult<T>>
```

### Result shape

The object you get back carries the rows under `data` plus everything a UI needs to
draw a pager — the current page, the total, the last page, and the 1-based `from`/`to`
indices for "showing 1–15 of 240" labels. The nested `meta` repeats the same numbers in
the shape API clients usually expect, so you can return it straight from a JSON
endpoint:

```typescript
// type: PaginateResult<T>
interface PaginateResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
  from: number | null; // 1-based index of the first row (null if empty)
  to: number | null; // 1-based index of the last row (null if empty)
  meta: { from; to; currentPage; lastPage; perPage; total; path };
  // URL + state helpers ↓
}
```

### URL & state helpers

```typescript
// using a PaginateResult `page`
page.hasMorePages; // boolean
page.onFirstPage; // boolean
page.onLastPage; // boolean

page.nextPageUrl(); // '?page=2'  | null on the last page
page.previousPageUrl(); // '?page=1'  | null on the first page
page.url(3); // '?page=3'
page.url(3, "/posts", { q: "bun" }); // '/posts?q=bun&page=3'

// Render a numbered pager — extra query params are merged onto every link
page.links("/posts", { q: "bun" });
// → [{ page: 1, url: '/posts?q=bun&page=1', active: false }, …]
```

`nextPageUrl`, `previousPageUrl`, `url`, and `links` all accept an optional base URL
and extra query params, which are preserved across links so filters survive

## simplePaginate — next / prev only

Skips the `COUNT` entirely by fetching `perPage + 1` rows to detect whether
another page follows. Use it when you don't need a total or page numbers:

```typescript
// in a controller
const page = await Post.query().latest().simplePaginate(20);

page.data; // up to 20 rows
page.hasMorePages; // true if a further page exists
page.nextPageUrl();
page.onFirstPage;
```

```typescript
async simplePaginate<T>(perPage?: number, page?: number): Promise<SimplePaginateResult<T>>
```

> **Note** — Argument order is `simplePaginate(perPage, page)` — **`perPage`
> first**, matching `paginate(perPage, page)`. `perPage` defaults to 15; omit
> `page` to read the request's current page.

There is no `total` or `lastPage` — that's the trade-off for dropping the count.

## cursorPaginate — keyset pagination on id

Cursor (keyset) pagination walks the table by `id` with `WHERE id > cursor ORDER
BY id ASC`, fetching `limit + 1` rows to detect a next page. It has **no
`COUNT`** and stays fast no matter how deep you scroll — ideal for
infinite-scroll feeds and very large tables:

```typescript
// in a controller
let result = await Post.query().cursorPaginate({ limit: 20 });

result.data; // first 20 posts
result.nextCursor; // pass to the next call; null on the last page
result.prevCursor; // cursor that produced the previous page; null on the first
result.hasMore; // boolean

// Next page:
const more = await Post.query().cursorPaginate({ cursor: result.nextCursor!, limit: 20 });
```

```typescript
async cursorPaginate<T>(options?: { cursor?: number; limit?: number }): Promise<CursorPaginateResult<T>>
```

Defaults: `{ cursor: 0, limit: 15 }`. Because it orders by `id` ascending, the
cursor is stable even as rows are inserted. The trade-off vs. `paginate()` is no
random page access and no total count.

## keysetPaginate — keyset pagination on any column

`keysetPaginate()` generalises `cursorPaginate()`: it accepts **any sort
column**, supports `'asc'` and `'desc'`, and returns an **opaque base64 cursor**
that encodes the last row's sort value so clients cannot interpret or tamper with
it. A secondary `id ASC` tiebreaker keeps page boundaries stable when the sort
column isn't unique.

```typescript
// in a controller
// First page, newest first
const p1 = await Post.query().keysetPaginate({ column: "created_at", direction: "desc" });

p1.data; // first page of rows
p1.nextCursor; // opaque base64 string | null on the last page

// Next page — pass the opaque cursor straight back
const p2 = await Post.query().keysetPaginate({
  column: "created_at",
  direction: "desc",
  cursor: p1.nextCursor!,
});
```

```typescript
async keysetPaginate<T>(options?: KeysetOptions): Promise<KeysetPaginateResult<T>>

interface KeysetOptions {
  cursor?: string | null; // opaque cursor from the previous page; null = first page
  column?: string; // sort column, must be a safe identifier (default 'id')
  direction?: "asc" | "desc"; // default 'asc'
  limit?: number; // default 15
}
```

> **Danger** — The `column` must be a safe SQL identifier; `keysetPaginate()`
> rejects anything else (e.g. `name; DROP TABLE users--`) by throwing. Never
> build the column name from raw, unvalidated user input.

## Choosing a paginator

- **Numbered admin tables / search results** → `paginate()` — you want page
  numbers and a total.
- **Lightweight "Load more" / Prev-Next** → `simplePaginate()` — skip the count,
  keep it cheap.
- **Infinite scroll keyed on `id`** → `cursorPaginate()` — constant-time paging,
  no count, simplest cursor.
- **Cursor paging on a sort other than `id`** (e.g. `created_at`, `score`) →
  `keysetPaginate()` — any column, opaque tamper-proof cursors.

All four work identically on a raw `DB.table(...)` query (returning plain rows)
and on a `Model.query()` (returning hydrated models with eager-loaded
relations).

## Putting it together

Two patterns cover most real use.

### A filtered, numbered results page

Paginate _after_ applying filters and sorting, then pass the current filters to
`links()` so they ride along on every page URL — without that, clicking "page 2" would
silently drop the user's search:

```typescript
// in a controller — GET /search?q=bun&page=2
const q = http.query("q", "");

const page = await Post.query()
  .when(q, (query, term) => query.whereLike("title", `%${term}%`))
  .latest()
  .paginate(15, Number(http.query("page", "1")));

return view("search", {
  results: page.data,
  total: page.total,
  // every link keeps ?q=… so the filter survives paging
  pager: page.links("/search", { q }),
});
```

### An infinite-scroll API endpoint

For a feed the client scrolls forever, return the rows plus the next cursor and nothing
else — no count, no page numbers. The client sends the cursor back to fetch more:

```typescript
// in a controller — GET /api/posts?cursor=128
const result = await Post.query()
  .with("author")
  .cursorPaginate({ cursor: Number(http.query("cursor", "0")), limit: 20 });

return {
  posts: result.data,
  nextCursor: result.nextCursor, // null when there's nothing left to load
};
```

When the sort isn't `id` — a "newest first" feed, say — reach for `keysetPaginate()`
instead and hand the opaque `nextCursor` string back the same way.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Pagination bugs
live at the edges, so test the boundaries rather than the happy page.

A `paginate()` result carries `data` plus the counts, so one call proves several
things at once:

```typescript
// tests/pagination/Posts.test.ts
import { test, expect } from "bun:test";
import { PostFactory } from "../../database/factories/PostFactory.ts";
import { Post } from "../../app/models/Post.ts";

test("reports the right totals on the last page", async () => {
  await PostFactory.count(25).create();

  const page = await Post.query().orderBy("id").paginate(10, 3); // 10 per page, page 3

  expect(page.data).toHaveLength(5); // the remainder
  expect(page.total).toBe(25);
  expect(page.lastPage).toBe(3);
  expect(page.from).toBe(21);
  expect(page.to).toBe(25);
});
```

**The three cases worth pinning down** are the ones that produce a broken UI
rather than an exception:

```typescript
// tests/pagination/Posts.test.ts
test("an empty result reports null bounds, not zero", async () => {
  const page = await Post.query().where("status", "nothing").paginate();

  expect(page.data).toEqual([]);
  expect(page.total).toBe(0);
  expect(page.from).toBeNull(); // not 0 — a pager rendering "0–0 of 0" is a bug
  expect(page.to).toBeNull();
});

test("a page past the end is empty rather than an error", async () => {
  await PostFactory.count(5).create();

  const page = await Post.query().orderBy("id").paginate(10, 99);

  expect(page.data).toEqual([]);
  expect(page.page).toBe(99);
});
```

> **Warning** — Paginating without an `orderBy` gives the database licence to
> return rows in any order, so the same row can appear on two pages and another
> on none. A test that seeds five rows and reads one page will not catch it —
> order explicitly, and the bug never exists.

## References

### Query methods

| Method           | Signature                                                                        | Description                                                   |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `paginate`       | `paginate(perPage?, page?): Promise<PaginateResult<T>>`                          | Offset pagination with a `COUNT` total and `lastPage`.        |
| `simplePaginate` | `simplePaginate(perPage?, page?): Promise<SimplePaginateResult<T>>`              | Offset next/prev pagination, no count.                        |
| `cursorPaginate` | `cursorPaginate({ cursor?, limit?, column? }): Promise<CursorPaginateResult<T>>` | Keyset pagination on `column` (default `id`, numeric cursor). |
| `keysetPaginate` | `keysetPaginate(options?): Promise<KeysetPaginateResult<T>>`                     | Keyset pagination on any column (opaque base64 cursor).       |

### `PaginateResult<T>` helpers

| Member            | Signature                                          | Description                                       |
| ----------------- | -------------------------------------------------- | ------------------------------------------------- |
| `hasMorePages`    | `boolean`                                          | True when a page follows the current one.         |
| `onFirstPage`     | `boolean`                                          | True on the first page.                           |
| `onLastPage`      | `(): boolean`                                      | True on the last page.                            |
| `nextPageUrl`     | `(baseUrl?, query?): string \| null`               | URL of the next page, or `null` on the last.      |
| `previousPageUrl` | `(baseUrl?, query?): string \| null`               | URL of the previous page, or `null` on the first. |
| `elements`        | `(each?): (number \| "...")[]`                     | Page-number window with `"..."` gaps for a pager. |
| `url`             | `(page, baseUrl?, query?): string`                 | URL for any page number.                          |
| `links`           | `(baseUrl?, query?): Array<{ page; url; active }>` | One link per page for rendering a numbered pager. |

> **Tip** — `SimplePaginateResult<T>` exposes the same URL helpers and
> `hasMorePages`, but has no `links()`, `onLastPage`, `total`, or `lastPage`.

## Next steps

- [Query Builder](/docs/query-builder) — building the query you paginate.
- [ORM Queries](/docs/orm/queries) — model queries, scopes, and eager loading.
- [Flow › Pagination](/docs/flow/pagination) — reactive paginated components.
