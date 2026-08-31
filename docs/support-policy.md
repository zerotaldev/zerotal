---
title: Support Policy
description: What Zerotal supports and for how long — Bun versions, databases, release cadence, maturity levels, and deprecation.
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

## Databases

| Database   | Status                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite     | Supported. The default; the full test suite runs against it on every merge.                                                                                                                                                                                                                                                                                                       |
| PostgreSQL | Supported. A smoke suite runs against a real PostgreSQL 16 on every merge — schema DDL and `ALTER`, identity columns, CRUD, type round-trips, unique and NOT NULL enforcement, row locks and transaction rollback — and the job blocks a merge when it fails. The bulk of the ORM suite still runs on SQLite, so the Postgres path is covered more narrowly than the default one. |
| MySQL      | Supported, hardening. The same smoke suite runs against a real MySQL 8 on every merge and blocks on failure. It is newer than the Postgres job and has found one defect already (`string()` was not indexable), so treat MySQL as verified in the paths the suite covers and less proven than PostgreSQL outside them.                                                            |

Redis-backed drivers (cache, session, queue, broadcasting) build on
`Bun.RedisClient` and are tested against the protocol surface it provides.

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
  own section in the Upgrade Guide. Six have shipped so far — the
  `ComponentWith` / `BaseModelWith` removal in 1.3.0, Flow's `socket:` listener
  prefix in 1.7.2, the removal of Flow's `this.title(…)` in 1.7.3, SQLite
  foreign-key enforcement in 1.11.0, `countTokens` returning `number | null` in
  1.11.2, and the refusal to write a boolean into a text column in 1.12.0.
- **One of those five is in the wrong place, and it stays on the record.** 1.11.2
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
- **Cadence:** releases ship when they are ready rather than on a calendar.
  Security fixes are released out of band — see the response windows in
  [SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md).
- **Supported versions:** fixes land on the latest minor of the current major.
  There is no long-term-support line yet; one will be declared when the project's
  adoption warrants maintaining two lines honestly rather than nominally.

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

Nothing is below `stable` today. The table that lived here is empty, which is the
outcome the mechanism is for rather than the absence of one — it is how the review
looks when every date has been answered.

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
opinion about someone's toolchain and stays their choice to invite. `ai` stays out for
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

## Getting help

- **Bugs and feature requests** — [GitHub issues](https://github.com/zerotaldev/zerotal/issues).
- **Security vulnerabilities** — privately, per
  [SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md);
  never in a public issue.
- **Contributing** — the [Contribution Guide](/docs/contributing).
