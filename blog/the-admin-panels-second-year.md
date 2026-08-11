---
title: "The Admin Panel's Second Year"
description: "Any admin generator can produce a CRUD table on day one. @zerotal/admin is built for day 400 — the questions that arrive once real people use it daily: who changed this, why can't they see it, why do my filters vanish every morning, and am I on production right now."
date: 2026-08-10
category: Announcements
order: 10
---

# The Admin Panel's Second Year

Admin panel demos all look the same, and they all look great. Point a tool at a model, get a sortable table with Create and Edit buttons, screenshot it. Twenty lines, four screens, done.

The demo is the easy part. What decides whether an internal tool is loved or quietly replaced by a spreadsheet is the _second year_ — the requests that only arrive once people use the thing every day:

> _Who changed this price, and can we put it back?_
> _The customer says the button is missing, but I can see it._
> _I set up these same four filters every single morning._
> _I edited it, saved, and my changes vanished._
> _Can support see orders but not delete them?_
> _…am I on production right now?_

`@zerotal/admin` is a Filament-style, class-based panel for Zerotal. It does the day-one part — this post covers that in one section — and then it has answers for all six of those. That is the interesting half.

## Day one, for completeness

A resource is a `static`-only class describing one model. Nothing instantiates it; the class _is_ the configuration.

```ts
// app/admin.ts
import { Panel, Resource, text, textInput } from "@zerotal/admin";
import { User } from "./models/User.ts";

Panel.configure({ brand: "Acme", path: "/admin" });

class UserResource extends Resource {
  static model = User;
  static navigationIcon = "users";
  static navigationGroup = "Access";

  static columns() {
    return [
      text("id").sortable(),
      text("name").searchable().sortable(),
      text("email").searchable().copyable(),
      text("role").badge((v) => (v === "admin" ? "primary" : "muted")),
      text("created_at").label("Joined").sortable(),
    ];
  }

  static form() {
    return [textInput("name").required().maxLength(120), textInput("email").email().required()];
  }
}

Panel.register(UserResource);
```

Visit `/admin`: a searchable, sortable, paginated table with Create, Edit, View and Delete, and that form on the create and edit screens. Per-page selector, a column-visibility manager, and bulk selection ship with it.

It is [Flow](/docs/flow) underneath, which is the reason this stays pleasant as it grows. Pages are server-side components; sorting, filtering, inline edits, modals and live notifications round-trip over a WebSocket and morph the DOM. There is no client store to keep in sync, no API between the panel and your models, and no build step for panel logic. Light and dark mode ship out of the box.

The form builder is deep enough for real screens — sections, tabs, wizards with per-step validation, repeaters and block builders for nested arrays, and reactive fields:

```ts
textInput("slug").required()
  .live().afterStateUpdated((v) => ({ slug: slugify(String(v)) })),

datePicker("published_at").visible((d) => d.status === "published"),
```

`.afterStateUpdated` runs **server-side** and merges a patch into the form. So "derive the slug from the title" is one line, executed where your `slugify` already lives, with no duplicated client logic.

Now the part that matters.

## "I set these filters up every single morning"

Start here, because it explains the design of everything else.

Every piece of list state lives in the URL: search, filters, active tab, sort column and direction, column visibility, grouping, page size. Not in a component, not in local storage — the query string.

That single decision pays out repeatedly. A narrowed view is a **link**, so "the twelve orders I mean" is something you paste into chat. And a saved view is therefore not a feature that needs a data model; it is a saved query string:

```ts
Panel.savedViews({
  async list(resource) {
    /* … */
  },
  async save(view) {
    /* … */
  },
  async remove(id) {
    /* … */
  },
});
```

A Views control appears above every list, with a name box for saving the current one. Page number is deliberately excluded from what a view stores — a view should restore how a list was _shaped_, not which page somebody happened to be on.

The same URL-driven design is why filtering composes rather than conflicting. Fixed filters work when you can name the useful questions in advance:

