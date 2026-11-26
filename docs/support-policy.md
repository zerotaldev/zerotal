---
title: Support Policy
description: What Zerotal supports and for how long — Bun versions, databases, release cadence, support windows and long-term support, maturity levels, and deprecation.
---

# Support Policy

This page is the compatibility contract: which runtime and database versions
Zerotal stands behind, how releases and deprecations work, and what the maturity
label on each package promises. If a claim is not on this page, treat it as
untested.

## Runtime

Zerotal runs on **Bun only**. Node.js and Deno are not supported and there is no
compatibility layer planned — the framework builds directly on `Bun.serve`,
`Bun.sql`, `Bun.CryptoHasher`, `Bun.RedisClient`, S3 storage, and the Bun test
runner, which is where its speed and its small dependency footprint come from.

The supported Bun range is what CI actually proves, not a hopeful floor:

| Bun version           | Status                                            |
| --------------------- | ------------------------------------------------- |
| 1.3.14                | Supported — the tested floor, pinned in CI        |
| Latest stable release | Supported — CI tracks it alongside the floor      |
| Older than 1.3.14     | Not supported — core APIs Zerotal uses are absent |

Every package declares this floor in its `engines.bun` field, so an install on
an unsupported Bun fails at install time rather than at runtime.

### The platform-risk position

Betting on one runtime deserves a stated answer to "what if Bun changes
course?", so this is it:

- **Which Bun APIs are load-bearing:** `Bun.serve` (HTTP), `Bun.sql` (SQLite and
  Postgres drivers), `Bun.RedisClient` (cache, session, queue, broadcasting),
  `Bun.CryptoHasher` and `Bun.password` (crypto and hashing), `Bun.S3Client`
  (storage), `Bun.build` (dev asset pipeline), and the `bun test` runner. A
  breaking change in any of these is treated as a breaking change in Zerotal and
  handled in a release, never silently.
- **How fast Zerotal tracks Bun:** CI runs the tested floor and the latest stable
  Bun on every merge, so a Bun regression that affects the framework surfaces
  within days of the Bun release, not when users hit it. The floor moves forward
  deliberately — in minor releases, with the change called out in the release
  notes.
- **Pinning guidance:** pin the Bun version in production images and move it
  when you upgrade Zerotal, exactly as you would any other runtime.
- **Bun's rewrite in Rust:** Bun 1.3.14 was the last release built from its Zig
  code, and 1.4 is the first built from Rust. Both are tested here — 1.3.14 is the
  floor CI pins, and "latest stable" in CI is the Rust line — so an app can run on
  either today. The floor stays at 1.3.14 until the Rust line has gone several
  releases without a regression that reaches Zerotal, and then moves in a minor,
  announced one minor ahead. A Bun regression that does reach the framework is
  reported to Bun with a reproduction, and worked around in Zerotal with a test that
  fails while it is present, so the workaround comes out when Bun fixes it.

## Databases

| Database   | Status                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite     | Supported. The default; the full test suite runs against it on every merge.                                                                                                                                                                                                                                                                                                       |
| PostgreSQL | Supported. A smoke suite runs against a real PostgreSQL 16 on every merge — schema DDL and `ALTER`, identity columns, CRUD, type round-trips, unique and NOT NULL enforcement, row locks and transaction rollback — and the job blocks a merge when it fails. The bulk of the ORM suite still runs on SQLite, so the Postgres path is covered more narrowly than the default one. |
| MySQL      | Supported, hardening. The same smoke suite runs against a real MySQL 8 on every merge and blocks on failure. It is newer than the Postgres job and has found one defect already (`string()` was not indexable), so treat MySQL as verified in the paths the suite covers and less proven than PostgreSQL outside them.                                                            |

Redis-backed drivers (cache, session, queue, broadcasting) build on
`Bun.RedisClient` and are tested against the protocol surface it provides.

## Dependencies

Zerotal keeps the third-party code it puts into your app as small as it can, and
every package it does install has a stated reason. Where Bun or the web platform
provides a feature, or the code is short enough to own, Zerotal writes it itself.
A package that only some apps need is an optional peer and is not installed for
you: you add it when you turn on the feature that needs it, and the feature's own
page says which. The tables below mark the exceptions still under review.

