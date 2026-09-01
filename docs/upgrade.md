---
title: Upgrade Guide
description: Move a Zerotal app to a newer release safely by bumping packages, applying breaking changes, and migrating.
---

# Upgrade Guide

This guide explains how to move a Zerotal app to a newer release. For the list of
what changed in each version, see the [Release Notes](/docs/changelog).

## Versioning

Zerotal's `@zerotal/*` packages share one version line, and what each number means
is set by how much the framework still moves in a year rather than by the letter of
semver:

- **Patch** (`x.y.Z`) — anything that does not break. Fixes, and features too.
  Safe to take at any time.
- **Minor** (`x.Y.z`) — a breaking change. Always labelled **BREAKING** in the
  [Release Notes](/docs/changelog), with the reason and the migration steps, and
  given its own section on this page.
- **Major** (`X.y.z`) — an annual consolidation, cut each July. The next is 2.0, in
  July 2027.

Why not strict semver: a framework this young corrects itself often, and under
strict semver every correction is a major. A version line that reaches 9.0 in its
first year tells a reader nothing about how much has changed — only that the
project is willing to break things, which the release notes already say far more
precisely. Keeping the major for a yearly line in the sand leaves it meaning
something, and puts the work where it is useful: reading the notes for each minor.

> **Warning** — **a caret range crosses a minor.** `"zerotal": "^1.10.0"` will
> install 1.11.0, and its breaking change, without asking. Read the notes for every
> minor you cross, or pin with a tilde (`~1.10.0`) and cross them deliberately.

> **Warning** — **a tilde still crosses a patch**, and under this scheme a patch carries
> features. `~1.13.2` means `>=1.13.2 <1.14.0`, so it takes 1.13.3 without asking. That is
> the right default for most apps and it is weaker protection than the same range gives
> under strict semver, where a patch is only ever a bug fix. If you need the version to
> hold exactly where you put it — a release you have certified, a machine you cannot
> re-test quickly — pin the exact version with no range operator at all.

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
   `Model.withoutGuard(fn)`, or set `static unguarded = true`.

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

## 1.4 to 1.5

1. **Move query values into `route()`'s third argument.** A param that matches no
   `:segment` used to be appended to the query string, so a typo'd param name produced
   a wrong URL instead of an error. Params are now exact, and an unknown key throws:

   ```ts
   route("search", { q: "zerotal", page: 2 }); // before
   route("search", {}, { q: "zerotal", page: 2 }); // now
   ```

   The same applies anywhere params are passed on their own — `redirect().to(name, params)`,
   `redirectTo()`, `Url.route()`, `Uri.route()`, and Flow's `redirectRoute()`. Where those
   need a query string, build the URL with `route()` and redirect to it.

   To find them: search for `route(` calls whose second argument holds a key that is not a
   `:segment` of that route. `bun zt route:list` prints the patterns to check against, and
   after step 2 the type-checker finds the rest for you.

2. **Generate and commit the route types** — this is what turns the change above from a
   runtime error into a compile error, and it is the point of the release:

   ```bash
   bun zt route:types      # writes types/routes.generated.ts
   ```

   Commit the file. `zt dev` refreshes it on every restart; add
   `bun zt route:types --check` to CI so it cannot go stale. Skipping this step is
   supported — `route()` then behaves exactly as it did, minus the query-param change.

