---
title: Inertia CLI & Build
description: The page registry, the bundler pipeline, and building for production.
---

# CLI & build

`@zerotal/inertia` ships generators for pages, routes and whole screens, a command to bundle
the frontend, and the page registry that ties component names to files.

## Generating a page

Scaffold a new page component under your pages directory (`resources/js/pages/` by default):

```bash
# in your project root
bun zt make:page dashboard
bun zt make:page tasks/index          # nested — creates resources/js/pages/tasks/index.tsx
```

The name is the one `Inertia.render()` uses. The page is written the way the starters write
theirs: a component named from the whole path (`tasks/index` becomes `TasksIndex`), a `Props`
interface with the `title` the starters' routes pass, and a `<Head>` that sets the document
title. It is formatted with your app's Prettier, so it passes `format:check` as written. The
framework (React `.tsx` or Vue `.vue`) is auto-detected from the Inertia adapter you
installed; force it with `--framework vue` or `--framework react`. After writing the file,
`make:page` regenerates the [page registry](#page-registry) automatically.

### The route that serves it — --route

Add `--route` to write the route that renders the page as well, so a new screen is served with
nothing written by hand:

```bash
# in your project root
bun zt make:page tasks/index --route
bun zt make:page tasks/edit --path "tasks/[task]/edit"
```

The route is a file route exporting `GET`, at the page's own path (`tasks/index` serves
`/tasks`), inside `app/routes/(auth)/(verified)/` when the app has that group, as the
starters' signed-in pages are. It renders the page with the `title` its props ask for.
`--path` writes it at another path, `[param]` segments included, and implies `--route`. A
route that already serves the path is left alone. Run `bun zt route:types` afterwards, so
`route()` knows the new name.

### Persistent layouts — --layout

A page is wrapped in an Inertia persistent layout (the layout mounts once and survives
client-side navigations; only the page content re-renders). By default that is `AppLayout`,
when the app has one in `Layouts/` or `layouts/` beside the pages directory, as the starters
do. Name another with `--layout`, or pass `--layout none` for a page with no layout:

```bash
# in your project root
bun zt make:page about --layout PublicLayout
bun zt make:page embed --layout none
```

A React page assigns a `.layout` function; a Vue page sets `layout` in `defineOptions()`. The
import is relative to the page. If the layout you name is not there, the command says so and
writes the page without one.

| Argument / flag | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `name`          | Page name, as `Inertia.render()` names it, e.g. `tasks/index` (required).                 |
| `--layout`      | The persistent layout: `AppLayout` by default when the app has one; `none` for no layout. |
| `--framework`   | Force `vue` or `react` (auto-detected from the installed adapter).                        |

## Generating a route

`make:route` writes a file route under `app/routes/`, in the starters' style: a `GET` that
renders its page with `Inertia.render()`, and a `POST` that validates with `r.*` rules,
flashes and redirects with a `303`. The argument is the file's path under `app/routes/`,
groups and parameters included:

```bash
# in your project root
bun zt make:route reports
# Created: app/routes/reports.ts
# Created: resources/js/pages/reports.tsx
# Serves /reports (GET, POST).

bun zt make:route "(auth)/(verified)/projects/[project]/archive" --methods POST
bun zt make:route "(auth)/billing" --methods GET --page settings/billing
```

The page `GET` renders is named as the starters name theirs, the path without groups and
parameters (`projects/[project]/edit` renders `projects/edit`), and it is written with
`make:page` when the app has none by that name. A `[param]` named after a model (`[project]`
for `Project`) arrives as the loaded record, a 404 when there is none, and when the app has the
model's policy each handler authorizes against it: `view` for `GET`, `update` for a write,
`delete` for `DELETE`. A write on such a route validates with a small `FormRequest` in the
file, as the starters' model routes do, since `validate(http, …)` takes a plain context. Where
the app has the starters' `rejectInput()`, the `POST` says how to fail a check `validate()`
cannot make. The page registry and `types/routes.generated.ts` are regenerated, so the new
route's name is known to `route()` and the file typechecks as written.

The route is only behind the groups you name: `make:route reports` is public, and
`make:route "(auth)/(verified)/reports"` is for signed-in, verified visitors, as `make:page
--route` and `make:resource --model` place theirs. A segment is a name (letters, digits, `-`,
`_`), a `(group)`, or a `[param]` whose name is an identifier, since the route reads it as
`http.params.<name>`. `make:route` refuses anything else, `.` and `..` included, and a
catch-all `[...rest]`, whose value does not arrive in `http.params`: write that route by hand.
It also refuses a URL another file already serves: `reports.ts`, `reports/index.ts` and
`(auth)/reports.ts` are one route.

| Argument / flag | Description                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `path`          | Its path under `app/routes/`, e.g. `reports` or `"(auth)/tasks/[task]/archive"` (required).    |
| `--methods`     | The handlers to export, comma-separated: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (`GET,POST`). |
| `--page`        | The page `GET` renders (default: the path without groups and parameters).                      |
| `--framework`   | Force `vue` or `react` for the page (auto-detected from the installed adapter).                |

## Generating a resource

`make:resource <Name> --model <Model>` writes a whole screen over one model, in the shape of
the starters' projects example: list, create, edit, update and delete.

