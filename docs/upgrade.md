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
  given its own section on this page. At most one a quarter, released in January,
  April or October.
- **Major** (`X.y.z`) — an annual consolidation, cut each July, and a
  long-term-support line that gets fixes for two years. The next is 2.0, in July 2027.

How long each line gets fixes is set out in
[Support windows](/docs/support-policy#support-windows).

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

> **Note** — `bun create zerotal` writes a tilde range into new apps for this reason. An app scaffolded earlier has a caret: change `^` to `~` in its `package.json` to get the same protection.

> **Warning** — always upgrade the `@zerotal/*` packages together. Mixing versions across core, ORM, and feature packages leads to type and runtime mismatches.

## Upgrade steps

1. **Bump the packages.** Update every `@zerotal/*` dependency to the target
   version, then reinstall:

   ```bash
   bun update            # within the ranges in package.json
   # or pin exact versions, then:
   bun install
   ```

2. **Review the breaking changes.** For each minor you cross, work through its section
   below, newest first. The [Release Notes](/docs/changelog) give each change its reason.

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

## 1.18.4

A patch: security fixes for Flow and the dev server, and the starter walk's remaining items.
Nothing needs changing in an app that works today, but a Flow app behaves differently in three
places, the debug panel in one, and a production app should check one setting.

### Flow: a frame that verifies is always served

A Flow page sends its signed state with every action. Before 1.18.4, ten frames whose state did
not verify, from one address, made the server refuse **every** frame from that address for ten
minutes, valid ones included. It needed no sign-in, and behind a reverse proxy every visitor
shares the proxy's address, so one client could stop Flow for everyone.

Now the signature is checked first and a frame that verifies is always served. Frames that do
not, and malformed ones, are refused before any middleware runs. Those, and calls to methods the
page does not expose, are counted per address only to keep the log short: ten warnings, then one
line saying the rest are refused quietly.

**What to check.** If a reverse proxy or load balancer fronts the app, set
`app.throttle.trustedProxies` to how many there are. Nobody is locked out without it any more,
but the log names the proxy instead of the client, and the rate limiters and the audit trail read
the same setting:

```typescript fragment
// config/app.ts
export default AppConfig({
  throttle: { trustedProxies: 1 },
});
```

### Flow: visitors no longer see an error's own text in production

When an action throws, the default `onError()` flashed `error.message`, and an error thrown in a
render or a middleware went to the browser as the error frame's message. A failed query could
show a table name, a host or a file path. Outside development and tests both now say "Something
went wrong. Please try again." An error you raise to answer the visitor (`abort(403, "…")`, a
`ForbiddenError`) still shows its own message.

**What to check.** A page that relies on the raw message reaching the visitor (`throw new
Error("That name is taken")` in an action) shows the generic sentence in production now. Either
throw an HTTP error for messages meant for the visitor (`abort(422, "That name is taken")`), or
set this in `config/flow.ts` to keep the old behaviour everywhere:

```typescript fragment
export default FlowConfig({ exposeErrorMessages: true });
```

### Flow: thrown actions are reported

An action that threw was caught by Flow and reported nowhere. It now goes to the exception
handler you registered with `app.withExceptionHandler()` (or the log), and the
`FlowActionHandled` event says `ok: false`.

**What to check.** If an `onError()` override sends errors to your tracker, remove that call, or
each error is reported twice. A `@task` the visitor stops no longer flashes "This operation was
aborted".

### In development the debug panel answers this machine only

`bun zt dev` listens on every network interface. The debug panel and the Inertia recorder used to
answer any caller there, so a device on the same network could read every trace: queries, the
signed-in user, and mail previews holding live password-reset links. They now answer a request
only when it comes from this machine by a loopback name (`localhost`, `127.0.0.1`, `[::1]`,
`*.localhost`). Anything else gets a 404, and no panel is injected into its pages. The app itself
is still reachable from the network as before.

**What to check.** To use the panel from another device, say who may with a gate. The gate is
given the request, not the address of the device that sent it, so it cannot single out one phone.
The form below lets in any device that opens the app by this machine's IP address:

```typescript
// config/devtools.ts
import { DevtoolsConfig } from "@zerotal/devtools";

export default DevtoolsConfig({
  // A device that opens the app by this machine's IP address may use the panel.
  gate: (request) => /^\d+\.\d+\.\d+\.\d+$/.test(new URL(request.url).hostname),
});
```

That is everyone on the same network who can reach the port, which is the exposure the new
default closes: use it on a network you trust, and take it out when you are done.

An app run in a container and opened through a published port is reached from the container's
network, not from loopback, so it needs a gate too; one that allows the name you browse
(`new URL(request.url).hostname === "localhost"`) is enough there, and lets in anything else that
can reach the published port and names `localhost`. The Inertia recorder takes the
same kind of gate under `inertia.devtools.gate`. Both are asked only for requests that do not come
from the machine itself.

### Also worth knowing (not breaking)

- **`bun zt dev` reads `PORT`** from the shell and `.env`, as `bun zt serve` does. `--port` still
  wins.
- **A flash chained onto a redirect in a Flow action now shows** on the next page, through
  `<Flash>`.
- **Flow uploads** are held to `app.maxRequestBodySize` (8 MiB by default), as they always were;
  the guide's "25 MB" was wrong. Set `flow.uploads.maxBytes` to give uploads their own limit.
- **A Flow page that uses your own function components may now compile** where it used to render
  through the runtime. It renders the same HTML. `ZT_FLOW_COMPILE_LOG=1` shows each page that does not
  compile, and why.
- **`<Dialog closable={false}>` (`@zerotal/flow-ui`) now also ignores the backdrop and Escape**,
  as its docs say, so only the dialog's own buttons close it. If you set it only to hide the ×
  and still want the backdrop and Escape to close the dialog, leave `closable` on.
- **An `onError()` override that re-throws now shows the default flash**, as the lifecycle guide
  says; before, the visitor saw nothing.
- **`TestResponse.inertia()` gained a typed overload.** Existing calls compile as they are. Two
  type-level reads change: `ReturnType<TestResponse["inertia"]>` now names the typed overload (use
  `InertiaPage` directly), and a test subclass that overrides `inertia()` declares both
  overloads.
