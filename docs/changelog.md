---
title: Release Notes
description: What changed in each tagged Zerotal release, and the steps needed to upgrade.
---

# Release Notes

Releases are recorded below, newest first. The `@zerotal/*` packages share a
single version line and follow [semantic versioning](/docs/upgrade#versioning).
Each package also keeps a detailed `CHANGELOG.md` of its own; this page is the
summary across the suite.

> **Tip** — For the mechanics of moving between versions — bumping packages, running migrations, and re-checking config — see the [Upgrade Guide](/docs/upgrade).

## How to read these notes

Each version lists changes under three headings:

- **Added** — new features and APIs (safe to adopt incrementally).
- **Changed** — behavior changes; **breaking** ones are called out explicitly and
  appear only in major releases.
- **Fixed** — bug fixes.

Patch and minor releases are backward compatible. Before taking a **major** release,
read its section here and apply each migration note.

## 1.3.0 — 2026-08-09

### Changed — BREAKING

- **Mixin composition is now a static on the base class.** `ComponentWith(...)` and
  `BaseModelWith(...)` are removed; write `Component.using(Pagination)` and
  `Model.using(Authenticatable, Roles)` instead. A codemod ships in the repository
  (`scripts/codemod-mixin-composition.ts`) that rewrites call sites and imports. How mixins are
  _authored_ is unchanged. `using` also composes onto intermediate bases
  (`AdminPage.using(Pagination)`) and chains (`.using(a).using(b)`), neither of which the old
  helpers could express.
- **`Model` is the canonical ORM base-class name.** `BaseModel` remains exported as an alias for
  the same class, so existing code keeps working; docs and scaffolding now say
  `class User extends Model`.

### Added

- **`@zerotal/media`** — attach files to models with `Model.using(Media)`: collections with
  acceptance rules and retention, image conversions on `Bun.Image` (or `sharp`), responsive
  `srcset()` ladders with inline placeholders, queued conversion jobs, `MediaFake` test
  assertions, and `media:clean` / `media:regenerate` commands. See [Media Library](/docs/media).

### Fixed

- **Flow: an `@expose`d action on a shared page base could vanish from the action allowlist**
  (and be fatally rejected at runtime) whenever a subclass declared a decorated field — a Bun
  1.3.x decorator defect, worked around in the framework. `@expose`, `@task`, `@renderless`,
  `@on` and `@computed` were all affected.

## 1.1.0 — 2026-08-08

### Changed

- `FlowTest.call()` rethrows action errors and `FlowTest.set()` re-renders, so tests fail on
  broken actions instead of passing silently. A handler pointing at an un-`@expose`d method is
  now a build error (fatal at boot in CSP-safe mode).
- `@column("text")` maps to a real `TEXT` type rather than `VARCHAR` — affects newly generated
  tables and migrations only.

### Fixed

- Radio-group binding, reactive sibling attributes suppressing `value` bindings, modifier click
  handlers, `request().ip()` inside actions, a data-corrupting `json` cast on numeric-looking
  strings, and an unparseable `make:model` stub.

## 1.0.4 — 2026-08-07

- Fixed the Flow starter rendering unstyled (stylesheet path mismatch) and its missing favicon.

## 1.0.3 — 2026-08-06

- Re-released so npm build provenance resolves against the renamed repository.

## 1.0.2 and earlier — 2026-08-06

- First published versions of Zerotal.

## Next steps

- [Upgrade Guide](/docs/upgrade) — apply the migration notes for a new release.
- [Contributing](/docs/contributing) — how changes land before they reach this list.
