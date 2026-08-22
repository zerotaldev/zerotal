---
title: Admin Resources
description: Declare a resource and get list, create, edit, and view screens for a model.
---

# Resources

A `Resource` is a `static`-only class describing one model. Override the statics and
methods you need; everything has a sensible default.

Nothing instantiates a resource — the class itself is the configuration, read by the
panel when it builds a screen. That is why every member is `static`, and why a
resource can be imported and inspected anywhere without constructing anything.

Scaffold one with the generator, which writes `app/admin/<Name>Resource.ts`:

```bash
bun zt make:admin-resource Post
```

```ts fragment
class PostResource extends Resource {
  static model = Post;

  // Navigation
  static navigationIcon = "document";
  static navigationGroup = "Content";
  static navigationSort = 10;
  static navigationParentItem = "Blog"; // nest under another item's label
  static navigationBadgeColor = "primary";

  // Identity & data
  static slug = "posts"; // default: kebab-cased plural
  static label = "Post"; // default: from model name
  static pluralLabel = "Posts";
  static primaryKey = "id";
  static perPage = 15;
  static defaultSort = { column: "created_at", direction: "desc" };
  static eager = ["author"]; // relations to eager-load
  static recordTitleAttribute = "title"; // used by search / breadcrumbs

  // A live count badge in the sidebar
  static async navigationBadge() {
    return this.count((q) => q.where("status", "draft"));
  }

  static columns() {
    /* … */ return [];
  }
  static form() {
    /* … */ return [];
  }
  static infolist() {
    /* … */ return [];
  }
  static filters() {
    /* … */ return [];
  }
  static tabs() {
    /* … */ return [];
  }
  static groups() {
    /* … */ return [];
  }
  static relations() {
    /* … */ return [];
  }
}
```

A resource does nothing until the panel knows about it. Register it where the panel
is configured:

```ts fragment
Panel.register(PostResource);
```

Three of the statics are load-bearing in ways worth calling out. `slug` becomes the
URL segment, so changing it changes every link to the resource — set it once and
leave it alone. `eager` is the cure for a list page issuing one query per row: name
the relations your columns read and they are loaded up front.
`recordTitleAttribute` decides how a record names itself in breadcrumbs, global
search results, and relation pickers, so a resource without a meaningful one stays
hard to navigate even when every screen renders correctly.

Rather than assembling URLs by hand, ask the resource: `indexUrl(base)`,
`recordUrl(base, id)`, `createUrl(base)`, `editUrl(base, id)` and `routePath()`
build them for you, so a resource can move under a parent or into a cluster without
any of its links changing.

## Authorization

Override `can(ability, record?)` to gate the built-in actions. Abilities used by the
presets: `create`, `update`, `delete`, `restore`, `forceDelete`.

```ts fragment
static can(ability: string, record?: AdminRecord) {
  return Gate.allows(ability, record ?? this.model);
}
```

Delegating to `Gate` is usually the whole implementation, and it is the reason to
write policies once rather than per screen: the same rule then governs the list
page's row actions, the form's save button, and the bulk actions without being
restated in each. A denied ability hides the control rather than merely rejecting
the request, so the panel never offers a button that cannot work.

## Lifecycle hooks

| Hook                             | When                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `mutateFormDataBeforeFill(data)` | Transform a record into form state before Edit fills.    |
| `mutateBeforeSave(data, mode)`   | Transform validated form data just before create/update. |
| `afterSave(record, mode)`        | After a successful create/update (e.g. sync relations).  |

The first two are mirror images, and implementing them as a pair is what keeps a
field stored differently from how it is edited working in both directions —
splitting a stored `fullName` into two inputs on fill, rejoining them on save.

`mutateBeforeSave` runs _after_ validation, so its input is already valid and its
job is to shape data rather than sanitise it. `afterSave` receives the persisted
record, which is the moment to sync related rows: the record has an id by then,
including on create.

Both save hooks receive the `mode`, so one implementation can branch on `"create"`
versus `"edit"` instead of duplicating the resource.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Tables](/docs/admin/tables) — the columns, filters, and tabs declared above.
- [Forms & Infolists](/docs/admin/forms) — the fields the save hooks operate on.
