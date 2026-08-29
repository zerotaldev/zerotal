# Changelog — @zerotal/admin

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

### Changed

- **INTERNAL: the panel's own page machinery is marked `@internal`.** The `make*Page` factories,
  the page classes they produce (`ResourceListPage`, `RecordViewPage`, `ResourceFormPage`,
  `RolesPage`, `MediaPage`, `NotificationsPage`, `ConsolePage`, …), the action and widget
  renderers, and `AdminPanelHost`.

  **Nothing is removed and nothing breaks** — they are still exported and still work. An app
  declares a `Resource` and the panel builds these pages from it; none of them has a caller
  outside `@zerotal/admin` or a line in the guide, because writing one was never the way to use
  this package.

## [1.6.0] — 2026-08-15

### Fixed

- **The environment badge showed on every screen, and always said the same thing.** It read
  `APP_ENV`, which holds the runtime mode once the app has booted — so it rendered `web`,
  which is in nobody's quiet list, and its `staging` tone could never fire. A badge whose
  whole purpose is preventing "I thought this was staging" was displaying the same wrong word
  in every environment. It reads `deployEnv()` now, so local stays quiet and staging is
  visibly staging.

## [1.5.1] — 2026-08-15

### Fixed

- **The development bypass never applied.** `AdminGuardMiddleware` and the `ability` helper
  both read `APP_ENV` to decide whether this was a development environment — but by the time
  either runs, `setAppEnv()` has replaced it with the runtime mode. So the panel refused
  access in development exactly as it does in production, which is not what either was
  written to do. Both ask `devSurfacesEnabled()` now, and both still fail closed anywhere
  that is not explicitly a development environment.

## [1.5.0] — 2026-08-15

### Changed

- **The public surface is now an explicit decision rather than whatever happened to be
  exported.** 36 exports are marked `@internal` and leave the compatibility promise:
  layout plumbing (`applyLayout`, `reconcile`, `moveKey`), schema normalisation
  (`toFormLayout`, `toFormSections`, `flattenFields`, `flattenActions`), rule-tree
  internals (`parseRuleTree`, `describeRuleTree`, `ruleTreeIsEmpty`), predicates
  (`isImage`, `isUpload`, `isFormSection`), and the session/storage keys and defaults
  (`IMPERSONATOR_KEY`, `THEME_STORAGE_KEY`, `VIEW_PARAMS`, `DEFAULT_ADMIN_CONFIG`, …).

  None of these were ever meant to be API; they were exported because something else
  needed them. Deciding that **now** matters, because after `stable` narrowing the
  surface is itself a breaking change. The promise drops from 182 callables to 146.

- **Every remaining export is documented.** The reference gained sections for
  configuration and middleware, the row and bulk actions the guide had not reached
  (`restoreAction`, `forceDeleteAction`, `bulkEditAction`, `bulkRestoreAction`,
  `bulkForceDeleteAction`, `textFilter`), impersonation, the media helpers behind
  `mediaPicker`, import/export, history and permissions — each with its real signature
  read off the API surface rather than paraphrased. Coverage of the promised surface
  went from 58% to 100%.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest of
  the 1.x line. Every gate is closed: `@zerotal/flow` and `@zerotal/flow-ui` are stable
  underneath it, the internal/public boundary is explicit, and the documented surface is
  complete. The guard and ability middleware — the panel's security boundary — were
  already covered by tests, alongside 222 tests overall.

  This remains the largest surface in the monorepo at 146 callables, which is exactly
  why the `@internal` triage came first: freezing a smaller, deliberate surface is a
  promise worth making, where freezing everything that happened to be exported is not.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

### Added

#### Panel structure