Installing `zerotal` brings in this third-party package, and what it depends on in
turn:

| Package                 | Comes with      | Why every app gets it                                                                                                                                                                                 |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@js-temporal/polyfill` | `@zerotal/core` | Carbon, the date type, is built on Temporal, which Bun only ships itself from 1.4. Carbon loads it on Bun 1.3 alone, the first time it needs a date. It goes once the supported floor ships Temporal. |

Flow apps also get these, through `@zerotal/flow` and `@zerotal/flow-ui`:

| Package          | Comes with         | Why                                                                                                          |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `typescript`     | `@zerotal/flow`    | The ahead-of-time component compiler reads TypeScript's syntax tree, which Bun's transpiler does not expose. |
| `tailwind-merge` | `@zerotal/flow-ui` | Resolving conflicting Tailwind classes needs Tailwind's own class grammar, which a rewrite would let drift.  |

Flow's browser runtime is not on the list because nothing installs it. Alpine and the plugins
Flow uses are built into the runtime when `@zerotal/flow` is published, and arrive as that one
file, at the versions that release was built with — see
[the client runtime](/docs/flow/performance#the-client-runtime).

This list is checked: CI fails when a package gains a dependency that is not on it.
The rules a package follows are in
[Package Development](/docs/package-development#dependencies).

How the packages are built and published — npm provenance, CI actions pinned by commit,
the publish token held by one job, no install scripts — is on
[Supply-Chain Security](/docs/supply-chain).

## Releases and versioning

All `@zerotal/*` packages and `create-zerotal` share **one version line and
publish lockstep** — a release publishes every package at the same version, in
dependency order, from CI. Never mix versions across packages.

- **What the numbers mean:** a **patch** is anything that does not break —
  a fix, and a feature too. A **minor** carries a breaking change. A **major** is
  an annual consolidation, cut each July. The
  [Upgrade Guide](/docs/upgrade#versioning) explains why the framework is versioned
  this way and describes the upgrade procedure; the
  [Release Notes](/docs/changelog) list what changed.
- **What that costs you:** a caret range crosses a minor, so a project on
  `^1.10.0` takes 1.11.0 and its breaking change without being asked. Pin with a
  tilde if you would rather cross a minor deliberately.
- **A break is never silent.** Every one is called out in the release notes as
  **BREAKING**, with the reason and the migration steps, and the version gets its
  own section in the Upgrade Guide. Ten have shipped so far — the
  `ComponentWith` / `BaseModelWith` removal in 1.3.0, Flow's `socket:` listener
  prefix in 1.7.2, the removal of Flow's `this.title(…)` in 1.7.3, SQLite
  foreign-key enforcement in 1.11.0, `countTokens` returning `number | null` in
  1.11.2, the refusal to write a boolean into a text column in 1.12.0, and the removal of
  Flow's `Component.client(…)` alongside two retired aliases in 1.13.0, and
  `inertia.ssr` no longer registering `POST /__ssr` in 1.14.0, and the model
  timestamps `createdAt` / `updatedAt` / `deletedAt` being typed `Carbon` rather
  than `Date` in 1.15.0, and in 1.17.0 a group of changes to what an app must
  install: the passkey library and Alpine are no longer installed for you, a
  missing sharp or optional Zerotal package throws, and `.vue` pages need
  `@vue/compiler-sfc` 3.3. The same release moved the panels to Tailwind v4,
  gave Flow's route table its own URL, let passkey registration accept any
  authenticator, handed out Bun's own `Temporal` from Carbon, and changed how the
  ORM reads dates.
- **One of those ten is in the wrong place, and it stays on the record.** 1.11.2
  is a patch, and by the rule above a patch cannot carry a break. It did: the
  `countTokens` signature changed in the same release that promoted `@zerotal/ai`
  to `stable`, and the reasoning that allowed it — the package was still
  `experimental` when the change was made, earlier in that release — is not a
  distinction anyone installing 1.11.2 can observe. What they get is a patch that
  breaks. It is listed here rather than argued away, because a policy that quietly
  excuses its own exceptions is not one you can plan against.
- **Provenance:** packages are published with npm provenance, so you can verify
  a tarball was built by this repository's release workflow rather than someone's
  laptop.
- **Cadence:** patches ship when they are ready. Breaking changes are batched onto
  a calendar: at most one minor a quarter, released in January, April or October,
  and the major each July. A quarter with no break to ship gets no minor. Security
  fixes are released out of band — see the response windows in
  [SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md).
- **Supported versions:** each line is supported for a fixed window after its
  successor ships, and the July major is a long-term-support line. The windows are
  in [Support windows](#support-windows) below.

## Support windows

A line is a minor and its patches — 1.18.0, 1.18.1 and so on. Every line moves
through the same stages, and its dates are fixed on the day its successor ships, so
an upgrade can be planned against them rather than guessed at.

| Line                                  | Gets                                                     | For how long                         |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| The newest minor                      | Every fix, and new features in patches                   | Until the next minor ships           |
| An earlier minor                      | Security fixes                                           | Six months after its successor ships |
| The last minor before a major         | Security fixes                                           | Twelve months after the major ships  |
| A July major (long-term support, LTS) | Bug and security fixes, then security and critical fixes | Twelve months, then twelve more      |

- **A security fix** is a fix for anything reported and confirmed under
  [SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md).
- **A critical fix** is a defect that loses or corrupts data, or stops an app
  booting or serving requests, with no workaround in the app's own code.
- **A fix on an older line** ships as a patch on that line — 1.17.5, say — from a
  `1.17.x` branch, through the same release workflow and gates as every release.
  It is published under the npm dist-tag `release-1.17`, so `latest` never moves
  back to an older line. A tilde range already takes it (`~1.17.0`), or install it
  by tag: `bun add zerotal@release-1.17`.
- **An LTS line** is the July major and its patches — 2.0.x. A later minor, 2.1.0
  in October, carries breaking changes as usual; an app that would rather not take
  them stays on 2.0.x and gets its fixes for two years.

Quarterly minors keep this load honest. At any time there is the newest minor, at
most two earlier minors inside their six months, the current LTS, and while a major
is fresh the last minor before it. Only the newest minor and the LTS in its first
year take ordinary bug fixes; every other line takes security and critical fixes
alone. That is a load one maintainer can carry, which is the test these windows were
set against.

The windows start with 1.17. Lines superseded before this policy was published are
not covered: an app on 1.16 or older should upgrade to 1.17 or later to be inside
one.

| Line             | Gets              | Until                                 |
| ---------------- | ----------------- | ------------------------------------- |
| 1.18.x           | Every fix         | 1.19.0 ships, not before January 2027 |
| 1.17.x           | Security fixes    | 26 May 2027                           |
| 1.16.x and older | Nothing — upgrade |                                       |

The next breaking releases are on the calendar:

| Release | When         | What                                                  |
| ------- | ------------ | ----------------------------------------------------- |
| 1.19.0  | January 2027 | A breaking minor, if there is a break to ship         |
| 1.20.0  | April 2027   | A breaking minor, if there is a break to ship         |
| 2.0.0   | July 2027    | The major, and the first LTS — supported to July 2029 |

## Maturity levels

Each package declares a `maturity` field in its `package.json`, and the label is
a contract, not a mood:

- **stable** — the public API follows SemVer strictly. Anything importable that
  does not carry an `@internal` marker is covered by the compatibility promise,
  and its shape is snapshotted in the package's `api-surface.md`, which CI diffs
  on every change.
- **beta** — the API is close to final and breaking changes are rare, called out
  in release notes with migration steps, but a minor release may still contain
  one. Production use is reasonable if you read release notes before upgrading.
- **experimental** — no compatibility promise. The API may change or the package
  may be absorbed into another in any release. Build on it with your eyes open.

### A label below stable carries a review date

An honest "experimental" is useful once and corrosive indefinitely: a package that
has worn the label for a year is not being cautious, it is unowned. So each one
below `stable` names the release by which it is reviewed, and the review has three
outcomes — promote, keep with a new date and the reason, or withdraw.

| Package             | Level  | Reviewed by | Why it is not `stable` yet                                                                                                           |
| ------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@zerotal/settings` | `beta` | 1.20.0      | New. Its design comes from two production apps' hand-built versions, but no app has run this package yet. It graduates once one has. |

Before `@zerotal/settings` arrived, nothing was below `stable`, and this table was
empty. That is the outcome the mechanism is for: every date had been answered.

`@zerotal/ai` was the last entry, `experimental` and due by 1.11.0. It was promoted in
1.11.2, and the precondition it carried was met rather than waived: it graduates in the
release after its first real users, and its first production users sent a field review
of the driver against Anthropic. That review is why the promotion is worth anything —
five bugs came back with it, and a `stable` promise about an API nothing has pushed
against is a promise nobody has tested.

The order was deliberate. Its surface was narrowed **before** the label, because
narrowing after `stable` is itself a breaking change: `toSchema`, `strippedConstraints`,
`resetSpend` and `resetStats` are `@internal` now. `translateSchema` stayed public
despite having no caller outside the package, for the same reason `AiDriver` did — the
whole point of a driver contract is that someone else implements it, and implementing
structured output requires translating a schema. Then its two riskiest modules were
tested: the SSE parser, which reads a remote provider's framing off the network, and
prompt redaction, which is the only thing between a user's prompt and a log that
outlives the request.

`@zerotal/arch` held `beta` with the same date, was reviewed ahead of it, and is
`stable` — the release that carried the promotion is the one its
[changelog](/docs/changelog) names. Its surface was narrowed first too: the writers
behind `arch:install` are `@internal`, because they had no caller outside the package
and freezing them would have promised the shape of `.mcp.json` writing to nobody.

Neither `ai` nor `arch` is in the `zerotal` meta-package. `arch` stays out because
`arch:install` writes configuration and instruction files into a project, which is an
opinion about someone's toolchain. A new app from `create-zerotal` does get it, with
the files already written, because an agent that is never told what the framework
ships tends to write its own. One flag, `--no-agent`, declines it, and an existing app
still adds it only by choice. `ai` stays out for
its own reason rather than by omission: it is the only package with an optional peer
on a vendor SDK, and pulling it into the meta-package would put a provider dependency
in front of every app that installs `zerotal`, including the ones with no AI in them.

That table used to be the whole of the commitment, which meant the version could
sail past it and the only consequence would be this paragraph quietly becoming
untrue. The review release now lives in each package's `package.json` as
`maturityReview`, and the package-conventions gate fails once the version reaches
it — so the deadline is a build failure rather than a promise.

A package is never more mature than what it is built on: a stable package whose
foundation can change under it is not stable, whatever its own label says. So
`@zerotal/admin` and `@zerotal/monitor` cannot pass `@zerotal/flow`, and the
maturity of your app is the lowest level among the packages it actually uses.

## Deprecation policy

In stable packages, an API is never removed in the release that deprecates it:
deprecation lands in a minor release (a `@deprecated` marker with the
replacement named, and a runtime warning where one is practical), the API keeps
working for the remainder of the major line, and removal happens at the next
major. Release notes list every deprecation and every removal.

## If the maintainer steps away

Zerotal has one maintainer today, who holds the npm and GitHub access. A framework
you build a business on should say plainly what that means and what happens if it
changes:

- **Nothing is lost.** Every package is MIT-licensed and built from this repository.
  The release workflow, the publishing script and every gate CI runs are in it, so a
  fork can build, test and publish the whole framework under its own npm scope
  without anything that lives only on the maintainer's machine.
- **A pause is announced.** If no release has shipped for 90 days, the README says
  so at the top: whether the project is paused, handed over, or ended. Silence is
  not one of the options.
- **A handover is public.** If someone takes the project on, the change of npm and
  GitHub ownership is announced in the release notes before their first release, so
  no package changes hands unannounced.
- **A second owner** for the npm organisation and the GitHub organisation is the
  next step, and this section will name the arrangement once it is in place.

## Getting help

- **Bugs and feature requests** — [GitHub issues](https://github.com/zerotaldev/zerotal/issues).
- **Security vulnerabilities** — privately, per
  [SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md);
  never in a public issue.
- **Contributing** — the [Contribution Guide](/docs/contributing).
