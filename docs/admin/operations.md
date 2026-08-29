---
title: Operations
description: The features a panel grows once real people use it daily — record history, impersonation, saved views, the media library, roles and permissions, and a dashboard each person arranges.
---

# Operations

Everything in the rest of this guide is about getting a panel to show your data. This
page is about the things people start asking for once they use it every day: who
changed that, why can't this person see the thing they say they see, why do I have to
set up the same filters every morning.

| Somebody asks                                      | Reach for                                               |
| -------------------------------------------------- | ------------------------------------------------------- |
| "Who changed this price, and can we put it back?"  | [Record history](#record-history)                       |
| "The customer says the button is missing"          | [Impersonation](#impersonation)                         |
| "I set these filters up every single morning"      | [Saved views](#saved-views)                             |
| "Where did that logo go? I uploaded it last week"  | [The media library](#the-media-library)                 |
| "Can support see orders but not delete them?"      | [Roles and permissions](#roles-and-permissions)         |
| "I don't care about revenue, I care about tickets" | [A dashboard per person](#a-dashboard-per-person)       |
| "I edited it and my changes vanished"              | [Record locking](#record-locking)                       |
| "Am I on production right now?"                    | [The environment indicator](#the-environment-indicator) |

Most of these need somewhere to keep something, and where that is depends on your
app rather than on the panel. So each takes a small provider you supply, and none of
them appears in the UI until you do — a panel with nothing configured looks exactly
as it does today.

## Record history

Turn it on per resource:

```ts fragment
export class ProductResource extends Resource {
  static override history = true;
}
```

The view page grows a History card listing what changed, when, and by whom, with a
Revert button on each entry that can be undone. It reads from `@zerotal/audit`, so
you need that package recording the model — the panel does not keep a second trail of
its own, which would only be a second thing to disagree with the first.

Reverting restores the previous values of the fields that entry changed, not the whole
record as it was. That distinction matters: reverting a price change from three weeks
ago should not also undo the description somebody fixed yesterday.

## Impersonation

The support request nobody can reproduce is usually solved by seeing what the person
actually sees.

```ts fragment
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

Add `impersonateAction()` to the resource's row actions and the panel handles the
rest: it remembers who started the impersonation in the session, shows an amber banner
across the top while it is going on, and offers one link back. The original user is
remembered in the session rather than derived from the impersonated account, so
returning always works even if the account you switched into is broken.

Two rules are enforced rather than suggested. Impersonation never nests — a second one
on top of a first makes "stop" ambiguous, so it is refused. And `can("impersonate")`
decides per record, defaulting to refusing.

## Saved views

Every bit of list state already lives in the URL: search, filters, tab, sort, column
visibility, grouping, page size. So a saved view is a saved query string, and
restoring one is a link.

```ts fragment
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

A Views control then appears above every list, with a name box for saving the current
one. Page number is deliberately excluded from what a view stores: a view should
restore how a list was _shaped_, not which page of it somebody happened to be on.

## The media library

A file upload field puts a file somewhere and stores a path. That works until the same
logo is needed on twenty products, or somebody wants to know what is still pointing at
a file before deleting it.

```ts fragment
import { databaseMedia, mediaPicker } from "@zerotal/admin";

Panel.media(databaseMedia());
```

`databaseMedia()` expects a table with `path`, `name`, `mime`, `size`, `alt`, `folder`
and `uploaded_at`; the column names are adjustable, so an existing table usually needs
no migration. Supply your own `{ list, save, remove }` if the catalogue belongs
somewhere else.

Configured, the panel gains a Media page — a grid with upload, search, folder
filtering, alt-text editing and deletion — and forms can use the picker:

```ts fragment
mediaPicker("imageUrl").label("Image");
```

which offers the library in a modal, with upload-and-select in the same dialog.

The split between the two halves is deliberate. `zerotal/storage` holds the bytes;
the catalogue holds the record of them. Listing a bucket is not a substitute, because
it cannot tell you alt text, who uploaded something, or what it is for — and on a
large disk it is slow besides.

## Roles and permissions

Authorization already works without a UI: a resource's `can()` answers every question
the panel asks. What is missing is the other direction — seeing who can do what, and
changing it, without editing code.

```ts fragment
import { authRoles } from "@zerotal/admin";

Panel.roles(authRoles({ superusers: ["admin"] }));
```

`authRoles()` drives the role-based access control in `@zerotal/auth`, so the matrix
edits the same roles and permissions the app already checks against — ticking a box
makes a real check start passing. Supply your own `{ list, permissionsFor,
setPermissions }` if roles live elsewhere.

The permission catalogue is derived, not declared. The panel walks its registered
resources, pages and actions and reports every ability it actually checks:
`products.viewAny`, `products.delete`, the soft-delete abilities where the model has
them, and every custom action's key. A hand-maintained list drifts the moment somebody
adds a resource, and a matrix missing a row is worse than no matrix, because it
quietly implies the permission does not exist.

A role named as a superuser is shown holding everything and cannot be edited or
deleted from the panel. That is worth modelling explicitly rather than by ticking
every box, so an administrator does not silently lose access to a resource added next
week.

## A dashboard per person

What belongs at the top of a dashboard differs by role, and neither the finance lead
nor support wants to scroll past the other's widget every morning.

```ts fragment
Panel.dashboardLayout({
  async load() {
    return Auth.user()?.dashboard ?? null;
  },
  async save(layout) {
    await Auth.user()?.update({ dashboard: layout });
  },
});
```

An Arrange control appears on the dashboard, with move-up, move-down and hide per
widget, and a Reset that puts it back the way the app declares it. Name your widgets
with `.key("revenue")` if their titles might change — a layout keyed by title silently
resets the moment somebody rewords a heading.

This is order and visibility, not a drag-around canvas. Dragging boxes on a grid is a
lot of machinery to maintain and mostly produces layouts that break at the next screen
width; reordering and hiding covers what people actually ask for and stays responsive
by construction.

The declaration stays the source of truth for _which_ widgets exist. A widget added
since somebody last arranged their dashboard appears at the end, where it is
noticeable rather than lost, and a widget since removed does not come back because a
stale key mentions it.

## Record locking

Two people editing the same record is normal; one of them losing their work silently
is not.

```ts fragment
export class ProductResource extends Resource {
  static override optimisticLock = "version";
}
```

The form remembers the version it loaded, and a save against a stale one is refused
with a field error rather than going through. Refusing is the only safe answer here:
overwriting loses somebody's work, and merging blind is worse.

## The environment indicator

The expensive mistake is editing production believing it is staging.

```ts fragment
import { environmentIndicator } from "@zerotal/admin";

Panel.renderHook("body.start", environmentIndicator());
```

A coloured strip across the top names the environment — red for production, amber for
staging. It returns nothing in local development, so registering it unconditionally is
the intended usage; there is nothing to switch off per environment.

## Types

| Type                                        | What it is                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| `HistoryOptions`, `HistoryChange`           | Record history: what is tracked, and one entry of it.  |
| `ImportRecordsPayload`                      | What the import action hands your handler.             |
| `AdminNotification`, `StoredNotification`   | A panel notification, and the persisted form.          |
| `DatabaseNotificationOptions`               | Where those are stored.                                |
| `StoreMediaOptions`, `DatabaseMediaOptions` | Media handling and its database backing.               |
| `SearchHit`, `PanelSearchProvider`          | One global-search result, and where results come from. |
| `CalloutTone`                               | The emphasis a callout is drawn with.                  |

## Next steps

- [Panel Structure](/docs/admin/structure) — clusters, nested resources, multiple panels.
- [Extending the UI](/docs/admin/extending-ui) — render hooks, custom cells, table layouts.
- [Reference](/docs/admin/references) — the full API surface in one table.