```bash
# in your project root
bun zt make:resource Task --model Task
# Created: app/requests/TaskRequest.ts
# Created: app/policies/TaskPolicy.ts
# Created: app/routes/(auth)/(verified)/tasks/index.ts
# Created: app/routes/(auth)/(verified)/tasks/create.ts
# Created: app/routes/(auth)/(verified)/tasks/[task]/edit.ts
# Created: app/routes/(auth)/(verified)/tasks/[task]/index.ts
# Created: resources/js/lib/tasks.ts
# Created: resources/js/Components/TaskForm.tsx
# Created: resources/js/pages/tasks/index.tsx
# Created: resources/js/pages/tasks/create.tsx
# Created: resources/js/pages/tasks/edit.tsx
# Created: tests/tasks.test.ts
```

| File                                   | What it holds                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `tasks/index.ts`                       | `GET /tasks`, the list, ten to a page; `POST /tasks`, create.                 |
| `tasks/create.ts`                      | `GET /tasks/create`, the empty form.                                          |
| `tasks/[task]/edit.ts`                 | `GET /tasks/:task/edit`, the form filled in, named `tasks.edit`.              |
| `tasks/[task]/index.ts`                | `PUT` and `DELETE /tasks/:task`.                                              |
| `app/requests/TaskRequest.ts`          | The rules create and edit share. An existing one is used as it is.            |
| `app/policies/TaskPolicy.ts`           | Only the owner may see, change or delete. An existing one is used as it is.   |
| `resources/js/lib/tasks.ts`            | The record as the pages receive it, each enum's choices, the list's summary.  |
| `resources/js/Components/TaskForm.tsx` | The create and edit form.                                                     |
| `resources/js/pages/tasks/*`           | The list (with an empty state, pagination and a delete dialog), create, edit. |
| `tests/tasks.test.ts`                  | Every action end to end with `bootApp()`, and each page rendered once.        |

The routes go in the starters' signed-in group, `(auth)/(verified)/` (or `(auth)/`), when the
app has it. A model with an owner column (`userId`) is scoped to the signed-in user, as the
projects example is: the list reads only their records, a new one is theirs whatever the form
sends, and the edit, update and delete routes authorize against the policy, so anyone else gets
a 403. Without an owner column every signed-in user sees every record, and the command says so.

The form's fields are the model's mass-assignable columns, read from its `@column` lines:

| Column                                          | Input                                                 |
| ----------------------------------------------- | ----------------------------------------------------- |
| `string`                                        | A text field; required unless the column is nullable. |
| `text`                                          | A text area.                                          |
| `number`                                        | A number field.                                       |
| `boolean`                                       | A checkbox, starting from the column's `default`.     |
| `"date"`, or `cast: "date"`                     | A date field.                                         |
| Any other `Date` (`datetime`)                   | A `datetime-local` field, in the server's local time. |
| A union of string literals, or an alias for one | A select, starting from the column's `default`.       |

An enum's choices are read from the union in the model's file, written inline
(`"low" | "high"`), as an alias (`type Priority = "low" | "high"`) or as an alias over an
exported constant (`(typeof PRIORITIES)[number]`); with the constant, the request validates
against it, so the two cannot drift. A column no input edits (JSON, a custom cast) is left out,
and the command names it.

The pages are React or Vue, detected from the installed adapter (`--framework` forces one),
and are built from the starters' own components (`AppLayout`, `PageHeader`, `Card`, the `Field`
controls, `EmptyState`, `Modal`, `Pagination`); an app without them is told which are missing,
and nothing is written. Every file is formatted with the app's Prettier and imports the
framework through the `zerotal` bundle, and the page registry and route types are regenerated,
so `typecheck`, `format:check` and the new test pass as written. The command refuses, writing
nothing, when any file it would write is already there.

Without `--model`, `make:resource` writes an [API resource transformer](/docs/scaffolding#makeresource).
In a Flow app, the same screen is [`make:flow <Name> --crud --model <Model>`](/docs/flow#scaffolding-with-makeflow).

| Argument / flag | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `name`          | The resource, e.g. `Task`: its URL is the plural, `/tasks` (required).         |
| `--model`       | The model it lists and edits, read from `app/models/` (required for a screen). |
| `--framework`   | Force `vue` or `react` (auto-detected from the installed adapter).             |

## Building assets

Bundle the frontend with `Bun.build` and regenerate the page registry:

```bash
# in your project root
bun zt inertia:build         # development build (external source maps)
bun zt inertia:build -p      # production build (minified, no source maps)
```

The build:

- entrypoint `resources/js/app.tsx` → output `public/assets/`,
- targets the browser with **code splitting on** (each page becomes its own chunk
  from the registry's dynamic imports, so navigation only loads what it needs),
- auto-detects and applies CSS (and Vue) plugins present in your project — a `.vue`
  file under `resources/` without `@vue/compiler-sfc` installed stops the build with
  the command that adds it,
- prints a table of output files and sizes.

| Flag                 | Effect                                              |
| -------------------- | --------------------------------------------------- |
| `-p`, `--production` | Minify and drop source maps for a production build. |

Pair `inertia:build -p` with a hashed [asset version](/docs/inertia/middleware#asset-versioning)
in your deploy so clients reload onto the new bundle.

## Page registry

The page registry is a generated module (`resources/js/pages.generated.ts`) mapping each
component name (e.g. `"Users/Index"`) to a dynamic `import()` of its file. It's what lets
the client resolve `inertia("Users/Index")` to the right chunk, and what enables per-page
code splitting.

You rarely touch it directly — both `make:page` and `inertia:build` regenerate it.
To regenerate programmatically:

```ts
// in a build script
import { generatePageRegistry } from "@zerotal/inertia";

await generatePageRegistry(process.cwd());
```

Run it whenever you add or remove page files outside the generators (e.g. in a custom
build script) so the registry stays in sync with your pages directory.

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
