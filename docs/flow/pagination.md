---
title: Flow Pagination
description: The Pagination mixin, URL-synced pages, and named paginators.
---

# Pagination

Paginate in the database with `Model.paginate(perPage)` — it returns the page the request is on, so the component holds the result and nothing else. Compose the `Pagination` mixin (`ComponentWith(Pagination)`) for the page state and navigation actions. The standalone `paginate()` helper is for arrays you already hold in memory.

## In-memory pagination

For arrays already held in memory, `paginate(items, page, perPage)` slices the data and returns a rich paginator object with metadata and a windowed page list:

```typescript
import { paginate } from "@zerotal/flow";

export class PostsPage extends Component {
  @url page = 1;
  @locked all: Post[] = [];

  override async onMount() {
    this.all = await Post.query().orderBy("created_at", "desc").get();
  }

  @expose goTo(n: number): void {
    this.page = n;
  }

  override async render() {
    const p = paginate(this.all, this.page, 10);

    return (
      <div>
        <ul>
          {p.data.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>

        <div class="flex items-center gap-2 mt-4 text-sm">
          <span class="text-gray-500">
            Showing {p.from}–{p.to} of {p.total}
          </span>

          <nav class="flex gap-1 ml-auto">
            {p.elements().map((el) =>
              el === "..." ? (
                <span class="px-2 py-1 text-gray-400">…</span>
              ) : (
                <button
                  key={String(el)}
                  onClick={() => this.goTo(el as number)}
                  class={
                    el === p.page
                      ? "px-3 py-1 rounded bg-orange-500 text-white font-semibold"
                      : "px-3 py-1 rounded hover:bg-gray-100"
                  }
                >
                  {el}
                </button>
              ),
            )}
          </nav>
        </div>
      </div>
    );
  }
}
```

### Paginator properties

| Property          | Type                  | Description                                       |
| ----------------- | --------------------- | ------------------------------------------------- |
| `data`            | `T[]`                 | Items on the current page                         |
| `total`           | `number`              | Total item count across all pages                 |
| `page`            | `number`              | Current page number (1-based)                     |
| `perPage`         | `number`              | Items per page                                    |
| `lastPage`        | `number`              | Number of the last page                           |
| `from`            | `number`              | 1-based index of the first item on this page      |
| `to`              | `number`              | 1-based index of the last item on this page       |
| `onFirstPage`     | `boolean`             | `true` if `page === 1`                            |
| `hasMorePages`    | `boolean`             | `true` if there are pages after the current one   |
| `elements(each?)` | `(number \| "...")[]` | Windowed page list with ellipsis for large ranges |

`elements()` produces a compact list like `[1, 2, "...", 8, 9, 10]` — always showing the first page, last page, and a window around the current page. Pass a window size to `elements(window)` to control how many adjacent pages are shown on each side of the current one (default: 1).

## The Pagination mixin

`Pagination` is a class mixin that adds page state, URL sync, and navigation methods automatically. Compose it with [`ComponentWith(...)`](/docs/flow/components).

```tsx
import { Component, ComponentWith, Pagination, Pager } from "@zerotal/flow";

export class PostsPage extends ComponentWith(Pagination) {
  override async render() {
    const posts = await Post.paginate(10); // uses this component's page

    return (
      <div>
        <ul>
          {posts.data.map((post) => (
            <li key={String(post.id)}>{post.title}</li>
          ))}
        </ul>

        <Pager paginator={posts} />

        <p class="text-sm text-gray-500 mt-2">
          Showing {posts.from}–{posts.to} of {posts.total}
        </p>
      </div>
    );
  }
}
```

`<Pager>` renders the Prev / numbered / Next links and takes either paginator — the ORM's result or the in-memory one.

### Pagination members

Every navigation method accepts an optional `pageName` (default `"page"`) so one component can drive several **independent** paginators — `this.nextPage("invoices")` alongside `Invoice.paginate(10, undefined, "invoices")`. The default paginator is URL-synced (`?page=`); named paginators live in the snapshot.

| Member                    | Type             | Description                                               |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| `page`                    | `@url number`    | Current page of the default paginator, synced to `?page=` |
| `paginators`              | `@expose record` | Current page of each named paginator, keyed by name       |
| `gotoPage(n, pageName?)`  | `@expose method` | Jump to a specific page                                   |
| `resetPage(pageName?)`    | `@expose method` | Reset to page 1 (call when filters change)                |
| `nextPage(pageName?)`     | `@expose method` | Advance to the next page                                  |
| `previousPage(pageName?)` | `@expose method` | Go back to the previous page                              |
| `pageFor(pageName?)`      | method           | Read the current page of a paginator                      |