```ts
selectFilter("status").options({ draft: "Draft", published: "Published" }),
ternaryFilter("featured").labels("Featured", "Standard"),
```

A catalogue or a ledger gets queried in too many ways to enumerate, so users can stack their own comparisons and nest AND/OR groups:

```ts
queryBuilder("q").label("Advanced filter").constraints([
  textConstraint("name"),
  numberConstraint("price"),
  dateConstraint("created_at"),
  selectConstraint("status").options({ draft: "Draft", active: "Active" }),
]),
```

You declare **what may be compared**; the panel supplies the operators each kind deserves — `contains` and `is empty` for text, `is at least` and `is before` for numbers and dates. Two safety properties are enforced rather than hoped for:

- **The whole tree is wrapped in one group.** An `OR` inside a user's rule can never break out and widen a scope the page already applied — a tab, a parent record, a soft-delete filter. The tree narrows; it cannot escape.
- **A rule naming a constraint you never declared is dropped.** That tree travels in the URL, so it is user input. Only the columns you listed are reachable, and a hand-edited URL cannot filter on a password hash.

## "Who changed this price, and can we put it back?"

```ts
export class ProductResource extends Resource {
  static override history = true;
}
```

The view page grows a History card: what changed, when, by whom, with a Revert button on each entry that is itself undoable.

It reads from [`@zerotal/audit`](/docs/audit) — the panel does not keep a second trail of its own, which would only be a second thing to disagree with the first. And reverting restores the previous values of **the fields that entry changed**, not the whole record as it was. That distinction is the whole feature: rolling back a price change from three weeks ago must not also undo the description somebody fixed yesterday.

## "The customer says the button is missing"

The support ticket nobody can reproduce is usually solved by seeing what the person actually sees.

```ts
export class UserResource extends Resource {
  static override impersonatable = true;

  static override can(ability: string, record?: AdminRecord): boolean {
    if (ability !== "impersonate") return true;
    // Nobody impersonates an administrator — otherwise this is a way to
    // acquire more access than you have.
    return !((record?.roles as string[]) ?? []).includes("admin");
  }
}
```

Add `impersonateAction()` to the row actions and the panel handles the rest: an amber banner across the top for the duration, and one link back. The original user is remembered **in the session**, not derived from the impersonated account, so returning always works even when the account you switched into is broken.

Two rules are enforced rather than suggested. Impersonation never nests, because a second one on top of a first makes "stop" ambiguous. And `can("impersonate")` decides per record, defaulting to refusing.

## "I edited it and my changes vanished"

Two people editing the same record is normal. One of them silently losing their work is not.

```ts
export class ProductResource extends Resource {
  static override optimisticLock = "version";
}
```

The form remembers the version it loaded, and a save against a stale one is refused with a field error instead of going through. Refusing is the only honest answer available: overwriting loses somebody's work, and merging blind is worse than either.

## "Can support see orders but not delete them?"

Authorization already works without any UI — a resource's `can()` answers every question the panel asks, and delegating to your policies is usually the entire implementation:

```ts
static can(ability: string, record?: AdminRecord) {
  return Gate.allows(ability, record ?? this.model);
}
```

Write the policy once and the same rule governs the list page's row actions, the form's save button, and the bulk toolbar, without being restated in any of them. A denied ability **hides** the control rather than merely rejecting the request afterwards, so the panel never offers a button that cannot work.

What is missing is the other direction: seeing who can do what, and changing it without editing code.

```ts
Panel.roles(authRoles({ superusers: ["admin"] }));
```

`authRoles()` drives the RBAC in [`@zerotal/auth`](/docs/authorization), so the matrix edits the same roles and permissions the app already checks against — ticking a box makes a real check start passing.

The best decision in there is that **the permission catalogue is derived, not declared**. The panel walks its registered resources, pages and actions and reports every ability it actually checks: `products.viewAny`, `products.delete`, the soft-delete abilities where the model has them, every custom action's key. A hand-maintained list drifts the moment somebody adds a resource — and a matrix missing a row is _worse_ than no matrix, because it quietly implies the permission does not exist.

