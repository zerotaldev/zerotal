---
title: Contribution Guide
description: Get the Zerotal monorepo running locally and pass the checks your change needs to land.
---

# Contribution Guide

Zerotal is a Bun-native monorepo of composable packages. This guide covers getting the
repo running locally, the project layout, and the checks your change needs to pass.

> **Warning** — Bun ≥ 1.3.14 is required. Node.js is not supported; Zerotal uses `Bun.sql`, `Bun.CryptoHasher`, `Bun.build`, and other Bun-native APIs throughout.

## Getting set up

```bash
# in your project root
git clone <repo-url> zerotal
cd zerotal
bun install            # installs all workspaces
```

The repo is a Bun workspace (`packages/*` and `apps/*`), so a single `bun install` at
the root wires every package together via `workspace:*` links.

## Repository layout

```text
# repo root
packages/        # the framework — one directory per @zerotal/* package
  core/          #   IoC container, Application, router, HTTP pipeline, events, config
  orm/           #   models, migrations, query builder, relationships
  auth/  cache/  queue/  …  # feature packages
  testing/       #   factories, fakes, test app harness
  create-zerotal/ #   the `bun create zerotal` scaffolder
apps/            # applications in this workspace
  docs/          #   this documentation site
docs/            # the markdown documentation (what you're reading)
```

Each package owns its own `src/`, tests (`*.test.ts`), and `package.json`.

## The `@zerotal/core` public surface

`@zerotal/core` is deliberately split so importing the kernel doesn't drag in heavy or
rarely-used subsystems. The root barrel (`@zerotal/core`) exports **only the lean kernel** —
`Application`, the container, `RequestContext`, `HttpContext`/`Pipeline`, providers, errors,
events, the router, middleware, facades, `Command`, and the common helpers. Everything else
lives behind an explicit subpath:

```text
@zerotal/core            # kernel: Application, Router, HttpContext, Container, errors, events, middleware, helpers
@zerotal/core/carbon     # Carbon + intervals (pulls the Temporal polyfill — kept out of the kernel)
@zerotal/core/http       # outbound Http client, URL building/signing, uploads, API Resource, negotiation
@zerotal/core/view       # server-side JSX runtime + authoring helpers (SafeHtml, definePage, …)
@zerotal/core/env        # typed environment schema (EnvSchema, t, Def)
@zerotal/core/config     # ConfigManager/Loader + app config shapes (AppConfig, AppAssetsConfig, …)
@zerotal/core/security   # Crypt + Hash
@zerotal/core/dev        # dev-only build/reload tooling (owns Bun.build — inactive outside the dev worker)
@zerotal/core/assets     # asset() URL helper + versioning
@zerotal/core/health     # health checks
@zerotal/core/metrics    # HTTP request metrics
```

Rule of thumb when adding a public export to core:

- **Kernel** (hot, cheap, needed almost everywhere) → add it to `src/index.ts`, and add the name
  to the frozen list in `src/index.barrel.test.ts` (a deliberate, reviewed decision).
- **Belongs to a subsystem** (a specific concern, or it pulls a heavy dependency) → export it from
  that subpath's `src/<group>/index.ts` and register the subpath in `package.json` `exports`. Do
  **not** add it to the root barrel.

The `core barrel surface` guard test (`src/index.barrel.test.ts`) fails if the root barrel grows or
shrinks unexpectedly — that's the signal to pick one of the two paths above on purpose, so the
barrel never drifts back into a god-module.

## Everyday commands

Run from the repo root — they fan out across every workspace via `bun --filter`:

```bash
# in your project root
bun test            # run all package test suites
bun run typecheck   # type-check every package
bun run lint        # eslint
bun run format      # prettier --write
bun run build       # build every package
```

To work on a single package, run its script directly inside it:

```bash
# in your project root
cd packages/orm
bun test            # just the ORM suite
bun test src/db/QueryBuilder.test.ts   # a single file
```

> **Note** — tests run on Bun's built-in runner. Most database tests use SQLite (`:memory:` or a temp file), so they need no external services.

## Making a change

1. **Branch** off the default branch.
2. **Write the code and tests.** New behavior needs test coverage; bug fixes should
   add a regression test. Match the style of the surrounding code.
3. **Keep the public API typed.** Exported functions and classes should have accurate
   types — the `typecheck` task gates this.
4. **Run the checks** before pushing:

   ```bash
   # in your project root
   bun run typecheck && bun test && bun run lint
   ```

5. **Update the docs.** If you change or add public API, update the relevant page
   under `docs/` (and the nav in `apps/docs/app/routes/_layout.ts` if you add a page).

## Documentation changes

The docs are markdown files in `docs/`, served by the docs app in `apps/docs`. A page's
URL is its path: `docs/query-builder.md` → `/docs/query-builder`, and
`docs/orm/casts.md` → `/docs/orm/casts` (a directory's `index.md` serves the bare
slug). To add a page, create the markdown file and add an entry to the `NAV` array in
`apps/docs/app/routes/_layout.ts`.

When documenting an API, verify it against the package source rather than memory —
accuracy is the priority.

### One page, one subject

A page documents its own subject and nothing else. When a feature belongs to another
area, link to the page that owns it instead of re-explaining it here — a second copy
drifts out of date, and the reader who needs the detail is better served by the page
that keeps it complete.

- **Own it or link it.** Route-model binding is explained in [Routing](/docs/routing);
  every other page states that the model arrives resolved and links there. `HttpContext`
  members belong to [Requests & Context](/docs/context), not to whichever guide happens
  to show a handler.
- **Show the default, not the override.** If a param binds implicitly, the example
  registers a plain route. Configuration that only exists for the non-default case
  belongs on the page that owns the mechanism.
- **Prefer a pointer to a paraphrase.** One sentence naming the behaviour plus a link
  beats a condensed re-teaching that will disagree with the source page after the next
  change.
- **Package-authoring material goes to
  [Package Development](/docs/package-development)** — macros, driver contracts, and
  provider internals are not app-builder documentation.

The same rule governs a page's own length: a section that has grown into a second
subject is a sign it wants to be its own page, or to move to the one that owns it.

## Pull requests

- Keep PRs focused — one logical change per PR.
- Describe what changed and why; link any related issue.
- Make sure CI is green (`typecheck`, `test`, `lint`).
- Note any breaking change clearly so it can be captured in the
  [Release Notes](/docs/changelog).

## Next steps

- [Package Development](/docs/package-development) — building a `@zerotal/*`-style package.
- [Testing](/docs/testing) — the test harness, factories, and fakes.
- [Upgrade Guide](/docs/upgrade) — how releases are versioned.