- **Saving a Flow page under `bun zt dev`** restarts the server only, not the scheduler and the
  queue. A job or schedule that imports from `app/flow/` keeps its old code until another save or
  a restart of `bun zt dev`.

## 1.18.3

A patch. One change can affect a test suite; an app made from a starter can take one more
change to its two-factor challenge.

### `Storage.fake()` with no disk named fakes `public` too

With no name, `Storage.fake()` fakes the default disk and, when that disk is not served (the
built-in `local` is not), the `public` disk as well, where media with no disk configured writes.
Both names share the files of the disk it returns. Before, a media test that faked the default
found its fake empty, and its uploads were written for real into `storage/public/media/`.

**What to check.** A test that calls `Storage.fake()` and then looks for a real file under
`storage/public` finds it in the fake instead: assert on the fake. `Storage.fake("local")`, with
the name, still fakes that disk alone.

### Two-factor: claim the code's step in one update

1.18.2's upgrade steps read the user's last accepted step and saved the new one after. Two
requests carrying the same code at the same moment could both pass the check before either
saved. New apps claim the step with one conditional update and sign in only the request that
changed the row. To do the same, add this to `app/auth/two-factor.ts`:

```ts
import { DB } from "zerotal/orm";

export async function claimTwoFactorStep(userId: number, step: number): Promise<boolean> {
  const changed = await DB.table("users")
    .where("id", userId)
    .where((q) =>
      q.whereNull("two_factor_last_counter").orWhere("two_factor_last_counter", "<", step),
    )
    .updateCount({ two_factor_last_counter: step });
  return changed === 1;
}
```

and in `app/routes/(guest)/two-factor/challenge.ts`, import it beside the file's other imports:

```ts fragment
import { claimTwoFactorStep } from "@app/auth/two-factor";
```

then replace the check and the save that follows it with:

```ts fragment
const step = check.valid ? check.counter : null;
if (step === null || !(await claimTwoFactorStep(user.id, step))) {
  loginThrottle.recordFailure(http, throttleKey);
  rejectInput(
    http,
    { code: "That code is not valid or was already used. Enter the newest one from your app." },
    "/two-factor/challenge",
  );
}
```

### Also worth knowing (not breaking)

- **Every test file of a run prints its warnings**, not only the first.
- **`bun zt dev` no longer prints "Skipping … app/schedules" at startup.**
- **`AGENTS.md` says `bun zt worker`** for production. `bun zt doctor` reports it as stale until
  you run `bun zt arch:update`.

## 1.18.2

A patch. Nothing in the packages asks for a change in your app, but an app made from the React,
Vue or Flow starter should make one change to its own two-factor routes, and a media test written
before 1.18.1 may be writing real files.

### Before you upgrade: two-factor codes in an app made from a starter

An app made with `create-zerotal` 1.18.1 or earlier has its own copy of the two-factor routes.
They check a code with `TwoFactor.verifyCode()` and save nothing, so a code is accepted again for
as long as it is current, about a minute: a code that signed someone in can sign in a second
session, and the code that turned two-factor on can then sign in. Upgrading the packages does not
change your copy. An app made from 1.18.2 saves the time step of each code it accepts and refuses
that code, or an older one, afterwards. To do the same in yours:

1. **Add a column.** Run `bun zt make:migration add_two_factor_last_counter_to_users` and give it
   this body, then run `bun zt migrate`:

   ```ts
   import { Migration, Schema } from "zerotal/orm";

   export default class AddTwoFactorLastCounterToUsers extends Migration {
     async up(): Promise<void> {
       await Schema.table("users", (table) => {
         table.integer("two_factor_last_counter").nullable();
       });
     }

     async down(): Promise<void> {
       await Schema.table("users", (table) => {
         table.dropColumn("two_factor_last_counter");
       });
     }
   }
   ```

2. **Add it to the model.** In `app/models/User.ts`, add `"twoFactorLastCounter"` to `hidden`,
   and the column beside the other two-factor ones:

   ```ts fragment
   @column({ type: "integer", nullable: true }) twoFactorLastCounter?: number | null | undefined;
   ```

3. **Check the code once at sign-in.** In `app/routes/(guest)/two-factor/challenge.ts`, replace
   the branch that begins `} else if (!code || !TwoFactor.verifyCode(` with:

   ```ts fragment
   } else {
     const check = TwoFactor.verifyCodeWithCounter(
       user.twoFactorSecret,
       code ?? "",
       user.twoFactorLastCounter,
     );
     if (!check.valid) {
       loginThrottle.recordFailure(http, throttleKey);
       rejectInput(
         http,
         { code: "That code is not valid or was already used. Enter the newest one from your app." },
         "/two-factor/challenge",
       );
     }
     user.twoFactorLastCounter = check.counter;
     await user.save();
   }
   ```

4. **Save the step at setup.** In `app/routes/(auth)/settings/two-factor/confirm.ts`, check the
   code with `verifyCodeWithCounter()` and save the step it matched with the secret:

   ```ts fragment
   const check = TwoFactor.verifyCodeWithCounter(secret, code);
   if (!check.valid) {
     rejectInput(
       http,
       { code: "That code did not match. Try the newest one in the app." },
       "/settings/two-factor",
     );
   }

   // … where the secret is saved:
   user.twoFactorConfirmedAt = new Date();
   user.twoFactorLastCounter = check.counter;
   ```

A new app's `tests/auth/two-factor.test.ts` has three tests for this ("refuses a code that
already signed someone in", "refuses a code older than the last one used" and "the code that
turned two-factor on can't then sign in"), which work in an app made from the same starter.

### A media test that fakes the default disk

Since 1.18.1, media with no disk configured goes to the `public` disk. A test written before
that which calls `Storage.fake()` with no argument fakes `local`, the storage default, so its
disk assertions find nothing, and the uploads it makes are written for real into
`storage/public/media/`, a served folder.

**What to change.** Fake the disk media writes to, `Storage.fake("public")`, and delete anything
such a test left in `storage/public/media/`. From 1.18.2 a failed assertion on the fake names
the real disk the code used.

### Also worth knowing (not breaking)

- **Mail signs off with the app's name.** A `MailMessage` that sets no `salutation()` now ends
  with "The _App_ team" from `app.name`, not "Regards,". A test that asserts the old line needs
  the new one.
