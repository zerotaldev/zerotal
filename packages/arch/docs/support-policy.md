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

- **Semantic versioning:** patch for fixes, minor for compatible features, major
  for breaking changes. The [Upgrade Guide](/docs/upgrade) describes the upgrade
  procedure; the [Release Notes](/docs/changelog) list what changed.
- **One exception, while the 1.x line is young:** a breaking change may land in a
  minor or a patch when leaving it in place would cost more than the migration
  does. It is called out in the release notes as **BREAKING**, with the reason and
  the migration steps, and it is never silent. Three have shipped so far — the
  `ComponentWith` / `BaseModelWith` removal in 1.3.0, Flow's `socket:` listener
  prefix in 1.7.2, and the removal of Flow's `this.title(…)` in 1.7.3. This carve-out is a consequence of the project's age, not a
  standing policy; it will be withdrawn, with a version named here, once adoption
  makes the cost of a break real.
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

| Package       | Now            | Reviewed by |
| ------------- | -------------- | ----------- |
| `@zerotal/ai` | `experimental` | **1.9.0**   |

`@zerotal/arch` held `beta` with the same date and was reviewed early, at 1.7.5:
promoted to `stable`. Its surface was narrowed first — the writers behind
`arch:install` are `@internal` now, because they had no caller outside the package
and freezing them would have promised the shape of `.mcp.json` writing to nobody.

`@zerotal/ai` is not in the `zerotal` meta-package and nothing `stable` depends on
it, so the cost of its label falling due is ours and not yours. Neither is `arch`,
still: `arch:install` writes configuration and instruction files into a project,
which is an opinion about someone's toolchain and stays their choice to invite.

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