Optional update hooks fire around a page change: define any of `updatingPage(page, name)` / `updatedPage(page, name)` (default paginator) or the generic `updatingPaginators(page, name)` / `updatedPaginators(page, name)`.

### Resetting page on filter change

Always call `this.resetPage()` when a filter changes — otherwise the current page may exceed the new total and return an empty result set:

```typescript
@url search = "";
@url status = "all";

@expose async applySearch(q: string): Promise<void> {
  this.search = q;
  this.resetPage();
}

@expose async setStatus(s: string): Promise<void> {
  this.status = s;
  this.resetPage();
}

override async render() {
  const posts = await Post.query()
    .when(this.search, (q) => q.where("title", "like", `%${this.search}%`))
    .when(this.status !== "all", (q) => q.where("status", this.status))
    .paginate(15);
  // …
}
```

### Composing mixins

`Pagination` composes cleanly with other mixins via `ComponentWith(...)`:

```typescript
// Sorting + pagination — `Sorting` is your own mixin, `Pagination` is shipped:
export class PostsPage extends ComponentWith(Sorting, Pagination) {
  // has this.page and the nav actions, plus whatever your Sorting mixin adds
}

// A per-page preference of your own — pass it to the query:
export class PostsPage extends ComponentWith(Pagination) {
  readonly perPage = 25;

  override async render() {
    const posts = await Post.paginate(this.perPage);
    // …
  }
}
```

## Database pagination

For large datasets, avoid loading all rows in `onMount()`. Paginate in the database instead.

`Model.paginate(perPage)` returns the page the request is on. Compose the mixin, query in `render()`, and there is no page to pass, no state to hold, and nothing to refresh — a page change re-renders, and the re-render re-queries:

```tsx
export class PostsPage extends ComponentWith(Pagination) {
  override async render() {
    const posts = await Post.paginate(10); // this component's page

    return (
      <div>
        <ul>
          {posts.data.map((p) => (
            <li key={String(p.id)}>{p.title}</li>
          ))}
        </ul>

        <nav>
          <button onClick={this.previousPage} disabled={posts.page <= 1}>
            ‹ Prev
          </button>
          <span>
            Page {posts.page} of {posts.lastPage}
          </span>
          <button onClick={this.nextPage} disabled={posts.page >= posts.lastPage}>
            Next ›
          </button>
        </nav>
      </div>
    );
  }
}
```

That is the whole component. `render()` is `async`, so the query runs there and re-runs on every round-trip — the same shape as Livewire's `#[Computed]` paginator, and with the same trade-off: one query per render. Hold the result in a `@locked` field and load it in `onMount()` instead when the query is expensive and you'd rather re-run it only on demand (`this.refresh()`).

Outside a component, `paginate()` reads `?page=` from the query string — what a controller wants. The mixin points it at the component's own page instead, which is what makes it work over WebSocket, where there is no URL to read.

Pass the page explicitly when it isn't the request's — a report job, a fixed first page, a second paginator driven by something other than the mixin:

```typescript
const first = await Post.paginate(10, 1); // always page 1
const invoices = await Invoice.paginate(10, undefined, "invoices"); // a named paginator
```

The query builder takes the same arguments when you need to build the query up first. Keep the **result** on the component — it already carries the page, the total, the last page, and the URL helpers, so there is nothing to copy out of it:

```typescript
export class PostsPage extends ComponentWith(Pagination) {
  @url search = "";
  @url status = "all";

  @locked posts!: PaginateResult<Post>;

  override async onMount() {
    this.posts = await Post.query()
      .where("status", "!=", "deleted")
      .when(this.status !== "all", (q) => q.where("status", this.status))
      .when(this.search, (q) => q.where("title", "like", `%${this.search}%`))
      .orderBy("created_at", "desc")
      .paginate(15); // the component's page
  }

  @expose async applySearch(q: string): Promise<void> {
    this.search = q;
    this.resetPage(); // filters changed — back to page 1
    this.refresh(); // re-run onMount on this round-trip
  }

  override async render() {
    return (
      <div>
        <input value={this.search} live placeholder="Search posts…" class="input" />

        <ul class="mt-4 space-y-2">
          {this.posts.data.map((p) => (
            <li key={String(p.id)} class="border rounded p-3">
              <h3 class="font-semibold">{p.title}</h3>
            </li>
          ))}
        </ul>

        <nav class="flex items-center gap-1 mt-4">
          <button onClick={this.previousPage} disabled={this.posts.page <= 1}>
            ‹ Prev
          </button>
          <span class="px-3">
            Page {this.posts.page} of {this.posts.lastPage}
          </span>
          <button onClick={this.nextPage} disabled={this.posts.page >= this.posts.lastPage}>
            Next ›
          </button>
        </nav>
        <p class="text-sm text-gray-500 mt-1">{this.posts.total} total posts</p>
      </div>
    );
  }
}
```

