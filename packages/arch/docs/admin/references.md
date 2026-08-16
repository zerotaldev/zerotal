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

## Configuration and middleware

| Export                   | Signature                                                   | Description                                                                              |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AdminConfig`            | `(options?: Partial<AdminConfigShape>) => AdminConfigShape` | Build `config/admin.ts` with defaults filled in, the same shape `Panel.configure` takes. |
| `AdminGuardMiddleware`   | middleware class                                            | Gates every panel route behind the configured auth check.                                |
| `AdminAbilityMiddleware` | middleware class                                            | Enforces the resolved ability for the route being served.                                |
| `adminHead`              | `(title?, theme?) => string`                                | The panel shell's `<head>` markup, for use as `Layout.head` in a custom layout.          |

## Row and bulk actions

The [Actions guide](/docs/admin/actions) covers `createAction`, `editAction`,
`viewAction`, `deleteAction`, `replicateAction`, `importAction`, `exportAction` and
`impersonateAction`. The rest of the built-ins:

| Export                  | Signature                 | Description                                                                 |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `restoreAction`         | `() => Action`            | Restore a soft-deleted record. Pair with `Model.using(SoftDeletes)`.        |
| `forceDeleteAction`     | `() => Action`            | Permanently delete a soft-deleted record, bypassing the trash.              |
| `bulkEditAction`        | `(fields?: string[])`     | Edit the named fields across every selected record in one form.             |
| `bulkRestoreAction`     | `() => Action`            | Restore every selected soft-deleted record.                                 |
| `bulkForceDeleteAction` | `() => Action`            | Permanently delete every selected record.                                   |
| `textFilter`            | `(key: string) => Filter` | A free-text filter on one column, alongside `selectFilter`/`ternaryFilter`. |

`RelationManager` is the base class a resource's `relations()` returns; see
[Actions & Relations](/docs/admin/actions).

## Impersonation

Backing the `impersonateAction` button, for wiring it into your own UI. Each returns
a `[true]` / `[false, reason]` pair rather than throwing, so a refusal is a value you
can render.

| Export               | Signature                                        | Description                                         |
| -------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `startImpersonating` | `(userId) => Promise<[true] \| [false, string]>` | Become another user, remembering the original.      |
| `stopImpersonating`  | `() => Promise<[true] \| [false, string]>`       | Return to the original user.                        |
| `isImpersonating`    | `() => Promise<boolean>`                         | Whether the session is currently impersonating.     |
| `impersonatedName`   | `() => Promise<string \| null>`                  | The impersonated user's display name, for a banner. |

## Media

The pieces behind `mediaPicker` and the media library, for driving uploads yourself.

| Export            | Signature                                                           | Description                                                |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `storeMedia`      | `(file, options) => Promise<[true, MediaItem] \| [false, string]>`  | Store an upload and record it against the provider.        |
| `deleteMedia`     | `(item, { provider, disk? }) => Promise<[true] \| [false, string]>` | Remove a stored item and its record.                       |
| `mediaUrl`        | `(item, disk?) => Promise<string \| null>`                          | A browser-fetchable URL, signed when the disk requires it. |
| `mediaPath`       | `(name, folder?) => string`                                         | The storage path a given file name resolves to.            |
| `resolveMediaSrc` | `(value, disk?) => string \| null`                                  | Turn a stored field value into an `src`, or `null`.        |
| `formatSize`      | `(bytes: number) => string`                                         | Human file size — `1.4 MB`.                                |
| `databaseMedia`   | provider                                                            | The built-in provider storing media rows in your database. |

## Import and export

| Export             | Signature                                                        | Description                                                                       |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `importCsv`        | `(resource, csv, mapping?, { limit? }) => Promise<ImportResult>` | Import rows into a resource, honouring the column mapping.                        |
| `parseCsv`         | `(text) => string[][]`                                           | Parse CSV text into rows of cells.                                                |
| `toCsv`            | `(rows, columns) => string`                                      | Render rows as CSV using a resource's columns.                                    |
| `toXlsx`           | `(rows, columns, { sheet? }) => Uint8Array`                      | Render rows as a spreadsheet.                                                     |
| `dispatchImport`   | `(payload) => Promise<boolean>`                                  | Queue an import; `false` when no queue is bound, so the caller can run it inline. |
| `runQueuedImport`  | `(payload) => Promise<ImportResult>`                             | Run a queued import — exported so an app can drive it from its own job class.     |
| `ImportRecordsJob` | job class                                                        | The built-in job `dispatchImport` enqueues.                                       |

## Builder classes

You build these through their factories rather than constructing them; the class
names matter only when you want to annotate a variable or a return type.

| Class           | Built by                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `Constraint`    | `textConstraint()`, `numberConstraint()`, `dateConstraint()`, `selectConstraint()`, `booleanConstraint()` |
| `FormSplit`     | `split(sections)` — side-by-side form sections                                                            |
| `Prime`         | `prime(text)`, `primeHtml(html)`, `primeImage(src)` — static display blocks in a schema                   |
| `PanelInstance` | `Panel.make(id, config)`, `Panel.get(id)`, `Panel.current()`                                              |

The same holds for `Section`, `Tab`, `FormSection`, `FormTab`, `FormTabs`, `Wizard`,
`WizardStep`, `Stat`, `Callout`, `ActionGroup`, `BuilderBlock`, and the dashboard
widgets `StatsWidget`, `ChartWidget` and `TableWidget` — each is the return type of
the like-named factory documented in its own guide.

## History and permissions

| Export             | Signature                                | Description                                                                                        |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `recordHistory`    | `(options) => Promise<HistoryEntry[]>`   | A record's audit history, newest first; empty rather than throwing when the audit table is absent. |
| `panelPermissions` | `(panel: PanelInstance) => Permission[]` | Every permission a panel checks, derived from what it has registered — use it to seed roles.       |
| `roleHas`          | `(role, held: string) => boolean`        | Whether a role holds a permission; a superuser holds everything by definition.                     |
| `authRoles`        | roles helper                             | The role set the auth pages recognise.                                                             |

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
