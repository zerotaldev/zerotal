---
title: Extending the UI
description: Render your own cells, controls and entries, inject markup into the panel's chrome, and back a resource with something other than a model.
---

# Extending the UI

The catalogue covers most screens. When it doesn't, four escape hatches let you
add what's missing without forking the panel.

| You want                                       | Reach for                                   |
| ---------------------------------------------- | ------------------------------------------- |
| A cell, control or entry the catalogue lacks   | [Custom renderers](#custom-renderers)       |
| Markup in the panel's chrome — banners, badges | [Render hooks](#render-hooks)               |
| A resource backed by an API or a file          | [Custom data sources](#custom-data-sources) |
| A different shape of table                     | [Table presentation](#table-presentation)   |

## Custom renderers

Every layer has a `.render()` that takes over its own markup and leaves
everything else alone.

**Table cells.** The column still owns its label, sorting, search and export;
only the cell is yours:

```ts fragment
text("health")
  .label("Health")
  .sortable()
  .render((value) => <HealthBar value={Number(value)} />),
```

**Infolist entries.** The section's grid still places it:

```ts fragment
textEntry("route").render((value) => <RouteMap path={String(value)} />),
```

**Form controls.** `customField` gives you a field that validates, binds and
saves like any other — you supply only the control. Bind your markup to
`form.<key>` for the value to round-trip:

```ts fragment
customField("coordinates")
  .label("Location")
  .required()
  .render((value, data) => <MapPicker value={value} country={data.country} />),
```

The renderer receives the whole form's data as well as its own value, which is
what lets a control react to a sibling field.

## Render hooks

A contributed page can only add a page. A hook adds markup at a named position
in the chrome — a trial banner, a compliance notice, an environment badge:

```ts fragment
Panel.renderHook("page.header.end", () => <TrialBanner />);

// Conditional placement: register once, decide per render.
Panel.renderHook("table.start", (ctx) =>
  ctx.resource === "orders" ? <ShippingNotice /> : null,
);
```

Returning `null` renders nothing. A hook that throws is logged and skipped — a
decoration must not be able to take down the page it decorates.

The positions:

| Group        | Names                                  |
| ------------ | -------------------------------------- |
| Shell        | `body.start`, `body.end`               |
| Sidebar      | `sidebar.start`, `sidebar.end`         |
| Top bar      | `topbar.start`, `topbar.end`           |
| Page heading | `page.header.start`, `page.header.end` |
| Table        | `table.start`, `table.end`             |
| Form         | `form.start`, `form.end`               |
| Record       | `record.start`, `record.end`           |

Each hook receives a context naming the resource, the kind of screen and the
record id where there is one, so one registration can serve every page and place
itself only where it belongs.

Packages get the same surface through the `admin.panel` binding — see
[Custom Pages & Plugins](/docs/admin/extending).

## Custom data sources

A resource does not have to be backed by a model. Return rows from `data()` and
the panel filters, sorts and paginates them in memory, so search, tabs,
summaries and the query builder all keep working:

```ts fragment
export class RegionResource extends Resource {
  static override async data() {
    return await fetch("https://api.example.com/regions").then((r) => r.json());
  }

  static override columns() {
    return [text("code").searchable(), text("name").searchable(), text("population")];
  }
}
```

Reads are the easy half. A read-only source needs no `form()` — an empty one
removes the create and edit pages. To make it writable, override `create`,
`update` and `destroy` to push the change back wherever it belongs.

In-memory means the whole set is loaded per request, so this suits hundreds of
rows and not millions. Past that, back it with a model or a view.

## Table presentation

Four statics change how a list renders:

```ts fragment
export class ProductResource extends Resource {
  static override tableLayout = "grid"; // "table" (default) | "grid" | "kanban" | "calendar"
  static override striped = true;
  static override stickyHeader = true;
  static override density = "compact"; // "comfortable" (default) | "compact"
}
```

**Grid** trades columns for cards, which suits records you recognise by sight —
products, media, people. The layout is derived from the columns you already
declared: the first image column becomes the picture, the first text column the
title, and the next few render as label/value pairs. No second description.

**Kanban** turns a status column into lanes, for records that read as a pipeline:

```ts fragment
static override tableLayout = "kanban";
static override kanbanColumn = "status";
static override kanbanLanes = { pending: "Pending", paid: "Paid", shipped: "Shipped" };
```

Each card carries arrows to move it to the neighbouring lane, which runs the same
authorised update a row action would — a second way to do a thing the panel already
does, not a second source of truth. A value present in the data but missing from
`kanbanLanes` still gets a lane, so nothing is hidden by an incomplete declaration.

**Calendar** lays the page out as a month grid keyed on a date column:

```ts fragment
static override tableLayout = "calendar";
static override calendarColumn = "startsOn";
```

The month shown is the one the listed rows fall in rather than the current month, so
paging back through older records does not land on an empty grid.

**Striped**, **sticky** and **compact** are what they sound like, and matter most
on wide or long tables.

### Trees

A resource whose records nest under each other renders as a tree:

```ts fragment
export class CategoryResource extends Resource {
  static override treeParentColumn = "parentId";
}
```

Each page is arranged so children sit under their parent and the first column indents
by depth. The arranging happens over the rows on screen rather than in SQL — a
recursive query is the right answer for a deep tree but is not portable across the
drivers the panel supports, and a tree small enough to browse is small enough to
arrange in memory. A row whose parent is not on the page stays at the top level rather
than disappearing, so a filtered tree never hides a record.

### Translations

A resource whose text exists in several languages edits one at a time:

```ts fragment
export class PostResource extends Resource {
  static override translatable = ["title", "excerpt"];
  static override locales = ["en", "fr"];
}
```

The columns store `{ en: "…", fr: "…" }`. The list gains a locale switch and shows the
active one; the form gains locale tabs, and switching banks what you have typed rather
than discarding it. Saving one locale keeps the others, which is what stops an English
edit from wiping the French. A value that was never translated is shown as-is, so
turning this on for an existing column does not blank it.

### Header filters

A column can carry its own filter box in the table header:

```ts fragment
text("sku").filterable();
selectColumn("status", STATUS).filterable();
```

The control follows the column's kind — a text box for text, a yes/no switch for a
toggle, the declared choices for a select — so a column usually needs nothing else.
Header filters write into the same `?filters=` parameter as declared filters, which
means they compose with tabs, search, sorting and pagination the same way, show up in
the active-filter chips, and land in a saved view.

### Filter placement

Filters sit above the table by default. Once there are more than a few, collapse
them:

```ts fragment
static override filterLayout = "panel";   // "inline" (default) | "panel" | "drawer"
```

Both `panel` and `drawer` hide the controls behind a Filters button carrying a
count of what's active; they differ in where the revealed controls sit.

Whatever the layout, anything currently narrowing the list shows as a chip above
the table — the search term, each filter, the trashed scope — and each chip is
its own undo. A table showing four of two hundred rows for no visible reason is
the most common way a panel misleads someone; the chips are the fix.

## Types

The contribution shapes another package pushes into the panel:

| Type                                                               | What it is                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `NavItem`, `NavGroup`, `NavContribution`                           | A sidebar entry, a heading it sits under, and a contributed one.         |
| `PageContribution`                                                 | A whole page added to the panel.                                         |
| `UserMenu`, `UserMenuItem`, `UserMenuContribution`                 | The account menu and its entries.                                        |
| `TopbarSlot`                                                       | Where something may be placed in the top bar.                            |
| `RenderHookName`                                                   | Every point the panel can be extended at — the enumeration of the slots. |
| `RenderHookContext`                                                | What a hook receives when it runs.                                       |
| `ConsoleContribution`, `ConsoleColumn`, `ConsoleRow`, `ConsoleTab` | Contributions to the console page.                                       |

## Next steps

- [Tables](/docs/admin/tables) — columns, filters and the query builder.
- [Forms & Infolists](/docs/admin/forms) — the built-in field and entry catalogue.
- [Custom Pages & Plugins](/docs/admin/extending) — whole pages, and contributing from a package.
- [References](/docs/admin/references) — the full API surface in one table.