> **Warning** — Don't mirror the paginator onto the component. Fields like `@locked total`, `@locked lastPage`, `@locked perPage`, and a hand-rolled `@url page` restate what `PaginateResult` already holds, and each one is a value that can drift out of step with the query. The mixin owns the page; the result owns everything else.

The ORM's `.paginate()` issues two queries — a `COUNT(*)` for the total and a `LIMIT/OFFSET` for the data — and returns `{ data, total, page, perPage, lastPage, from, to, meta }` plus `nextPageUrl()` / `prevPageUrl()` / `urlForPage()` for building links.

## Infinite scroll

Use the `<InfiniteScroll>` component to load more pages as the user scrolls down, without explicit page navigation:

```tsx
import { InfiniteScroll } from "@zerotal/flow";

export class FeedPage extends Component {
  @expose page = 1;
  @locked posts: Post[] = [];
  @locked hasMore = true;

  override async onMount() {
    const result = await Post.query().orderBy("created_at", "desc").paginate(20, 1);
    this.posts = result.data;
    this.hasMore = result.hasMorePages;
  }

  @expose async loadMore(): Promise<void> {
    this.page++;
    const result = await Post.query().orderBy("created_at", "desc").paginate(20, this.page);

    this.posts = [...this.posts, ...result.data]; // append
    this.hasMore = result.hasMorePages;
  }

  override async render() {
    return (
      <div>
        <ul class="space-y-4">
          {this.posts.map((p) => (
            <li key={String(p.id)} class="border rounded p-4">
              {p.title}
            </li>
          ))}
        </ul>

        <InfiniteScroll show={this.hasMore} onMore={this.loadMore}>
          <div class="h-12 flex items-center justify-center text-gray-400 text-sm">
            Loading more…
          </div>
        </InfiniteScroll>

        {!this.hasMore && (
          <p class="text-center text-gray-400 text-sm mt-4">You've reached the end.</p>
        )}
      </div>
    );
  }
}
```

`<InfiniteScroll>` calls the `onMore` action when its sentinel enters the viewport (using an IntersectionObserver). Pass `show={this.hasMore}` to stop rendering the sentinel — and stop loading — once you reach the end.

## Cursor pagination

For very large tables where `OFFSET` pagination is slow, use cursor-based pagination via the ORM. The cursor encodes the last-seen row's sort key and is more efficient for deep pages:

```typescript
export class ActivityPage extends Component {
  @url cursor: string | null = null;
  @locked items:    Activity[] = [];
  @locked nextCursor: string | null = null;
  @locked prevCursor: string | null = null;

  private async load() {
    const result = await Activity.query()
      .orderBy("id", "desc")
      .cursorPaginate(20, this.cursor);

    this.items      = result.data;
    this.nextCursor = result.nextCursor;
    this.prevCursor = result.prevCursor;
  }

  override async onMount() {
    await this.load();
  }

  @expose async next(): Promise<void> {
    this.cursor = this.nextCursor;
    await this.load();
  }

  @expose async prev(): Promise<void> {
    this.cursor = this.prevCursor;
    await this.load();
  }

  override async render() {
    return (
      <div>
        <ul>
          {this.items.map((a) => (
            <li key={String(a.id)}>{a.description}</li>
          ))}
        </ul>
        <div class="flex gap-4 mt-4">
          <button onClick={this.prev} disabled={!this.prevCursor}>← Previous</button>
          <button onClick={this.next} disabled={!this.nextCursor}>Next →</button>
        </div>
      </div>
    );
  }
}
```

Cursor pagination works best when you paginate by a monotonic column (`id`, `created_at`) in a consistent direction. It does not support random page access.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