- **`uncompromised()` is now `noWhitespace()`.** The old name still works, and is deprecated.
- **`AGENTS.md` has a new line on Vue page props.** `bun zt doctor` reports it as stale until you
  run `bun zt arch:update`.
- **`bun zt dev` is quieter**: no "Skipping … app/schedules" line when the server restarts (one
  still printed at startup until 1.18.3), and a page syntax error no longer parks the scheduler
  tab, which starts again on the next save.
- **A refused upload is logged as a warning**, without a stack.

## 1.18.1

A patch. Three changes can affect an existing app; most need no change.

### Media with no disk configured is served

With no disk named on a collection, in `config/media.ts` or with `.toDisk()`, media went to the
private `local` disk, and every `getUrl()` link 404ed. It now goes to `storage.default` when
that disk has a URL, and otherwise to the built-in `public` disk, served at `/storage/public`.
Files already stored keep resolving to the disk they were written to.

**What to check.** Files uploaded from now on with no disk configured are reachable by anyone
holding the link, which carries the item's random id. If they should not be, name a private disk
in `config/media.ts` and hand out `getTemporaryUrl()` links. A test that calls `Storage.fake()`
with no argument fakes `local`; fake `Storage.fake("public")` instead.

### A narrower `in()` value can fail a comparison

`r.string().in(["draft", "active"])` now types the validated value as `"draft" | "active"`, not
`string`. Nothing changes at run time.

**What to change.** Code that compares the field with a value the list does not hold, such as
`data.status === "archived"`, or assigns one to it, no longer compiles. Add the value to the
list, or widen with `as string` where the comparison is deliberate. `StringRule`'s new type
parameter defaults to `string`, so code that names `StringRule` on its own is unaffected.

### The logger reads `LOG_LEVEL`

When `LOG_LEVEL` names a level (`debug` to `fatal`), it is the terminal's minimum level, unless
the logging config sets `console.level`. The file trail keeps its own level. `bun zt test` sets
`LOG_LEVEL=warn` for the suite.

**What to change.** Nothing, unless your host sets `LOG_LEVEL` and you want the terminal to keep
showing what it did: set `console.level` in `config/logging.ts`.

### Also worth knowing (not breaking)

- **A failed form's errors and old input are flashed** for the page the redirect lands on,
  rather than kept until a later validation passes, and `old` never holds a password field or
  an upload.
- **`bun zt dev` runs your schedules**, and a process it supervises boots in its own mode, so a
  queue worker under `zt dev` boots as a worker.
- **Generated files follow your app**: `zerotal/*` imports when the app uses the bundle, and the
  app's own Prettier. Re-run a generator rather than fixing an old file by hand.
- **Vue page props can be type-checked** against `Inertia.render`; it is off until you opt in,
  because it can fail a `vue-tsc` run that passes today.

## 1.18.0

A minor, with one type-level break and two changes that refuse what used to pass silently.
Most apps need no change.

### The queue driver setting gains `"database"`

`QueueConfigShape["driver"]` is now `"database" | "sqlite" | "redis" | "sync"`, and
`QueueConfig()` fills in `"database"` where it filled in `"sqlite"`. Both names select the same
driver, which now also runs on PostgreSQL and MySQL 8.

**What to change.** Nothing in config files. Code that reads the setting needs a look in two
cases: an exhaustive `switch` over it stops compiling until it has a `"database"` case, and a
check of `config.get("queue.driver") === "sqlite"` that meant "jobs are in the database" no
longer matches the default. Test for `"database"` as well.

### `zt migrate` refuses a half-run migration-number clash

Two different migrations under one number, such as `0042_add_invoices` and `0042_add_refunds`
from two branches, are now refused by `migrate` on a database that has run one of them and not
the other. `zt doctor` fails on any clash, so CI catches one before merge.

**What to change.** Run `bun zt doctor` once. If it reports a clash, its message gives the fix:
renumber the later file if it has not run anywhere yet, or, if it has, keep it in place with a
letter after the number (`0042b_add_refunds`) and pin its recorded name with
`static override id = "0042_add_refunds"`. A new database runs a clash in name order with a
warning, so nothing blocks a fresh environment. Migrations named by date are not numbered and
never clash.

### A route name that two paths share is withheld

A generated route name leaves out `[param]` segments, so `applications/act.ts` and
`applications/[id]/act.ts` both came out as `applications.act.store`, and the route registered
last kept the name. Such a name now names neither: it is left out of the generated route types,
`route()` on it throws an error naming both paths, and `bun zt route:list` lists it.

**What to change.** Run `bun zt route:list`. If it lists a shared name, give one of the routes
its own name in the route file's `meta` (or with `.name()` in a routes file), and use that name
where you linked to it. Both routes keep answering requests either way.

### Also worth knowing (not breaking)

- **`database.backupBeforeMigrate: true`** takes a SQLite snapshot before `migrate`,
  `migrate:fresh` and `migrate:refresh` in production. Off unless you turn it on.
- **`queue.visibilityTimeout`** can now be set. Raise it above your slowest job if you run more
  than one worker.
- **New test helpers:** `withConfig()`, `withEnv()`, `Queue.settle()`, `Notify.settle()`. Any
  hand-written settle loop or env restore in your tests can go.
