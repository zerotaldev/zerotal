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
bun zt make:page Dashboard
bun zt make:page Users/Index          # nested — creates resources/js/pages/Users/Index.tsx
```

The generated stub wires up `usePage()` for typed access to shared props and a couple
of starter links. The framework (React `.tsx` or Vue `.vue`) is auto-detected from
the Inertia adapter you installed; force it with `--framework vue` or `--framework react`.
After writing the file, `make:page` regenerates the [page registry](#page-registry)
automatically.

### Persistent layouts — --layout

Pass `--layout` to wrap the page in an Inertia persistent layout (the layout mounts
once and survives client-side navigations; only the page content re-renders):

```bash
# in your project root
bun zt make:page Settings --layout MainLayout
```

This emits a page that assigns a `.layout` function and imports the layout from a
`layouts/` directory relative to the page. Adjust the import path if your layouts live
elsewhere — the generator prints a reminder.

| Argument / flag | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `name`          | Page name, e.g. `Dashboard` or `Users/Index` (required).           |
| `--layout`      | Wrap the page in a persistent layout component.                    |
| `--framework`   | Force `vue` or `react` (auto-detected from the installed adapter). |

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
- auto-detects and applies CSS (and Vue) plugins present in your project,
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
