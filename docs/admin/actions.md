---
title: Admin Actions & Relations
description: Row, bulk, and page actions, related-record managers, and soft-delete handling.
---

# Actions

Actions power the row, header, and bulk buttons. The defaults are
`viewAction()/editAction()/deleteAction()` (rows), `createAction()` (header), and
`bulkDeleteAction()` (bulk) — override the corresponding methods to customize.

```ts fragment
import { action, editAction, deleteAction, textInput } from "@zerotal/admin";

static recordActions() {
  return [
    editAction(),
    action("publish")
      .label("Publish").icon("check-circle").color("success")
      .requiresConfirmation("Publish this post?")
      .authorize((rec) => this.can("update", rec))
      .run(async (ctx) => { await ctx.record.publish(); }),
    deleteAction(),
  ];
}
```

A row with more than three visible actions collapses the surplus into an overflow
menu. Actions can also open a **modal form**:

```ts fragment
action("assign")
  .label("Assign reviewer")
  .form([ select("reviewer_id").options(reviewers).required() ])
  .run(async (ctx) => { await ctx.record.assign(ctx.data.reviewer_id); }),
```

`.run(ctx)` receives `{ resource, record?, ids?, data?, parentId?, listOptions? }`
(row / header / bulk).

## Action groups

A row with seven buttons is unreadable. `actionGroup` collapses several into one
labelled dropdown, so the row keeps the two people reach for and files the rest:

```ts fragment
import { actionGroup, replicateAction, deleteAction } from "@zerotal/admin";

static recordActions() {
  return [
    viewAction(),
    editAction(),
    actionGroup([
      replicateAction(),
      action("archive").label("Archive").icon("folder").run(…),
      deleteAction(),
    ]).label("More"),
  ];
}
```

Members are gated individually — a group whose every member is hidden draws
nothing. Groups work in the header and the bulk toolbar too.

## Replicate

`replicateAction()` copies a record and opens the copy for editing. The primary key
and timestamps are always dropped; name anything else that must stay unique:

```ts fragment
replicateAction()
  .excludeAttributes(["sku", "slug"])
  .beforeReplicaSaved((data) => ({ ...data, name: `${data.name} (copy)`, status: "draft" })),
```

## Import and export

```ts fragment
import { exportAction, importAction, bulkExportAction } from "@zerotal/admin";

static headerActions() {
  return [createAction(), exportAction(), importAction()];
}

static bulkActions() {
  return [bulkExportAction(), bulkDeleteAction()];
}
```

**Export** writes the current list as CSV — the same search, filters, tab and sort
the user is looking at, not the whole table. Someone who has narrowed a view to the
twelve rows they care about expects twelve rows in the file. `bulkExportAction()`
exports the selection instead.

Pass `"xlsx"` for a spreadsheet instead:

```ts fragment
return [createAction(), exportAction(), exportAction("xlsx")];
```

CSV stays the better interchange format and the default. The workbook is for the case
CSV genuinely cannot serve: a recipient who opens the file, finds `007` turned into
`7` and a leading `=` treated as a formula, and reasonably calls the export broken.
Cells are written with real types, so dates sort as dates and numbers total, and the
header row is frozen with a filter over the used range.

Keep a column out of the file with `.exportable(false)`. Pay, internal notes and
anything else that should not travel in a spreadsheet belongs behind that flag:

```ts fragment
text("salary").exportable(false),
```

**Import** takes a CSV through a modal in two steps on one screen: pick a file,
then confirm which field each of its columns feeds. The selects start on whatever
the headers match — case, spaces, underscores and hyphens are all treated the
same — so a file the panel exported needs no adjustment, and a file from
somewhere else needs only the columns that didn't line up. Mapping a column to
"skip" leaves it out.

Every row is validated through the resource's own fields, so an import cannot write
anything a person could not have typed into the create form. A row that fails is
reported by line number and skipped; one bad line out of five hundred does not
discard the other four hundred and ninety-nine.

### Large files

An import runs inline by default, capped at 2,000 rows — a synchronous import
holds a WebSocket round-trip open, and a bigger file looks like a hang. Hand it
to a queue instead and the cap lifts:

```ts fragment
static headerActions() {
  return [createAction(), exportAction(), importAction({ queue: true })];
}
```

The worker needs to be able to rebuild the job from its payload, so register the
class where it can see it:

```ts
import { JobRegistry } from "@zerotal/queue";
import { ImportRecordsJob } from "@zerotal/admin";

JobRegistry.register(ImportRecordsJob);
```

With no queue configured, a queued import falls back to running inline rather
than silently doing nothing. `@zerotal/queue` stays an optional peer: it is
imported only when an import is actually queued.

## Relations

Relation managers appear as tables on the View page.

```ts fragment
import { hasMany, belongsToMany } from "@zerotal/admin";

static relations() {
  return [
    // Children referencing the parent — full CRUD links into their own resource.
    hasMany(CommentResource, "post_id").title("Comments"),

    // Many-to-many — attached rows with Detach + an Attach picker + pivot columns.
    belongsToMany(TagResource, "tags")
      .pivotColumns([{ key: "added_at", label: "Added" }]),
  ];
}
```

`belongsToMany(Resource, "tags")` drives the parent model's `tags().attach()` /
`tags().detach()` / `tags().get()`.

## Soft deletes

When the model uses the ORM `SoftDeletes` mixin, the List page gains an
**Active / All / Trashed** switch and the row + bulk actions gain Restore and
Force-delete automatically — no extra configuration.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
