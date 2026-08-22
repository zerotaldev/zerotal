---
title: Admin Tables
description: Columns, filters, sorting, search, and bulk actions on the list screen.
---

# Tables

`columns()` returns `Column`s built with `text(key)` plus chainable modifiers.

```ts fragment
static columns() {
  return [
    text("title").label("Title").sortable().searchable(),
    text("status").badge((v) => (v === "published" ? "success" : "muted")),
    text("views").align("end").sum("Total views"),
    text("created_at").label("Created").since().sortable(),
  ];
}
```

## Column kinds & modifiers

| Modifier / factory                      | Effect                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| `.label(text)`                          | Header label (defaults to a title-cased key).           |
| `.sortable()`                           | Clickable, URL-driven sort header.                      |
| `.searchable()`                         | Include in the table's search box.                      |
| `.align("start" \| "center" \| "end")`  | Cell alignment.                                         |
| `.format((v, row) => string)`           | Custom value formatter.                                 |
| `.badge((v, row) => tone \| null)`      | Render as a colored pill.                               |
| `.copyable()`                           | Copy-to-clipboard affordance.                           |
| `toggleColumn(key)` / `.toggle()`       | Inline boolean toggle — writes on click.                |
| `selectColumn(key, options)`            | Inline select — saves the chosen value on change.       |
| `textInputColumn(key)` / `.editText()`  | Inline text input — saves on change/blur.               |
| `imageColumn(key)` / `.circular()`      | Image / avatar cell.                                    |
| `colorColumn(key)`, `iconColumn(key)`   | Color swatch, boolean check/cross icon.                 |
| `.sum() / .avg() / .count() / .range()` | Column **summaries** (see below). Or `.summarize([…])`. |

## Summaries

`.sum()`, `.avg()`, `.count()`, `.range()` (each takes an optional label and number
formatter) render a `<tfoot>` total computed over the **full filtered dataset**, plus
per-group subtotals when grouping is active.

```ts fragment
text("amount").align("end").sum("Revenue", (n) => `$${n.toFixed(2)}`),
text("id").count("Orders"),
```

## Filters

```ts fragment
import { selectFilter, ternaryFilter } from "@zerotal/admin";

static filters() {
  return [
    selectFilter("status").options({ draft: "Draft", published: "Published" }),
    ternaryFilter("featured").labels("Featured", "Standard"),
    // custom query:
    selectFilter("author").options(authorMap).query((q, v) => q.where("author_id", v)),
  ];
}
```

Filters are URL-driven and compose with tabs, search, sort, and pagination.

## The query builder

Fixed filters work when you can name the useful questions in advance. A catalogue
or a ledger is queried in too many ways for that, so `queryBuilder` lets the user
stack their own comparisons and nest AND/OR groups:

```ts fragment
import {
  queryBuilder, textConstraint, numberConstraint,
  selectConstraint, booleanConstraint, dateConstraint,
} from "@zerotal/admin";

static filters() {
  return [
    queryBuilder("q").label("Advanced filter").constraints([
      textConstraint("name"),
      numberConstraint("price").label("Price (cents)"),
      dateConstraint("created_at").label("Created"),
      selectConstraint("status").options({ draft: "Draft", active: "Active" }),
      booleanConstraint("featured"),
    ]),
  ];
}
```

You declare **what may be compared**; the panel supplies the operators each kind
deserves — `contains` / `starts with` / `is empty` for text, `is at least` / `is
before` for numbers and dates — and turns the result into predicates.

Two things are worth knowing about how it applies:

- **The whole tree is wrapped in one group.** An `OR` inside a rule can never
  break out and widen a scope the page already applied: a tab, a parent record, a
  soft-delete filter. The tree narrows; it cannot escape.
- **A rule naming a constraint you never declared is dropped.** The active tree
  travels in the URL, so it is user input; only the columns you listed are
  reachable, and a hand-edited URL cannot filter on a password hash.

Groups nest as deep as the question needs — a group inside a group inside a
group — and the whole tree lives in the same `?filters=` parameter as everything
else, so it composes with tabs, search, sort and pagination. A narrowed view is a
link someone can send to a colleague.

## Tabs

`tab(key)` adds quick-filter tabs above the table, each scoping the query and
optionally showing a count badge.

```ts fragment
import { tab } from "@zerotal/admin";

static tabs() {
  return [
    tab("all").label("All"),
    tab("published").modifyQuery((q) => q.where("status", "published")).badge(),
    tab("draft").modifyQuery((q) => q.where("status", "draft")).badgeColor("muted"),
  ];
}
```

## Grouping

`group(column)` adds a "Group by" menu; the page renders header rows per bucket with
counts (and per-group summary subtotals).

```ts fragment
import { group } from "@zerotal/admin";

static groups() {
  return [group("status"), group("author").label("Author")];
}
static defaultGroup = "status";   // optional
```

## Reordering

Set `reorderable` to an integer position column to show up/down handles that persist
order:

```ts fragment
static reorderable = "sort";
```

## Built-in table affordances

Per-page selector, a **Columns** visibility manager (`?cols=`), full-text search
across `.searchable()` columns, and bulk selection with a toolbar all ship
automatically and are URL-driven.

## Empty states

A blank table teaches nobody anything. Override `emptyState()` to say why the list
is empty and what will fill it:

```ts fragment
static emptyState() {
  return {
    heading: "No orders yet",
    description: "Orders appear here as soon as a customer checks out.",
    icon: "inbox",
    actions: [createAction()],
  };
}
```

A search or filter that matches nothing gets a different, automatic message — this
is for a genuinely empty resource, which is a different problem and wants a
different answer.

## Layout and placement

How the table renders — grid instead of rows, striping, sticky headers, density —
and where the filters sit are covered in
[Extending the UI](/docs/admin/extending-ui#table-presentation).

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
