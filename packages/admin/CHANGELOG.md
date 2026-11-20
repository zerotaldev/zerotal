# Changelog — @zerotal/admin

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.17.0] — 2026-11-19

### Changed

- **BREAKING:** the panel is styled by Tailwind v4's browser build, through `@zerotal/flow-ui`'s
  head, instead of the Tailwind v3 Play CDN. An app must change two things if they apply: a
  Content-Security-Policy that allowed `https://cdn.tailwindcss.com` for the panel must allow
  `https://cdn.jsdelivr.net` instead, and custom pages, widgets or infolist entries that use v3
  class names whose meaning moved in v4 (`shadow-sm`, bare `ring`, `outline-none`,
  `bg-opacity-*`) need the v4 names listed in `@zerotal/flow-ui`'s changelog. The panel's own
  markup already uses them (`shadow-xs`, `outline-hidden`, `file:hover:`), so it looks the same,
  except that default borders in dark mode now take the dark `--border` token rather than a light
  grey and the amber, emerald and red accents use v4's palette.
- **BREAKING:** with `theme.stylesheet` set, `adminTokensCss()` and the head put the token border
  colour and the page colours in `@layer base`, so a Tailwind v4 stylesheet's utilities override
  them. `adminTailwindConfig()` sets `borderColor.DEFAULT` to the border token; an app whose
  Tailwind v3 stylesheet is built from its own config must add
  `borderColor: { DEFAULT: "hsl(var(--border))" }` under `theme.extend`, or dark-mode borders turn
  light grey.
- **`@zerotal/auth` and `@zerotal/orm` are dependencies.** The auth pages import auth, and the
  panel's provider uses the ORM's types, so both were needed already; they were declared as
  optional peers, which an isolated install does not provide. Every app installing the admin
  package already had the ORM through `@zerotal/flow`. Auth is still loaded only by the
  features that use it (the auth pages, the roles page, impersonation, the notification bell), so
  a panel without them does not register auth's models.
- **`@zerotal/notifications` and `@zerotal/audit` are declared optional peers**, alongside
  `@zerotal/queue`. They were imported without being declared. An app that uses database
  notifications, record history or queued imports installs the package itself.
- **BREAKING: a missing optional package now throws `OptionalPeerMissingError` with the install
  command, where it used to be silent.** `databaseNotifications()` without
  `@zerotal/notifications` showed an empty bell, a resource with `static history = true` without
  `@zerotal/audit` showed no history, and `importAction({ queue: true })` without
  `@zerotal/queue` imported inline. Each looked like it was working. Now the notifications page,
  every View page of a resource with history, and every queued import throw. The bell in the
  layout still fails soft. `dispatchImport()` throws too, where it returned `false`; it still
  returns `false` when the queue package is installed with no driver configured, so that case
  still falls back to an inline import. An app that used one of these options without the
  package must install it (`bun add @zerotal/notifications`, `bun add @zerotal/audit` or
  `bun add @zerotal/queue`) or remove the option. `bun zt doctor` names the first two.

### Added

- `adminTailwindCss()`: the theme as Tailwind v4 CSS, for a `theme.stylesheet` built with Tailwind
  v4 to match the CDN look. `adminTailwindConfig()` still returns the Tailwind v3 config.
- **`bun zt doctor` reports a panel feature whose package is missing.** The
  `admin-optional-packages` check fails when a panel uses `databaseNotifications()` without
  `@zerotal/notifications`, or registers a resource with `static history = true` without
  `@zerotal/audit`, and prints the install command. It loads the app's panel wiring
  (`app/admin.ts` or `app/admin/index.ts`) to see what the panel serves. Queued imports are not
  covered, because that option is only visible once a page builds its actions.

### Testing

- The optional-peer tests bundle their fixture into a directory rather than a single file, so they
  run on Bun 1.4 as well as Bun 1.3. Bun 1.4 writes the Flow browser bundles the panel imports as
  files of their own beside the entry, and refuses `--outfile` when there is more than one file to
  write.

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
