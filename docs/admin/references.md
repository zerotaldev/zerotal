---
title: Admin References
description: Every resource, table, form, and action API in one table.
---

# References

## `Panel`

| Method                                   | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `Panel.configure(config)`                | Merge panel configuration.                        |
| `Panel.register(...resources)`           | Register one or more `Resource` classes.          |
| `Panel.pages(...pages)`                  | Register `AdminPage` subclasses.                  |
| `Panel.plugin(...plugins)`               | Install app-authored plugins.                     |
| `Panel.widgets(...widgets)`              | Register dashboard widgets.                       |
| `Panel.notifications(provider)`          | Wire the notification center.                     |
| `Panel.auth(config)`                     | Enable + configure the auth pages.                |
| `Panel.can(ability)`                     | Resolve an ability the way the panel does.        |
| `Panel.host()`                           | The contribution surface, bound as `admin.panel`. |
| `Panel.resources()` / `find(slug)`       | Inspect the resource registry.                    |
| `Panel.registeredPages()` / `findPage()` | Inspect the page registry.                        |
| `Panel.navigation()`                     | The full sidebar map, unfiltered.                 |
| `Panel.visibleNavigation()`              | The sidebar as the current user may see it.       |
| `Panel.make(id, config)`                 | Create an additional panel on its own path.       |
| `Panel.get(id)` / `Panel.all()`          | Inspect the panel registry.                       |
| `Panel.default()`                        | The panel every app starts with.                  |
| `Panel.current()`                        | The panel owning the request being served.        |
| `Panel.renderHook(name, fn)`             | Render into a named position in the chrome.       |
| `Panel.renderHooks(name)`                | The hooks registered at a position.               |

## `Resource` statics

`model`, `slug`, `label`, `pluralLabel`, `primaryKey`, `perPage`, `defaultSort`,
`eager`, `recordTitleAttribute`, `navigationIcon`, `navigationGroup`,
`navigationSort`, `navigationParentItem`, `navigationBadgeColor`, `reorderable`,
`defaultGroup`, `cluster`, `parent`, `singular`, `tableLayout`, `striped`,
`stickyHeader`, `density`, `filterLayout` — plus the methods `columns()`,
`form()`, `infolist()`, `filters()`, `tabs()`, `groups()`, `relations()`,
`recordActions()`, `headerActions()`, `bulkActions()`, `navigationBadge()`,
`emptyState()`, `widgets()`, `data()`, `can()`, and the lifecycle hooks above.

Each resource also builds its own URLs — `indexUrl(base)`, `recordUrl(base, id)`,
`createUrl(base)`, `editUrl(base, id)` and `routePath()`. Link through these rather
than assembling paths by hand, and a resource can move into a cluster or under a
parent without anything else changing.

## Generator

```bash
bun zt make:admin-resource Product
bun zt make:admin-resource Comment --parent=Post --foreign-key=post_id
bun zt make:admin-resource Setting --singular
bun zt make:admin-resource Order --cluster=ShopCluster
```

Writes `app/admin/<Name>Resource.ts`. Named `make:admin-resource` because
`make:resource` already belongs to the API transformer generator.

## Subpaths

| Import                   | Contents                                               |
| ------------------------ | ------------------------------------------------------ |
| `@zerotal/admin`         | Resources, columns, fields, actions, widgets, `Panel`. |
| `@zerotal/admin/auth`    | The opt-in auth page classes + `registerAuthRoutes`.   |
| `@zerotal/admin/testing` | `AdminTest` + the assertion helpers.                   |

## Deliberately deferred

Multi-tenancy and the 2FA challenge step are intentionally out of scope for now.

Everything else once listed here has landed: [clusters, nested and singular
resources, and multiple panels](/docs/admin/structure); [CSV and spreadsheet import
and export](/docs/admin/actions); the [visual query-builder
filter](/docs/admin/tables); [kanban, calendar and tree layouts, header filters and
translations](/docs/admin/extending-ui); and [record history, impersonation, saved
views, the media library, roles and per-user
dashboards](/docs/admin/operations).

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
