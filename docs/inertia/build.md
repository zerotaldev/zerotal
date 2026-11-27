---
title: Inertia CLI & Build
description: The page registry, the bundler pipeline, and building for production.
---

# CLI & build

`@zerotal/inertia` ships two commands — one to scaffold page components, one to
bundle them — plus the page registry that ties component names to files.

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
