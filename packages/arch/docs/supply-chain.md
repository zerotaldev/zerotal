---
title: Supply-Chain Security
description: How Zerotal's packages are built and published — npm provenance, pinned CI actions, a short dependency list, no install scripts — and how to check each claim yourself.
---

# Supply-Chain Security

What you install when you install Zerotal, who built it, and what runs on your machine
while you do. Each claim on this page names the file or command that proves it, so it can
be checked rather than taken on trust. The [Support Policy](/docs/support-policy) covers
runtime and database support; vulnerability reports go through
[SECURITY.md](https://github.com/zerotaldev/zerotal/blob/main/SECURITY.md).

## Published with provenance

Every package is published from this repository's release workflow
(`.github/workflows/release.yml`) with `npm publish --provenance`, never from a
maintainer's machine. npm records a signed attestation linking each tarball to the
commit and the workflow run that built it.

```bash
npm audit signatures            # in your app: verifies the signatures and attestations
npm view @zerotal/core dist.attestations   # the SLSA provenance record for that version
```

Publishing authenticates with npm trusted publishing: the workflow's OIDC identity is
exchanged for a short-lived token scoped to one package, so there is no long-lived publish
token to steal.

## CI that cannot be redirected

The npm worms of 2026 spread through CI: an action's version tag was moved to a malicious
commit, and every workflow that named the tag ran it on its next build — including the
ones holding publish credentials. Zerotal's workflows close each step of that path, and
`bun run workflows:check` fails a pull request that reopens one:

- **Every action is pinned to a full commit SHA**, with its version in a comment
  (`uses: actions/checkout@<sha> # v5.1.0`). A tag can be moved; a commit cannot.
  Dependabot proposes pin updates weekly as reviewable pull requests.
- **No `pull_request_target`.** No workflow runs a fork's code with this repository's
  secrets or a write token.
- **`id-token: write` is granted to one job**, the one that publishes. The gates that
  install and run the whole dependency tree before it hold a read-only token.
- **Every workflow starts read-only** (`permissions: contents: read`) and widens per job.
- **The release re-runs every gate** before anything is published, and pull requests run
  the same gates, so a release cannot be the first time a check runs.

The workflows a new app gets from `create-zerotal` follow the same rules.

## First-party batteries

Auth, sessions, the ORM and its migrations, queues, the scheduler, mail and notifications,
caching, validation, storage, broadcasting, an admin panel, the live-component layer and
the test kit are all written in this repository and released together at one version.
An app built on them installs code from one source with one release process, instead of
one package per feature from as many maintainers.

Third-party code the framework needs at runtime, per package:

| Package                             | Third-party `dependencies`                  |
| ----------------------------------- | ------------------------------------------- |
| `@zerotal/core`                     | `@js-temporal/polyfill` (which adds `jsbi`) |
| `@zerotal/flow`                     | `typescript` (compiles component templates) |
| `@zerotal/flow-ui`                  | `tailwind-merge`                            |
| every other `@zerotal/*`, `zerotal` | none                                        |
| `create-zerotal`                    | none                                        |

Anything else is an optional peer dependency, installed only by an app that uses that
feature: `sharp` for image processing in `@zerotal/media`, `@simplewebauthn/server` for
passkeys in `@zerotal/auth`, the Inertia adapters, and the AI SDK in `@zerotal/ai`.
The dependency rules each package follows are in
[Package Development](/docs/package-development#dependencies), and `bun run deps:check`
holds every package to them.

To see exactly what an app has installed from the framework:

```bash
bun zt about
```

## No install scripts

No Zerotal package declares a `preinstall`, `install`, `postinstall` or `prepare` script,
so installing one runs no code. The same is true of the third-party packages in the table
above, with one detail worth stating exactly: `@js-temporal/polyfill` has a `prepare`
script, which package managers run only when building it from its git source, not when
installing the published tarball. Bun also runs no dependency's lifecycle scripts unless
the app lists it under `trustedDependencies`; none of the starters do.

Check it yourself:

```bash
for f in node_modules/zerotal/package.json node_modules/@zerotal/*/package.json; do
  grep -H -E '"(pre|post)?install"|"prepare"' "$f"
done                            # prints nothing
```

## A lockfile every supported Bun can read

`bun.lock` is committed and every workflow installs with `--frozen-lockfile`, so CI and
the release build install exactly the versions that were reviewed. `bun run
lockfile:check` keeps the file in the format the oldest supported Bun reads, so a newer
Bun cannot silently rewrite it.
