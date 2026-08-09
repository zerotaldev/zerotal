---
title: "Guide: A Searchable, Sortable, Paginated Table in One Class"
description: "Live search, clickable column sorting, numbered pagination, and shareable URLs for all of it — built as a single Flow component, with the two traps this feature always hides called out along the way."
date: 2026-08-10
category: Guides
order: 3
---

# Guide: A Searchable, Sortable, Paginated Table in One Class

The data table is the workhorse screen of every internal tool, and it always wants the same four things: a search box, sortable columns, pagination, and — the one everybody forgets until a user asks — a URL you can copy that brings back the exact same view.

In most stacks that is an endpoint, a client-side store, a URL-state library, and an afternoon. Here it is one class. This guide builds it end to end and points out the two traps hiding in this feature.

## The model

```ts
// app/models/User.ts
import { Model, column, table } from "zerotal/orm";

@table("users")
export class User extends Model {
  @column({ primary: true }) id!: number;
  @column() name!: string;
  @column() email!: string;
  @column() role!: string;
}
```

Nothing special — declared columns give you `User.query()`, `User.paginate()`, and typed `where` clauses. If your app already has a model, skip ahead.

## The page

```tsx
// app/flow/UsersPage.tsx
import { Component, Pagination, Table, Pager, url } from "@zerotal/flow";
import { User } from "@app/models/User.ts";

export class UsersPage extends Component.using(Pagination) {
  @url search = "";
  @url sortBy = "name";
  @url sortDir: "asc" | "desc" = "asc";

  override async onUpdated(prop: string): Promise<void> {
    if (prop === "search") this.resetPage();
  }

  override async render() {
    let query = User.query().orderBy(this.sortBy, this.sortDir);
    if (this.search) query = query.whereLike("name", `%${this.search}%`);
    const users = await query.paginate(15); // reads this component's ?page=

    return (
      <div>
        <input value={this.search} live placeholder="Search users…" />

        <Table
          columns={[
            { key: "name", label: "Name", sortable: true },
            { key: "email", label: "Email", sortable: true },
            { key: "role", label: "Role" },
          ]}
          rows={users.data}
          sortBy={this.sortBy}
          sortDir={this.sortDir}
          params={{ search: this.search }}
          hover
        />

        <Pager
          paginator={users}
          params={{ search: this.search, sortBy: this.sortBy, sortDir: this.sortDir }}
        />

        <p class="text-sm text-gray-500 mt-2">
          Showing {users.from}–{users.to} of {users.total}
        </p>
      </div>
    );
  }
}
```

```ts
// app/routes/index.ts
Router.flow("/users", UsersPage);
```

That is the whole feature. Now the walkthrough, because five lines of it are doing more than they look like.

## `@url` is the shareable-view feature

`search`, `sortBy`, and `sortDir` are declared `@url`, and the `Pagination` mixin's `page` already is. That one decorator syncs each property with the query string in both directions: change the state and the address bar updates; load `/users?search=ada&sortBy=email&sortDir=desc&page=3` cold and the component boots into exactly that view. Copy the URL to a colleague and they see what you see. Refresh and nothing is lost.

You did not install a router-state library, and there is no serialization code to keep in sync. The decorator _is_ the feature.

## The search box syncs itself

```tsx
<input value={this.search} live />
```

Binding state to `value` on an `@url`/`@expose` property wires two-way binding automatically. The `live` modifier syncs it to the server as you type — debounced by ~150ms for text inputs, so fast typing coalesces into one round-trip when you pause instead of one per keystroke. The results re-render on the server and the diff streams back. A live search box in one attribute.

## Trap one: the empty page 3

Here is the first trap, and it ships in production constantly: a user is on page 3, types a search that matches four rows, and sees… nothing. Page 3 of a four-row result set is empty. No error, just a blank table and a confused user.

That is what this pair is for:

```ts
override async onUpdated(prop: string): Promise<void> {
  if (prop === "search") this.resetPage();
}
```

`onUpdated` fires on every client write — each debounced search sync lands here — and `resetPage()` (from the `Pagination` mixin) sends the view back to page 1 whenever the filter changes. Any property that narrows the result set should get the same treatment.

## Trap two: sorting that loses the search

Clicking a sortable `<Table>` header navigates to `?sortBy=email&sortDir=asc`. But a plain navigation to that URL would _drop_ `?search=ada` — sorting would silently clear the search. That is what the `params` props are for:

```tsx
<Table … params={{ search: this.search }} />
<Pager … params={{ search: this.search, sortBy: this.sortBy, sortDir: this.sortDir }} />
```

Each component merges those into the links it generates, so sorting preserves the search and paging preserves both. State that lives in the URL has to travel through every link that changes the URL — declare it once per link-generating component and the views stay consistent.

## Sorting is just `orderBy`

Notice what the sort implementation is:

```ts
User.query().orderBy(this.sortBy, this.sortDir);
```

There is no sort handler. The header click navigates, `@url` writes the new values into component state, `render()` runs again, and the query reads them. Server-driven UI collapses "handle the click, update the store, refetch, re-render" into "state changed, so render ran".

## Testing it

The whole thing tests in-process — no browser, no server socket:

```ts
import { FlowTest } from "@zerotal/flow/testing";

test("searching resets to page 1", async () => {
  const t = await FlowTest.mount(UsersPage);

  await t.call("gotoPage", 3);
  await t.update("search", "ada"); // fires onUpdated, like a real keystroke

  expect(t.page().page).toBe(1);
});
```

`t.update()` simulates the client write and runs the same `onUpdating`/`onUpdated` hooks production runs, so the reset-on-search behaviour is tested exactly where it lives.

## What you did not build

Count what is absent: no endpoint, no client store, no hand-maintained response type, no loading flags, no URL-state synchronization library, no debounce utility. The component owns the state, the query, and the markup; the framework owns the wire.

From here: [Pagination](/docs/flow/pagination) covers named paginators (two independent tables on one page), [Built-in Components](/docs/flow/components) documents every `<Table>` and `<Pager>` prop, and `<InfiniteScroll>` is the drop-in alternative when numbered pages are the wrong shape. Start fresh with `bun create zerotal` — the `flow` template gives you an app this class drops straight into.