3. **Rebuild the Inertia page registry** to get typed page names and props:

   ```bash
   bun zt inertia:build
   ```

   Then fix what it finds. Two are worth expecting: a page whose component declares a prop
   the controller never passes (add it, or make the prop optional), and a `defer()`/
   `optional()` prop the component declares as required (make it `?` — it really is absent
   on first paint). Declare any `Inertia.share()` keys of your own on the `SharedProps`
   interface so pages that read them do not look unpassed; see
   [Typed props](/docs/inertia/props#typed-props).

## 1.9 to 1.10

Three settings changed meaning. Each is quiet if it does not apply to you, and each is
worth thirty seconds of checking if it does.

1. **`scheduler.timezone` is honoured.** It was documented as informational and read by
   nothing, so whatever you put there had no effect and your schedules ran in the
   server's zone. It is now the zone every schedule is evaluated in unless the task sets
   its own.

   Its default moved from the literal `"UTC"` to **the system zone**, so an app that never
   set the key keeps doing exactly what it did. The case to check is an app that _did_:

   ```ts fragment
   // config/scheduler.ts
   export default SchedulerConfig({ timezone: env("APP_TIMEZONE", "UTC") });
   ```

   On a server that is not on UTC, that line used to do nothing and now moves every
   schedule. Either set it to the zone you actually want your crons read in — which is
   the point of the setting — or delete the key to keep the server's zone.

   `bun zt schedule:list` prints each task's next run in its own zone, which is the
   quickest way to see whether anything moved.

2. **Named rate limiters need `.trustedProxies(n)` behind a proxy.** `RateLimiter`'s
   `.byIp()`, `.byUser()` and `.byApiKey()` ignored the proxy count entirely and read
   `X-Forwarded-For` unconditionally. They now follow the same rule `ThrottleMiddleware`
   already did — the header is consulted only when you say how many proxies sit in front:

   ```ts fragment
   RateLimiter.for("login").limit(5).every(60).byIp().trustedProxies(1).register();
   ```

   Without it the address used is the socket's, which behind a proxy is the _proxy's_, and
   every visitor shares one bucket. `bun zt doctor` reports any limiter that needs this —
   it could not before, because its check exempted custom key resolvers and all three of
   these are one.

3. **React apps using SSR need `@inertiajs/react` installed.** The same adapter your
   browser entry point already uses. Server-side rendering now goes through its `<App>`,
   which is what makes `<Head>` produce a title and an og: card in the HTML your server
   actually sends. If it is missing you get a named error at render time, not a silent
   omission.

   Nothing to change if you already have it as a dependency, which every React Inertia app
   does.

## 1.10 to 1.11

Two changes to how the database is treated. Both are **BREAKING** in the narrow sense
that a working app can stop working on upgrade, and both refuse loudly rather than
doing something quiet.

1. **SQLite enforces foreign keys.** `database.sqlite.foreignKeys` defaults to `true`,
   so `PRAGMA foreign_keys = ON` is set on every connection. Until now SQLite ignored
   them, which meant `constrained()` and `cascadeOnDelete()` in your migrations
   described behaviour the database would not perform — deleting a parent left its
   children, silently.

   The risk is data you already have. A child row whose parent is missing was legal
   without enforcement and is a constraint violation with it, so a write touching one
   now fails. Find them before deploying:

   ```bash fragment
   bun zt db:check-foreign-keys
   ```

   It lists every offending row by table and rowid and exits non-zero, so a release
   script can gate on it. `zt doctor` reports the same thing. Delete them or repoint
   them at a parent that exists.

   To take the release without dealing with it yet:

   ```ts fragment
   // config/database.ts
   export default DatabaseConfig({ sqlite: { foreignKeys: false } });
   ```

   Take that override back off afterwards. With it in place `cascadeOnDelete()` is a
   comment.

2. **A renumbered migration is refused rather than re-run.** A migration is recorded
   under its filename, so renaming one makes an applied migration look pending — the
   runner tries it again and fails on `table already exists`. Renumbering `001_` to
   `0001_` to match the scaffold's convention is exactly the kind of tidying that
   causes it, and it takes every migration with it.

   `migrate` now recognises that shape and stops:

   ```
   "0001_create_users" looks like "001_create_users", which has already run — the
   same migration renumbered rather than a new one.
   ```

   If you meant to rename, pin the identity to what the database already holds and the
   filename is then free:

   ```ts fragment
   export default class CreateUsers extends Migration {
     static override id = "001_create_users";
   }
   ```

   If it really is a new migration, give it a name that does not collide once the
   leading digits are removed.

## 1.13 to 1.14

One breaking change, and it is small in practice.

**`inertia.ssr: true` no longer registers `POST /__ssr`.** Rendering and the endpoint are
separate decisions now:

```ts fragment
// config/inertia.ts — before
export default InertiaConfig({ ssr: true }); // rendered, and opened the route

// after
export default InertiaConfig({ ssr: true }); // renders, and opens nothing
export default InertiaConfig({ ssrEndpoint: true }); // opens the route, for an
// external renderer
```

**Most apps need no change.** If you set `ssr: true` for server rendering — which is what
the option is for — you keep exactly that, and you stop exposing a route you were not
using. The endpoint had no in-process caller before 1.13.5, so an app that set the flag was
getting the route and nothing else.

**Add `ssrEndpoint: true` only if something outside the web process calls `/__ssr`** — a
separate renderer, a second host. If you are not running one, you were not using it.

Why split them: turning rendering on should not open a route that renders arbitrary
components from POST input, however well guarded. One switch, one thing.

## 1.12 to 1.13

Three retirements in one crossing, deliberately together: each is a small migration, and
three minors each asking an app to move costs more than one that asks properly. `zt upgrade`
does the mechanical half.

```bash fragment
bun zt upgrade --to 1.13.0
```

### `Component.client(…)` is removed — use the `$` tagged template

The reason this did not wait: `client()` took a **string** and queued it to be evaluated in
the browser, so the caller owned the escaping. Its own docblock had to say _never interpolate
unescaped user input_, which is a warning about a footgun rather than a design. `$` is a
tagged template, so every `${…}` is encoded as a JS literal before it reaches the page.

```ts fragment
// in a component class body — before
this.client(`$refs.titleInput.focus()`);
this.client(`toast(${JSON.stringify(this.search)})`); // escaping was yours to remember

// after
this.$`$refs.titleInput.focus()`;
this.$`toast(${this.search})`; // encoded for you
```

The codemod rewrites a call whose argument is a single literal. **A call whose argument is a
variable or a concatenation is reported rather than rewritten**, because those are exactly the
ones the security note was about — and wrapping the finished string as `` $`${expr}` `` would
encode it as a string literal and stop running it as code. Read those and interpolate through
`$` instead.

Removing it also frees `client` as a property name on your components, the way removing
`title` did in 1.7.3.

### `LockDriver.extend()` is required

Only affects a **custom lock driver**; the three built-in ones already implement it.

It shipped optional in 1.5.0 with `acquire(key, owner, ttl)` as the fallback, and the fallback
was correct only by coincidence: `acquire` happens to be an owner-guarded refresh on every
built-in driver, and nothing in the interface said it had to be. A driver whose `acquire` takes
a _free_ lock — the ordinary reading of the word — would have had `refresh()` silently take a
lock another holder owned, which is the one thing a lock exists to prevent.

Implement `extend(key, owner, ttlSeconds)`: push the deadline out, return `false` when the key
is free or held by someone else.

### `routes:types` and `serve --dev` are retired

`route:types` and `dev` are the real names. The codemod rewrites both in scripts and CI config.

`serve --dev` **fails loudly** rather than being ignored. The flag is still declared for exactly
that reason: flag parsing is non-strict, so deleting it would have left `serve --dev` starting a
plain server with no watcher and no message — a retired flag that silently changes what a
command does.

## 1.11 to 1.12

One breaking change, and it is the intended kind: a minor, announced, with the reason.

**A boolean written to a text column is refused.** A bare `@column()` resolves to
`{ type: "string" }`, so a boolean property decorated with one was stored as text —
and a text column has text affinity, so `false` was stored as `"0"`, which is truthy
in JavaScript. Every `if (model.flag)` on such a column took the wrong branch for a
stored `false`, on every row, with nothing in the app or the database registering a
fault. An app found it when a feature flag read as enabled for every record that had
it turned off.

```ts fragment
// in a model class body — before, and silently wrong
@column() declare active: boolean;

// after
@column("boolean") declare active: boolean;
```

There is no correct coercion: `0` becomes `"0"` and `"false"` is truthy too, so the
value cannot survive the round trip. The write now throws `ColumnTypeError`, naming
the property and the fix.

### What to do before upgrading

**Find your boolean properties whose `@column()` declares no type.** The decorator
cannot find them for you — `declare active: boolean` erases the TypeScript type at
runtime, so a bare `@column()` on a boolean is indistinguishable from one on a string
until a value arrives. A search of your models for `@column()` with no argument, read
against the property types beside them, is the reliable way.

**The rows you already wrote are still text.** This release stops new bad writes; it
does not migrate old ones. A column that has been holding `"0"` and `"1"` needs both
the decorator fixed and the stored values converted — on SQLite,
`UPDATE widgets SET active = CAST(active AS INTEGER)` after the column type is
corrected. Until then those rows keep reading truthy, which is the behaviour you are
upgrading to escape.

**If a text column really should hold a boolean**, say so explicitly and it is
honoured: `@column({ type: "string", cast: "boolean" })`. The guard is for the column
that says nothing, not for every string column.

## 1.11.2

One breaking change, and it is in a release that should not have carried one.

**`countTokens` returns `number | null`.** `Ai.countTokens()` and
`AiDriver.countTokens()` used to return `number`, with `0` standing in for "this
provider cannot count". Only Anthropic has a counting endpoint, and `0` is also a real
count for an empty prompt — so the old return value could not tell you which it meant,
and a budget built on it was quietly wrong for every other provider.

```ts fragment
// before
const tokens = await Ai.countTokens(prompt);
if (tokens > 1000) shorten();

// after
const tokens = await Ai.countTokens(prompt);
if (tokens !== null && tokens > 1000) shorten();
```

A custom `AiDriver` needs no change — returning `number` still satisfies
`Promise<number | null>`. Only callers do.

**Why this is in a patch.** It was made while `@zerotal/ai` was still `experimental`
and therefore outside the compatibility promise, in the same release that then promoted
the package to `stable`. That ordering is real and it is not a distinction anyone
installing 1.11.2 can observe: what arrives is a patch that breaks a build. The rule
stands as written — a patch does not break — and this release is recorded as the
exception rather than as a reinterpretation of it. See
[the support policy](/docs/support-policy#releases-and-versioning).

Everything else in 1.11.2 is additive. `@zerotal/ai`'s other surface change — `toSchema`,
`strippedConstraints`, `resetSpend` and `resetStats` becoming `@internal` — leaves those
exports working; they are no longer covered by the promise, which is different from
being gone.

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