A role named as a superuser is shown holding everything and cannot be edited from the panel. That is worth modelling explicitly rather than by ticking every box, so an administrator does not silently lose access to a resource added next week.

## "Am I on production right now?"

The expensive mistake is editing production believing it is staging.

```ts
Panel.renderHook("body.start", environmentIndicator());
```

A coloured strip names the environment — red for production, amber for staging — and returns nothing in local development. Registering it unconditionally is the intended usage; there is nothing to switch off per environment.

## "Where did that logo go?"

A file upload field puts bytes somewhere and stores a path. That works right up until the same logo is needed on twenty products, or somebody wants to know what is still pointing at a file before deleting it.

```ts
Panel.media(databaseMedia());
```

The panel gains a Media page — grid, upload, search, folder filtering, alt-text editing — and forms can use `mediaPicker("imageUrl")`, which offers the library in a modal with upload-and-select in the same dialog.

The split is deliberate: [`zerotal/storage`](/docs/storage) holds the bytes, the catalogue holds the _record_ of them. Listing a bucket is not a substitute, because a bucket cannot tell you alt text, who uploaded something, or what it is for — and on a large disk it is slow besides.

## The pattern behind all of these

Notice what every one of those features has in common: a small provider **you** supply.

That is not the panel dodging work. Where record history, notifications, saved views, media and roles are _kept_ depends on your app, not on the panel — and a tool that guessed would either impose its own tables or be wrong. So the split is consistent throughout: **the admin owns the UI, your app supplies the data.** None of these appears in the interface until you configure it, so a panel with nothing configured looks exactly as it does today.

Where the ordinary answer is genuinely ordinary, there is a ready-made provider — `databaseNotifications()` for `@zerotal/notifications`' database channel, `databaseMedia()` for a conventional media table, `authRoles()` for `@zerotal/auth`. Every one of them is adjustable and every one can be replaced by your own `{ list, save, remove }`.

They also fail soft. A missing table, an unconfigured database or a signed-out user yields an empty bell rather than a broken panel — a notification centre is never worth taking a page down for.

## The rest of what is in there

Briefly, because the list is long: dashboard widgets (`statsWidget`, `chartWidget`, `tableWidget`) with `.poll("30s")`; per-resource widgets that answer "what is going on in _this_ list"; global search and a ⌘K command palette derived from your `.searchable()` columns; clusters, nested resources and singular resources for shaping a sidebar past a dozen entries; row/bulk/header actions with modal forms, confirmations, action groups and `replicateAction()`; CSV and XLSX export that exports **the list the user is currently looking at**, filters and all, rather than the whole table; column summaries computed over the full filtered dataset; grouping with subtotals; inline editable cells; and per-user dashboard arrangement.

And one small thing that says the most about the design — the empty state:

```ts
static emptyState() {
  return {
    heading: "No orders yet",
    description: "Orders appear here as soon as a customer checks out.",
    icon: "inbox",
    actions: [createAction()],
  };
}
```

A blank table teaches nobody anything. A search that matches nothing gets a different, automatic message, because "you filtered everything out" and "this resource is genuinely empty" are different problems that deserve different answers.

## One thing to do before you ship

The panel is **unguarded by default**, which is right for local exploration and wrong for anything else. Set the middleware before it leaves your machine:

```ts
Panel.configure({
  path: "/admin",
  brand: "Acme",
  middleware: [AdminGuard],
});
```

## Try it in about a minute

```bash
bun create zerotal my-admin    # pick the `admin` template
cd my-admin
bun zt db:seed                 # demo data + admin@example.com / password
bun zt serve --dev
```

Then open `/admin`.

From here: [Admin Panel](/docs/admin) is the front page, [Resources](/docs/admin/resources) covers the class and its hooks, [Tables](/docs/admin/tables) has the columns, filters and query builder, [Operations](/docs/admin/operations) covers history, impersonation, saved views, roles and locking, and [Custom Pages & Plugins](/docs/admin/extending) covers adding your own screens or contributing them from a package.
