---
title: Panel Structure
description: Group resources into clusters, nest one resource under another's records, back a single row, and run more than one panel from a single app.
---

# Panel Structure

A panel with six resources needs no structure at all: register them and the sidebar
reads fine. Past that it starts to matter, and four tools cover almost every shape a
real back office takes.

| You have                                              | Reach for                                 |
| ----------------------------------------------------- | ----------------------------------------- |
| Too many resources for one sidebar list               | [Clusters](#clusters)                     |
| Records that only make sense inside a parent          | [Nested resources](#nested-resources)     |
| Exactly one row — settings, a company profile         | [Singular resources](#singular-resources) |
| Two audiences who should not see each other's screens | [Multiple panels](#multiple-panels)       |

## Clusters

A cluster gives a group of resources a shared URL segment and a single sidebar
entry. Declare one, then point resources at it:

```ts
import { Cluster } from "@zerotal/admin";

export class ShopCluster extends Cluster {
  static override slug = "shop";
  static override title = "Shop";
  static override navigationIcon = "collection";
}

export class ProductResource extends Resource {
  static override model = Product;
  static override cluster = ShopCluster; // → /admin/shop/products
}
```

Members collapse under one expandable entry rather than sitting loose in the
sidebar, and every URL the panel builds — links, redirects, breadcrumbs — picks up
the cluster segment on its own. Nothing in a resource needs to know its own path.

A cluster's `ability` gates the whole section:

```ts
export class FinanceCluster extends Cluster {
  static override slug = "finance";
  static override title = "Finance";
  static override ability = "finance.view";
}
```

Every member route enforces it, so no resource has to restate the check. Custom
pages join a cluster the same way, with `static cluster = FinanceCluster`.

## Nested resources

Some records have no meaning apart from their parent. Comments belong to a post;
there is no useful screen listing every comment in the database. Declare the
parent and the resource moves inside it:

```ts
export class CommentResource extends Resource {
  static override model = Comment;
  static override parent = { resource: () => PostResource, foreignKey: "post_id" };
}
```

That gives you `/admin/posts/7/comments`, and three things follow automatically:

- **Every list is scoped to the parent.** The scope is applied before any tab or
  filter, so nothing a user selects can widen the query past their parent record.
- **New records inherit the foreign key** from the URL rather than from a form
  field, so it cannot be tampered with on the way to the server.
- **The resource leaves the sidebar,** because there is no parent-free URL to
  link to. It is reached through the parent's own pages.

The parent is named by a **function**, not a direct reference. The two resources
almost always point at each other — the parent lists the child as a relation, the
child names the parent here — and a direct reference would resolve to `undefined`
on whichever side of the import cycle evaluated first.

When the parent declares the child with `hasMany`, its view page links into the
nested pages instead of rendering an inline table:

```ts
export class PostResource extends Resource {
  static override relations() {
    return [hasMany(CommentResource, "post_id").title("Comments")];
  }
}
```

## Singular resources

Site settings are one row. A list of one, with a view page and an edit page behind
it, is three screens too many:

```ts
export class SettingsResource extends Resource {
  static override model = Setting;
  static override singular = true;
  static override slug = "settings";

  static override form() {
    return [
      formSection("Identity").schema([
        textInput("siteName").required(),
        toggle("ordersOpen").label("Accepting orders"),
      ]),
    ];
  }
}
```

`/admin/settings` opens the form directly. There is no list, no create page and no
id in the URL. The row is resolved on first visit and created from the form's
defaults if it does not exist yet, so a fresh install has something to edit rather
than an error.

## Multiple panels

Most applications have one panel, and `Panel.configure(...)` / `Panel.register(...)`
write to it. When a second audience needs a second set of screens, make another:

```ts
// The back office — everything.
Panel.configure({ brand: "Acme", path: "/admin", middleware: [AuthMiddleware] });
Panel.register(ProductResource, OrderResource, UserResource);

// A read-only console for the wider team.
const console = Panel.make("console", {
  brand: "Acme Console",
  path: "/app",
  middleware: [AuthMiddleware],
});
console.register(TeamPostResource);
```

Each panel owns its resources, pages, widgets, guard, branding and URL prefix.
Neither can see the other's registrations, so the same model can appear in both
under different resources — a full CRUD resource in one, a read-only one in the
other. That is a better answer than one resource with half its buttons hidden,
because the second panel simply never mounts the routes it should not have.

Give each panel a distinct path; two panels sharing a prefix cannot be told apart
from a URL. Where they nest, the longest match wins, so `/admin/billing` can be its
own panel inside `/admin`.

Sharing a sign-in is the common case — one identity, two sets of screens — so
point both at the same guard.

## Next steps

- [Resources](/docs/admin/resources) — what a resource declares.
- [Tables](/docs/admin/tables) — columns, filters and the query builder.
- [Custom Pages & Plugins](/docs/admin/extending) — pages that aren't a model.
- [References](/docs/admin/references) — the full API surface in one table.
