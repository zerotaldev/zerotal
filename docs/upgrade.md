---
title: Upgrade Guide
description: Move a Zerotal app to a newer release safely by bumping packages, applying breaking changes, and migrating.
---

# Upgrade Guide

This guide explains how to move a Zerotal app to a newer release. For the list of
what changed in each version, see the [Release Notes](/docs/changelog).

## Versioning

Zerotal follows semantic versioning across its `@zerotal/*` packages, which share a
version line:

- **Patch** (`x.y.Z`) — bug fixes, safe to take anytime.
- **Minor** (`x.Y.z`) — new features, backward compatible.
- **Major** (`X.y.z`) — breaking changes; read the version's section in the
  [Release Notes](/docs/changelog) before upgrading.

> **Warning** — always upgrade the `@zerotal/*` packages together. Mixing versions across core, ORM, and feature packages leads to type and runtime mismatches.

## Upgrade steps

1. **Bump the packages.** Update every `@zerotal/*` dependency to the target
   version, then reinstall:

   ```bash
   bun update            # within the ranges in package.json
   # or pin exact versions, then:
   bun install
   ```

2. **Review the breaking changes.** For a major release, work through its section in
   the [Release Notes](/docs/changelog) and apply each migration note.

3. **Run migrations.** A release may add framework tables or columns:

   ```bash
   bun zt migrate
   ```

4. **Type-check and test.** The fastest way to surface breaking API changes:

   ```bash
   bun run typecheck
   bun test
   ```

5. **Boot it.** Start the dev server and exercise the main flows:

   ```bash
   bun dev
   ```

## Pre-release checkout to 1.0

1.0 is the first public release, so there is no earlier published version to move
from. If you have been building against a pre-release checkout of the source,
these are the changes that need action. Full detail is in the
[1.0.0 release notes](/docs/changelog).

1. **Import storage from `@zerotal/core/storage`.** The separate
   `@zerotal/storage` package is gone — file storage ships inside core, as a
   subpath beside `core/logger` and `core/http`. Drop the dependency from
   `package.json` and update the imports:

   ```ts
   // before
   import { Storage, StorageProvider } from "@zerotal/storage";
   // after
   import { Storage, StorageProvider } from "zerotal/storage";
   ```

   Nothing else changes: the same `StorageProvider`, the same `config/storage.ts`,
   the same disks and driver API.

1. **Move public files to `storage/public`.** The public disk's root changed
   from `storage/app/public` to `storage/public`, and it is served at
   `/storage/public` rather than `/storage`. Everything else under the storage
   root is private: a local disk outside `storage/public` can only be served
   with `serve: { signed: true }`, and serving one openly now fails at boot.

   ```bash
   mv storage/app/public storage/public
   ```

   Any hardcoded `/storage/...` link becomes `/storage/public/...`. Better, ask
   for the URL instead: `await Storage.publicUrl(path, { disk: "public" })`.

1. **Expect logs on disk.** Every entry now goes to the terminal _and_ a
   date-rotated file under `./storage/logs`, kept 14 days. If you ship stdout to
   a collector and want no files, set `file: false` in `config/logging.ts`. If
   you had a `default: "daily"` channel to get files, you can delete it — and
   your terminal output comes back, since console is no longer a channel that
   `default` can point away from.

1. **Add a `fillable` (or `guarded`) list to every model written from user input.**
   Models now guard mass assignment by default — a model declaring neither rejects
   every attribute passed to `create()`/`fill()` with a `MassAssignmentError`. For
   trusted, non-user writes use `forceFill()`/`forceCreate()`, wrap a block in
   `BaseModel.withoutGuard(fn)`, or set `static unguarded = true`.

1. **Ensure `APP_KEY` is set in every environment.** `local` storage
   `temporaryUrl()` now throws `StorageKeyMissingError` instead of falling back to a
   hard-coded key, and a key under 32 bytes now throws at boot in production-like
   environments (`APP_ENV` = `production`/`prod`/`staging`). Generate one with
   `bun zt key:generate`.

1. **Update merged-package imports.** `@zerotal/lock` → `@zerotal/core/lock` and
   `@zerotal/logger` → `@zerotal/core/logger`; remove both from `package.json`.
   No API changes.

1. **Re-check ops-surface gates.** The devtools inspector, the monitor panel's
   default open access, and the dev error page now key off `APP_ENV` and **fail
   closed** — an unset or `staging` `APP_ENV` no longer exposes them. The admin
   panel and the monitor `/metrics` endpoint are now default-deny/opt-in. Set an
   explicit `middleware`/`auth` in `config/admin.ts` and `config/monitor.ts`, and
   set `APP_ENV=development` locally if you relied on the previous open-in-dev
   behaviour with an unset value.

1. **Redis cache prefix moved to `zerotal:cache:`.** If you run cache and queue on
   the same Redis DB, `Cache.flush()` no longer deletes queued jobs. Existing cache
   entries under the old `zerotal:` prefix are effectively invalidated on upgrade
   (they are simply not read again) — no action needed beyond expecting a cold cache.

## The managed zt.ts

`zt.ts` is framework-managed — the header says _do not modify_. If a release
changes the CLI entry point, re-scaffold it rather than hand-editing. Because you
never customized it, replacing the file is safe; your app lives in `app/`,
`bootstrap/`, `config/`, and `routes/`.

## Things to check after a major upgrade

- **Config shapes** — a `*Config()` factory may have new or renamed fields. Your
  editor's types will flag mismatches; re-check `config/*.ts` against the
  [Configuration](/docs/config-system) docs.
- **Provider registration** — confirm any package providers you list in
  `bootstrap/providers.ts` still export the same names.
- **Deprecations** — a minor release may log deprecation warnings for APIs removed in
  the next major. Resolve them before taking the major.
- **Lockfile** — commit the updated `bun.lock` so deploys install the same versions.

## Next steps

- [Release Notes](/docs/changelog) — per-version changes and migration notes.
- [Configuration](/docs/config-system) — config factories whose shapes may change.
- [Getting Started](/docs/getting-started) — the baseline project layout.