- `Cluster` — a shared URL segment and one sidebar entry for a group of resources. Members opt in with `static cluster = ShopCluster`, and a cluster's `ability` gates every route inside it.
- Nested resources — `static parent = { resource: () => PostResource, foreignKey: "post_id" }` moves a resource under its parent's records (`/admin/posts/7/comments`). Every list is scoped to the parent before any tab or filter, and new records inherit the foreign key from the URL rather than from a form field.
- Singular resources — `static singular = true` collapses list, view and edit into one route for a one-row resource. The row is resolved on first visit and created from the form's defaults if absent.
- Multiple panels — `Panel.make(id, config)` creates an additional panel with its own resources, pages, widgets, guard, branding and URL prefix. `Panel` remains a facade over the panel owning the current request, so single-panel apps are unaffected.
- Resources build their own URLs: `routePath()`, `indexUrl()`, `recordUrl()`, `createUrl()`, `editUrl()`. Linking through these lets a resource move into a cluster or under a parent without any caller changing.

#### Tables

- `queryBuilder(key)` — a build-your-own filter with nested AND/OR rule groups, backed by `textConstraint` / `numberConstraint` / `dateConstraint` / `booleanConstraint` / `selectConstraint`. The whole tree is wrapped in one group so an inner `OR` cannot widen a tab, parent or soft-delete scope, and a rule naming an undeclared constraint is dropped.
- Active-filter indicators — a chip per filter narrowing the list, each its own undo.
- `filterLayout` — `"inline"` (default), `"panel"` or `"drawer"`.
- `tableLayout: "grid"`, `striped`, `stickyHeader`, `density`. The grid derives its cards from the columns already declared.
- `Resource.emptyState()` — a heading, description, icon and actions in place of a blank table. A narrowed view that matches nothing gets a different, automatic message.
- `Column.exportable(false)` keeps a column out of CSV exports.

#### Actions

- `exportAction()` / `bulkExportAction()` — CSV of the current list, matching its search, filters, tab and sort exactly.
- `importAction()` — CSV import through a two-step modal: pick a file, then map each column to a field. Mapping is seeded by matching headers to field names and labels. Rows are validated through the resource's own fields; failures are reported by line number and skipped.
- `importAction({ queue: true })` dispatches `ImportRecordsJob`, lifting the inline row cap. `@zerotal/queue` is resolved lazily and stays optional; with no queue configured the import runs inline.
- `actionGroup([...])` collapses several actions into one dropdown.
- `replicateAction()` copies a record and opens the copy, with `.excludeAttributes()` and `.beforeReplicaSaved()`.
- `Action.formUsing(fn)` builds a modal's fields from what it currently holds.

#### Infolists and forms

- `imageEntry`, `colorEntry`, `codeEntry`, `keyValueEntry`, `repeatableEntry` — the last renders a nested schema once per array item, the read side of `repeater`.
- `customField(key).render(fn)`, plus `.render()` on `Column` and `Entry`, for controls and cells the catalogue lacks. The renderer owns only the markup; label, validation, sorting and binding still come from the declaration.

#### Extensibility

- Render hooks — 14 named positions in the panel's chrome (`table.start`, `page.header.end`, `sidebar.end`, …). A hook returning `null` renders nothing; one that throws is logged and skipped. Available to packages through the `admin.panel` binding.
- `Resource.data()` — back a resource with an API, a file or a computation instead of a model. The panel filters, sorts and paginates in memory, so search, tabs and summaries keep working.
- `Resource.widgets()` — widgets above a resource's table, using the same builders as the dashboard.
- `databaseNotifications()` — a ready-made notification provider over `@zerotal/notifications`' `DatabaseChannel`, failing soft to an empty bell at every step.

#### Other

- Breadcrumbs derived from panel → cluster → parent record → resource → record.
- `.poll(interval)` on every widget kind; the dashboard refreshes at the shortest interval any of its widgets asked for.
- `bun zt make:admin-resource <Model>` with `--cluster`, `--parent`, `--foreign-key` and `--singular`.
- An `admin` template for `bun create zerotal`.

- `AdminProvider` also loads `app/admin/index.ts`, so a panel large enough to need a directory can have one. `app/admin.ts` still works and is tried first.
- `AdminProvider` now boots in the `console` environment as well, solely to register `make:admin-resource`; it mounts no routes there.
- `recordActions()`, `headerActions()` and `bulkActions()` return `ActionItem[]` — an action or an `ActionGroup`.
- `registerResourceForm()` is keyed by panel and slug, so two panels can each register the same resource slug.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