- **An app created before this release** can add the bare-`bun test` guard with two lines in
  `bunfig.toml`; see [Testing](/docs/testing#a-bare-bun-test-stops-before-it-reaches-your-database).
- **Run `bun zt arch:update`** if the app has `@zerotal/arch`: `AGENTS.md` now lists the
  settings registry, and two skills were corrected.

## 1.17.4

A patch. No app needs a code change. One fix can change what an existing app sees.

### `bun zt serve` listens on `PORT`

`serve` used to listen on 3000 unless given `--port`, whatever `PORT` or `app.port` said. It now
uses `--port` when given, else `app.port`, which defaults to `PORT`, else 3000. A `PORT` that is
not a port, such as `80800`, stops `serve` with an error naming it.

**What to change.** Nothing, unless the host sets `PORT` and your proxy forwards to 3000 because
that is where the app always ended up. Point the proxy at `PORT`, or unset `PORT`.

### Also worth knowing (not breaking)

- **`bun zt arch:update` adds the new `AGENTS.md` index and skills** in an app with
  `@zerotal/arch`. An app on the `zerotal` bundle also gets the package sections it was missing.
- **A new app ships with the coding-agent files.** An existing app adds them with
  `bun add @zerotal/arch` and `bun zt arch:install`; see [Agent Surface](/docs/arch).

## 1.17.3

A patch. No app needs a code change. Two fixes can change what an existing app sees.

### `Carbon`'s ISO strings have three fraction digits

`toISOString()`, `toJSON()` and `toDatabase()` used to trim trailing zeros, so a whole second
printed as `2026-11-25T10:00:00Z` and `.940` as `.94Z`. They now always print three digits, as
`Date.prototype.toISOString()` does: `2026-11-25T10:00:00.000Z`. Stored values now sort in time
order as strings, and match what the ORM writes.

**What to change.** Nothing in application code. A test that compares one of these strings
against a literal without the fraction needs `.000` added to the literal.

### A security header a route sets itself is kept

The security headers from `app.secureHeaders` are now defaults: a response that already carries
one keeps its own value, and the rest are still added. Before, the global value replaced it.

**What to change.** Nothing, unless a route sets one of these headers and you relied on the
global value replacing it. Remove the route's header in that case.

### Also worth knowing (not breaking)

- **`http.files()` and `http.file()` read `name[]` and `name[0]` fields**, so files posted by the
  Inertia adapter as `attachments[]` arrive. If you read `attachments[]` by hand to work around
  this, the workaround still works and can go.
- **Routes under `app/routes/.well-known/` are served.** Remove any route you registered by hand
  to stand in for one.
- **A malformed URL is a 400 under a storage mount**, and passes to your app elsewhere, instead
  of a 500.

## 1.17.2

A patch. No app needs a code change. Two fixes can change what an existing app sees.

### Route types gain the verb of `.name()` routes

`bun zt route:types` used to leave a route named with `.name()` (`Router.get(…).name("login")`,
and likewise after `Router.post`, `Router.flow` or `Router.view`) out of `METHODS` in
`types/routes.generated.ts`. It now writes its verb, as it does for routes named by a file
route's `meta`.

**What to change.** Run `bun zt route:types` once and commit the file. Until then, a CI step
running `bun zt route:types --check` reports the file as out of date. `route()` is unaffected.

### `/health` answers outside production

An app that never configured health checks now serves `/health` outside production, as
[Health checks](/docs/health) always said it would. Production is unchanged: the endpoint stays
off there unless you turn it on.

**What to change.** Nothing, unless you don't want the endpoint in development or staging: set
`health: { enabled: false }` in `config/app.ts`.

### Also worth knowing (not breaking)

- **More Flow pages compile ahead of time**: pages registered with `Router.flow()`, pages that
  extend a base class of your own, and pages with attribute values worked out on the server.
  They render the same HTML as before, and now also work under `cspSafe`, where the runtime
  fallback is refused. A page that still can't compile says why when you set
  `ZT_FLOW_COMPILE_LOG=1`.
- **A missing route-bound record is no longer logged** as an unhandled error. It still answers 404.
- **The React, Vue and Flow starters are full first apps.** This changes only what
  `bun create zerotal` scaffolds; existing apps are not touched.

## 1.17.1

A patch. One of its fixes changes what an app on SQLite can see. No app needs a code change.

### On SQLite, other requests wait for an open transaction

Bun keeps one connection to a SQLite database. While a request had a `DB.transaction()` open, a
statement from any other request ran inside it: a write reported success and was lost if the
transaction rolled back. Now an open transaction holds the connection, and other requests'
statements wait until it commits or rolls back.

A statement that waits longer than `database.sqlite.busyTimeout` (5000 ms by default) fails with
`database is locked`. A request that used to finish while a long transaction ran elsewhere can
now wait for it, or fail after the timeout.

**What to change.** Usually nothing. If you see `database is locked`:

- keep transactions short, and don't await outside work, such as an HTTP call or another
  request's result, inside one;
- pass `attempts` to `DB.transaction(cb, attempts)` to retry;
- or raise `busyTimeout` in `config/database.ts`.

[Transactions on SQLite](/docs/database#transactions-on-sqlite) has the details. PostgreSQL and
MySQL are unchanged.

### Also worth knowing (not breaking)

- **A binary built by `bun zt compile` now serves the app.** If you deploy with Bun and an installed
  `node_modules`, nothing changes. To deploy a binary instead, build assets first, then compile,
  and ship the binary with `.env` and `public/`:
  [Compile to a single binary](/docs/deployment#compile-to-a-single-binary).
- **Admin apps scaffolded before 1.17.1** build their `users`, `products` and `settings` tables
  with `synchronize`, which is off in production. For a new database, copy `0002` to `0004` from
  the starter's `database/migrations/` and set `synchronize: false`. Leave a database that
  `synchronize` already built as it is, since those migrations would fail on
  `table users already exists`.

## 1.16 to 1.17

A minor that installs less into an app. The packages it stops installing for you are the ones
only some apps use, so most of the steps below apply only to apps that use the feature. After
upgrading, run `bun zt doctor`. It names a missing passkey library, image driver, AI provider
SDK, Inertia framework package, and the admin panel's audit and notifications packages, each
with the command to install it. The other optional packages below are not checked: read their
steps.

### Passkeys need their library installed

`@zerotal/auth` no longer installs `@simplewebauthn/server` or `reflect-metadata`. An app that never
uses passkeys no longer carries them.

**What to change.** If your app constructs `PasskeyService`, run:

```bash
bun add @simplewebauthn/server reflect-metadata
```

Without them the app still boots and serves. The first ceremony throws `OptionalPeerMissingError`
with that command in its message, and `zt doctor` and `zt deploy` fail until the packages are
installed.

`PasskeyService` now takes and returns Zerotal's own types, exported from `zerotal/auth`:
`PasskeyRegistrationOptionsJSON`, `PasskeyRegistrationResponseJSON`,
`PasskeyAuthenticationOptionsJSON` and `PasskeyAuthenticationResponseJSON`. Code typed with the
library's types still compiles. Code that reads `attestationFormats`, or `extensions` other than
`credProps`, from the returned options must drop the read.

### Passkey registration accepts any authenticator

Registration no longer asks only for a platform authenticator, so a USB or NFC security key, or a
phone reached by QR code, can now enrol. Sign-in is unchanged.

**What to change.** Nothing, if you want this. To keep 1.16's behaviour, pass
`authenticatorAttachment: "platform"` in the `PasskeyService` options. See
[Authentication](/docs/authentication#passkeys).

### The panels run Tailwind v4

`flowUiHead()`, and so the admin panel and `/monitor`, loads Tailwind v4's browser build from
`https://cdn.jsdelivr.net` with an integrity hash, in place of the v3 script from
`cdn.tailwindcss.com`.

**What to change.**

1. **Content-Security-Policy.** If yours allows `https://cdn.tailwindcss.com` in `script-src`, replace
   it with `https://cdn.jsdelivr.net`. These pages also run two small inline scripts (dark mode and
   the copy buttons), so their `script-src` needs `'unsafe-inline'`, and outside CSP-safe mode
   `'unsafe-eval'` as on every Flow page.
   [Recommended CSP header](/docs/flow/components#pages-rendered-with-flowuihead) has the policy.
2. **Your own markup under `flowUiHead()`**: custom admin pages, widgets, infolist entries and Flow
   pages are now compiled by v4. Rename the v3 classes whose meaning changed:

   | v3                                       | v4                                   |
   | ---------------------------------------- | ------------------------------------ |
   | `shadow-sm`, `blur-sm`                   | `shadow-xs`, `blur-xs`               |
   | `drop-shadow-sm`, `backdrop-blur-sm`     | `drop-shadow-xs`, `backdrop-blur-xs` |
   | bare `ring`                              | `ring-3`                             |
   | `outline-none`                           | `outline-hidden`                     |
   | `bg-opacity-50` (and `text-`, `border-`) | an opacity modifier, `bg-black/50`   |
   | `bg-gradient-to-r`                       | `bg-linear-to-r`                     |
   | `hover:file:…`                           | `file:hover:…`                       |

   `hover:` now applies only on devices that can hover, and the default palette is v4's.

3. **Your own stylesheet** (`theme.stylesheet`).
   - **With your own v4 build:** put `flowTailwindCss()` (or `adminTailwindCss()`) and
     `flowTokensCss()` (or `adminTokensCss()`) in your entry, after `@import "tailwindcss";`.
   - **With your own v3 build:** move it to v4. The components now use class names that v3 does
     not generate (`outline-hidden`, `shadow-xs`, `bg-linear-to-*`), so under a v3 stylesheet
     focused buttons show the browser's outline, inputs lose their shadow and scroll areas their
     fade. Until you move, add `borderColor: { DEFAULT: "hsl(var(--border))" }` under
     `theme.extend` in a hand-written config, or default borders turn light grey in dark mode;
     `flowTailwindConfig()` and `adminTailwindConfig()` already do this.
4. **Your own `body` or `*` rules.** The token border and page colours now sit in `@layer base`. An
   unlayered `body { background }` or `* { border-color }` rule of your own now wins over them.

See [Components](/docs/components).

### Flow no longer installs Alpine

Flow's client runtime ships prebuilt in `@zerotal/flow`, so `alpinejs` and the `@alpinejs/*` plugins
are no longer installed into your app.

**What to change.** Nothing, unless your own code imports `alpinejs` or an `@alpinejs/*` plugin.
Until now that import resolved through Flow. Add it to your app:

```bash
bun add alpinejs
```

Add any plugins you import as well.

### Flow's route table has its own URL

Pages now load the app's route table from `/__flow/routes/<hash>.js`. In 1.16 it came inside
`/__flow/runtime.js`. Like that script, it passes through your app's global middleware, so it is
refused wherever a page would be.

**What to change.** If your own middleware turns away everything outside an allowlist of public
paths, add `/__flow/*` to the allowlist. Otherwise `route()` and `navigate` links stop working on
public pages, without an error on the page itself. Keep `/__flow/*` open at the proxy, as before.
A proxy rule or layout that names `/__flow/runtime.js` or `/__flow/enhance.js` keeps working; the
other scripts now load from content-hashed URLs. Those hashed scripts and `/__flow/enhance.js` are
answered before your global middleware runs, so headers it adds, such as CORS or security headers,
no longer reach them; set those at the proxy if you need them on every response.

### A missing optional package throws

Zerotal packages now declare what they load from one another. An optional package that is missing
raises `OptionalPeerMissingError`, exported from `zerotal/runtime`. Its message includes the
command that installs the package. Before, the admin panel's options quietly did nothing, and
tenancy and notifications threw an error of their own.

**What to change.**

- **Admin.** A resource with `static history = true` needs `@zerotal/audit`.
  `Panel.notifications(databaseNotifications())` needs `@zerotal/notifications`.
  `importAction({ queue: true })` and `dispatchImport()` need `@zerotal/queue`. Install each one,
  or remove the option.
- **Tenancy.** If you catch `TenancyConfigError` around `tenantCache()` to detect a missing cache,
  catch `OptionalPeerMissingError` instead, or install `@zerotal/cache`.
- **Notifications.** If you catch `NotificationChannelUnavailableError` from the broadcast channel
  to detect missing broadcasting, catch `OptionalPeerMissingError` instead, or install
  `@zerotal/broadcasting`.
- **ORM without `zerotal`.** If your app installs `@zerotal/orm` on its own and uses the validator,
  run `bun add @zerotal/validator`. Apps on the `zerotal` package need nothing.

### A missing sharp fails conversions

With `driver: "sharp"` in `config/media.ts`, a missing or unloadable sharp used to produce no
conversions, without an error. Now `addMedia()` into a collection with conversions throws
`OptionalPeerMissingError` once the original is stored, and queued conversions fail.

**What to change.** Run `bun add sharp` (0.33, 0.34 or 0.35 are supported), or set `driver: "bun"`.
Code that caught `MediaError` for a missing sharp should catch `OptionalPeerMissingError`. See
[Media](/docs/media).

### `.vue` pages need `@vue/compiler-sfc` 3.3 or later

**What to change.** Install the compiler at the same version as `vue`:

```bash
bun add vue@^3.5 @vue/compiler-sfc@^3.5
```

New starters already have it. A Vue app with `inertia.ssr: true` and no compiler now fails at boot
instead of rendering the page's file path. React apps need nothing. Code that matched the old React
SSR error message should catch `OptionalPeerMissingError` instead.

### On Bun 1.4, Carbon hands out Bun's own `Temporal` values

Carbon now uses the runtime's `Temporal` when there is one, and loads `@js-temporal/polyfill` only on
Bun 1.3.

**What to change.** Nothing on Bun 1.3. On Bun 1.4, an app that imports `Temporal` from
`@js-temporal/polyfill` and passes a Carbon `ZonedDateTime` to that import's `ZonedDateTime` methods
(`compare`, `from`, `until`, `since`, `equals`), or checks Carbon's values with `instanceof` against
it, must use the global `Temporal`. An app that runs on both Buns can define its own:

```ts
import { Temporal as Polyfill } from "@js-temporal/polyfill";

export const Temporal = (globalThis as { Temporal?: typeof Polyfill }).Temporal ?? Polyfill;
```

That is always the implementation Carbon runs on. See [Carbon](/docs/carbon).

### The ORM reads dates back as the instant saved

The ORM writes every date as UTC. It now reads them back that way too, whatever the server's `TZ`:
zone-less date-time text, such as MySQL's `YYYY-MM-DD HH:MM:SS` or SQLite's `CURRENT_TIMESTAMP`,
is read as UTC, and MySQL `DATE`, `DATETIME` and `TIMESTAMP` columns read the same on Bun 1.3 and
1.4. In 1.16, under a `TZ` other than UTC, a MySQL date moved by the zone's offset between a save
and the next load.

A value that something else wrote as local time is now read as UTC as well, so under a `TZ` other
than UTC it reads differently from 1.16. That covers a MySQL column that `NOW()` or
`CURRENT_TIMESTAMP` filled on a server outside UTC, and text written as local time by another
program or by hand-written SQL. Nothing stored changes.

**What to change.**

1. If `TZ` is unset or UTC and your MySQL server runs in UTC, nothing.
2. Otherwise run `bun zt doctor`. If it warns about MySQL's time zone, run the server in UTC
   (`default-time-zone = '+00:00'` under `[mysqld]`, or `SET GLOBAL time_zone = '+00:00'`), then
   restart the app so its connections reopen. Bun 1.4.1 and later open every connection in UTC;
   Bun 1.3 and 1.4.0 keep the server's zone and cannot set one per connection.
3. Convert rows written in the old zone with `CONVERT_TZ`, or read such a column through a custom
   cast. [The MySQL server's time zone](/docs/orm/casts#the-mysql-servers-time-zone) shows which rows move and the statement for each.
4. Remove any code that added the zone offset back to dates the ORM read. It now corrects twice.
5. On Bun 1.3, prefer `TZ=UTC`. Bun 1.3 cannot read back a MySQL time in the zone's
   daylight-saving gap, and it reads a PostgreSQL `timestamp without time zone` column queried with
   no bound values shifted the first time that query runs on a connection. Bun 1.4 reads both
   correctly.

A `Carbon` in `where()` now binds the way a save stores it, so a query that compared against a
`Carbon` can return different rows: on MySQL it now finds rows it used to miss, and on SQLite and
PostgreSQL an equality keeps its milliseconds.

### Also worth knowing (not breaking)

- **`NotificationFake` moves.** Change `import { NotificationFake } from "zerotal/testing"` to
  `from "@zerotal/notifications"`, and run `bun add -d @zerotal/notifications` if your
  `package.json` does not list it. The old import is removed in 1.18.
- **`@zerotal/ai` bounds the Anthropic SDK to `>=0.70.0 <2`**, so an app on SDK 2.x gets a peer
  warning.
- **Vue and api apps scaffolded before 1.17** can apply the starters' sign-in fix.
  1. In `app/models/User.ts`, import `Authenticatable` from `zerotal/auth` and extend
     `Model.using(Authenticatable)`.
  2. Add the `remember_token` migration that `bun zt doctor` prints.
  3. In a Vue app, also add `StorageProvider` after `DatabaseProvider` in `bootstrap/providers.ts`.
- **`bun zt compile` with no `--entry`** now compiles `zt.ts`, so the `--entry=zt.ts` workaround can
  go. The binary starts and runs console commands, but cannot serve an app yet: keep deploying with
  Bun and an installed `node_modules`, as
  [Deployment](/docs/deployment#compile-to-a-single-binary) describes.
- **On Bun 1.4, `bun build --outfile` fails for an app that uses Flow or devtools**, because their
  prebuilt scripts are written as separate files. Use `--outdir`, or `bun zt compile`.

## 1.16.4

A patch. Two of its changes can alter what an app sees; neither needs a code change in an app that
configures passkeys correctly and lists what it imports.

### A misconfigured passkey setup is thrown

`PasskeyService.verifyRegistration()` and `verifyAuthentication()` answered `"passkey.invalid"` for
every failure, including an `origin` ending in `/` or an `rpId` written in non-ASCII letters rather
than punycode. Those failed every ceremony while looking like a bad response from the browser. They
are now thrown, with a message that names the fix. A response that fails verification is still
`"passkey.invalid"`.

**What to change.** Nothing, if passkeys work today. If they never have, the error now says why.
See [Authentication](/docs/authentication).

### `@zerotal/flow-ui` no longer installs `clsx`

`cn()` flattens its input itself, with the same output. The `lib/cn.ts` that `flow:add` and
`flow:init` copy into an app imported `clsx`, and the commands asked you to add it only when it
did not already resolve, which in an app with flow-ui installed it usually did. Such an app was
using flow-ui's copy, and that copy is gone.

**What to change.** If your code imports `clsx` and your `package.json` does not list it, run
`bun add clsx`, or replace a copied `lib/cn.ts` with the new one, which needs only
`tailwind-merge`.

## 1.16.3

A patch. Two of its fixes change what an app can see; neither needs a code change unless a test
relied on the old answer.

### A thrown `ValidationError` answers the way `validate()` does

A `ValidationError` from `@zerotal/core/errors` used to get the handling of any other 4xx: a styled
`422` page for a browser, and for every other client a `422` whose JSON had no `errors`. It now
follows `validate()`. A client whose `Accept` prefers JSON gets a `422` with your message and
every message per field. Anything else, a request with no `Accept` included, is redirected back
with `303`, the first message per field flashed as `errors` and the body as `old`.

**What to change.** A test that throws one and expects a `422` should send
`Accept: application/json`, with `asJson()`. A test that expects the redirect needs nothing. See
[Errors](/docs/errors#validation-errors).

### A failing response finalizer shows in development and tests

A callback registered with `ctx.onResponseReady()` that throws was logged and the response went
out anyway. Where development surfaces are on, which includes `zt test`, the error's response now
replaces it. The finalizer the framework registers is the session's, so the case you will meet is
a session too big for the cookie driver: the request answers with `SessionCookieOverflowError`,
whose message names the biggest keys, instead of sending the page without the cookie and losing
every flash, error and old input on it. Production still logs and sends the response.

**What to change.** Nothing, unless a test was passing over an overflowing session. Store an
identifier rather than the object, or move to a server-side driver. See
[Session](/docs/session#errors).

## 1.16.2

A patch, but five of its fixes change what an app can see. None needs a code change unless it
relied on the old behaviour.

### Mail refuses what it cannot send as written

An address that holds a control character, whitespace, `<`, `>`, `,` or `;`, or that is longer
than 254 characters, throws `InvalidMailAddressError`, and so does a display name holding a line
break. The check runs when the address is set on a `MailMessage`, when a notifiable's `email`
becomes the recipient, and again in each driver. `"Ada <ada@example.com>"` is still accepted and
split into a name and an address, and `mail.from.address` may be written that way.

**What to change.** Validate addresses where users type them, with the validator's `email` rule,
so a bad one is a 422 on the form and not an exception when the mail goes out. A configured
sender the check would refuse now fails at boot, naming the key. See
[Notifications](/docs/notifications#mail).

A test that calls `MailMessage.toPayload()` itself must pass both arguments, the default sender
and the fallback recipients, as its signature always said. Called with no recipients set and no
fallback, it used to return a payload with `to` undefined; it now throws.

### Idempotency keys are scoped

`IdempotencyMiddleware` keys a stored response by the signed-in user, or the session the client
sent back, plus the method, host, path, query string and the client's key. It used the key alone,
so one caller could be answered with another's response.

**What to change.** Nothing, for clients that retry the same request with the same key. Responses
stored before the upgrade are not replayed, so a retry that straddles the deploy runs its handler.
Register the middleware after session and authentication for the default scope to see the user,
or pass `scope`. See [Cache](/docs/cache#idempotency-middleware).

### A validation error answers JSON when `Accept` prefers it

`validate()`, `FormRequest` and the exception handler now agree: JSON when `application/json` has
a higher q-value than `text/html`, or the same and comes first, with or without `X-Inertia`. A
`ValidationError` you throw yourself joined them only in [1.16.3](#1163).
`text/html, application/json` used to get a 422 from the validator and now gets the redirect;
`X-Inertia` with `Accept: application/json` used to get a redirect and now gets the 422. Browsers
and Inertia's own visits are unchanged.

**What to change.** A test that posts and expects a 422 should send `Accept: application/json`.

### String SQL counts its placeholders

A `?` inside a string literal, a quoted identifier or a comment is no longer a placeholder in
`DB.raw()`, `whereRaw()` and the other string-SQL paths, and `DB.raw(sql, bindings)` throws when
the number of placeholders and bindings differ. A query that bound the wrong values before now
binds the right ones or fails loudly.

**What to change.** Nothing, if your queries worked. Write PostgreSQL's bare `?` jsonb operator in
the tagged form. See [Database](/docs/database).

### A thrown 4xx is not reported

An `HttpError` below 500 and an `abort(4xx)` are expected outcomes: logged as one warning, and not
passed to `report()`. An error that only carries an upstream status, such as an `HttpClientError`
from a 401, is still reported.

**What to change.** If an error tracker counted 4xx responses through `report()`, count them from
the access log or `RequestFailed` instead, which carries `expected`.

### Also worth knowing

- **Queue:** a chained job and a batch's `then`, `catch` and `finally` jobs go to their own
  class's queue; make sure a worker polls it. `retryFailed()` throws `E_QUEUE_UNKNOWN_JOB` for a
  job whose class is not registered.
- **`ctx.body()`** returns `{}` for a JSON body that is a number, string, boolean or `null`.
- **A file-route resolver's `ctx.middleware`** no longer includes the group's middleware; the
  registrar adds it.

## 1.15 to 1.16

One breaking change, to what `app.throttle.trustedProxies` counts, and one place that now
follows it.

### `trustedProxies` counts from the right, and the client is the last entry

Each proxy appends the address it received the request from to `X-Forwarded-For`, so behind
one proxy the client is the last entry. `trustedProxies: 1` used to read the entry before it,
which is one the client can write. It reads the last entry now, and the same count is used
everywhere the framework needs the client's address: every throttle, the sign-in lockout,
the audit trail and Flow.

| Your proxy                                                                         | Before | After          |
| ---------------------------------------------------------------------------------- | ------ | -------------- |
| Appends one entry (nginx `$proxy_add_x_forwarded_for`, Caddy, most load balancers) | `1`    | `1`, no change |
| Appends two entries, its peer and its own address                                  | `1`    | `2`            |
| Two proxies, one entry each                                                        | `2`    | `2`, no change |

**What to change.** Look at one request's `X-Forwarded-For` as your app receives it, with no
header sent by the client. If it has one entry per proxy, leave the count alone. If it has
more entries than you have proxies, the count goes up by the difference. Getting it wrong
the other way is easy to see: every request reads as your load balancer's address, and the
first throttle to fill refuses everyone.

### The audit trail stops reading `X-Forwarded-For` unless you say how many proxies there are

With `captureRequest`, an audit entry's `ip_address` was the leftmost `X-Forwarded-For`
entry, whatever `trustedProxies` said. It now follows the same rule as the throttles: the
socket address with no `trustedProxies`, otherwise the client counted from the right.

**What to change.** Nothing, if `app.throttle.trustedProxies` is already set. An app behind a
proxy without it will start recording the proxy's address on new entries; set the count, as
[Deployment](/docs/deployment#behind-a-reverse-proxy) describes, and `zt doctor` warns about.
Entries already written keep the address they were written with.

### Also worth knowing (not breaking)

- **`ctx.clientIp()`** returns the client's address by the same rule, or `null` when the
  request offers none. Use it where you used to read `X-Forwarded-For` yourself; `ctx.ip()` is
  still the socket, which behind a proxy is the proxy.
- **An app scaffolded with 1.15.5 has a second Bun** in `node_modules/bun` and prints a warning
  about it. Add a `bunfig.toml` with an `[install]` table holding `peer = false`, delete
  `node_modules`, then run `bun install`. Adding the setting alone keeps the copy already
  installed. See [1.15.6](/docs/changelog#1156-2026-10-28).

## 1.14 to 1.15

Two breaking changes. Both replace something that was quietly wrong with something that
says so.

### `createdAt`, `updatedAt` and `deletedAt` are `Carbon`, not `Date`

They always hydrated as `Carbon` — every `datetime` column does — but were declared `Date`,
so the type was wrong on any row loaded from the database. Worse, the runtime class
depended on how you got there: a `Carbon` after a load, a raw `Date` after a `save()`, a
`touch()` or a soft `delete()`. The same property on the same model, matching its declared
type in neither case.

```ts fragment
// before — compiled, and threw at runtime on a loaded row
const ms = order.createdAt.getTime();

// after
const ms = order.createdAt?.valueOf(); // epoch milliseconds
const iso = order.createdAt?.toISOString(); // "2026-09-04T08:15:00.000Z"
const native = order.createdAt?.toDate(); // a real Date, if something needs one
```

**What to change.** Compile and follow the errors: every one is code that would have thrown
if that line had run against a loaded row. `Carbon` has `toISOString()`, `valueOf()`,
`toJSON()` and `toDate()`, plus its own comparison and arithmetic — it does not have
`getTime()`, `getFullYear()` or the rest of the `Date` accessors.

If you were working around the old inconsistency, the workaround can go:

```ts fragment
// before — needed because the class varied by path
const ms = ((value as any).toDate?.() ?? value).getTime();

// after
const ms = value.valueOf();
```

A cast that hid the mismatch (`order.createdAt as unknown as string`) now hides a different
one — `.slice(0, 10)` on a `Carbon` still throws. Use `.toISOString().slice(0, 10)`.

### A broken `_middleware.ts` stops the boot

Two ways a `_middleware.ts` could fail to apply used to be silent, leaving the routes it
was written to guard live and unguarded:

- **`export default [Middleware]`** — the loader only ever read `export const middleware`.
  `export default` is the natural guess, because every route file in the same directory
  default-exports its handler.
- **A file that fails to import** — a typo, a bad import path, a circular import, a
  `SyntaxError`. All shared a `catch` with the missing-file case, so all read as "this
  directory has no middleware".

Both now fail the boot, naming the file and the fix. A directory with no `_middleware` file
is unchanged: absence is the convention working, and stays silent.

```ts fragment
// app/routes/employer/_middleware.ts

// before — silently ignored, subtree served unguarded
export default [EmployerMiddleware];

// after
export const middleware = [EmployerMiddleware];
```

**What to change.** Boot the app once — `bun zt route:list` is enough. If nothing changes,
you had none of this. If a `_middleware.ts` file was never applying, you will be told which
one, and the routes under it were open until now.

Under `zt dev` a reload that hits this aborts and keeps serving the previously compiled
routes, so a guard never drops mid-session.

### Also worth knowing (not breaking)

- **A save or delete on a model with no primary-key value now raises an error** (1.15.1).
  It used to bind NULL, match no row, and resolve as though it had written. The one way to
  reach it is a partially hydrated instance — `Post.query().select("title").get()`, then
  `save()` on a result — and in that state the write was already being thrown away. What
  changes is that you hear about it: `E_NO_PRIMARY_KEY`, naming the model and the key.
  Select the key column alongside whatever else you need, and the write works as intended.
- **`bun zt route:types` regenerates the Inertia page registry too.** Adding a page and
  getting `TS2345: … not assignable to parameter of type 'PageName'` is now fixed by the
  command whose name says it generates types. `--check` gates on both files.
- **`bun zt test` no longer inherits `.env`'s mail, queue, session and cache drivers.**
  They get their in-process defaults (`log`, `sync`, `cookie`, `memory`) so a suite cannot
  open a real SMTP or Redis connection because of how one machine is configured. A value
  set in the shell still wins, `.env.test` is read and merged last, and `--keep-env` turns
  it off. See [Testing](/docs/testing#bun-test-vs-bun-zt-test).
- **`zt doctor`'s secure-headers check probes the deployed URL** instead of inferring HSTS
  from config, so an app behind a TLS-terminating proxy is no longer reported as
  downgradeable when the header is being sent.

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

## 1.7.2 and 1.7.3

Two patch releases that broke, each on the judgement that the old form had no meaningful
use yet. Both are a find-and-replace.

1. **Rename `echo:` listeners to `socket:`** (1.7.2). `echo:`, `echo-private:` and
   `echo-presence:` in `@on` are now `socket:`, `socket-private:` and `socket-presence:`,
   and the browser global is `window.Socket`, not `window.Echo`. There is no alias, so an
   unrenamed listener never subscribes and nothing says so:

   ```diff
   - @on("echo-private:issues.5,CommentPosted")
   + @on("socket-private:issues.5,CommentPosted")
   ```

2. **Replace `this.title(…)` with `static title`** (1.7.3), as a string or a function of
   the component. It is resolved on every render, so a title that depends on state
   follows it:

   ```ts fragment
   // Before
   override async mount(): Promise<void> {
     this.title(`Search: ${this.query}`);
   }

   // After
   static title = (c: SearchPage) => (c.query ? `Search: ${c.query}` : "Search");
   ```

The [1.7.2](/docs/changelog#172-2026-08-18) and [1.7.3](/docs/changelog#173-2026-08-20)
release notes have the reasons.

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

## 1.2 to 1.3

1. **Compose mixins with `using`.** `ComponentWith(...)` and `BaseModelWith(...)` are
   removed; the base class composes its own mixins:

   ```diff
   - class PostsPage extends ComponentWith(Pagination) {}
   + class PostsPage extends Component.using(Pagination) {}
   - class User extends BaseModelWith(Authenticatable, Roles) {}
   + class User extends Model.using(Authenticatable, Roles) {}
   ```

   A codemod in the repository, `scripts/codemod-mixin-composition.ts`, rewrites the call
   sites and imports. How a mixin is written is unchanged, and `BaseModel` stays exported as
   an alias of `Model`. The [1.3.0 release notes](/docs/changelog#130-2026-08-09) have the
   rest.

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
