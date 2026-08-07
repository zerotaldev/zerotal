---
title: Release Notes
description: What changed in each tagged Zerotal release, and the steps needed to upgrade.
---

# Release Notes

**Zerotal has not been released yet.** `1.0.0` will be the first published version,
so there is nothing to report here and no upgrade steps to follow. Everything in
the docs describes the current state of the source, not a change from an earlier
release.

Once releases begin they are recorded below, newest first. The `@zerotal/*`
packages share a single version line and follow
[semantic versioning](/docs/upgrade#versioning).

> **Tip** — For the mechanics of moving between versions — bumping packages, running migrations, and re-checking config — see the [Upgrade Guide](/docs/upgrade).

## How to read these notes

Each version lists changes under three headings:

- **Added** — new features and APIs (safe to adopt incrementally).
- **Changed** — behavior changes; **breaking** ones are called out explicitly and
  appear only in major releases.
- **Fixed** — bug fixes.

Patch and minor releases are backward compatible. Before taking a **major** release,
read its section here and apply each migration note.

<!--
Add a section per release as you tag it, newest first, e.g.:

## 1.2.0 — 2026-07-01

### Added
- `Model.query().cursorPaginate()` for keyset pagination.

### Changed
- …

### Fixed
- …
-->

## Next steps

- [Upgrade Guide](/docs/upgrade) — apply the migration notes for a new release.
- [Contributing](/docs/contributing) — how changes land before they reach this list.
