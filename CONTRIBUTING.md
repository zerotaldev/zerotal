# Contributing to Zerotal

Thanks for wanting to contribute. The full guide — local setup, repository
layout, the `@zerotal/core` public-surface rules, and how each subsystem is
organized — lives in [docs/contributing.md](docs/contributing.md) and is
rendered on the docs site as the Contribution Guide.

## The short version

Zerotal is a Bun-native workspace. Node.js is not supported as a runtime.

```bash
bun install       # wires all packages/* and apps/* together
bun run test      # the whole workspace's suites
```

Every pull request must pass the same gates CI runs:

```bash
bun run typecheck          # strict TS across every package
bun run typecheck:tests    # strict TS including *.test.ts, against its baseline
bun run lint:ci            # ESLint against the committed baseline
bun run lint:packages:ci   # package-convention linter
bun run format:check       # prettier
bun run cast:check         # cast ratchet — casts may not grow
bun run api:surface:check  # public API snapshots — diffs are reviewed, not incidental
bun run test               # all workspace tests
```

Three of those maintain committed baselines (`lint-baseline.json`,
`cast-baseline.json`, `typecheck-tests-baseline.json`). The rule for all three:
**baselines only go down.** A change may remove debt freely; adding to it needs
the baseline moved as a deliberate, reviewed step with the reasoning in the PR
description.

## Ground rules

- **One change per PR.** A fix, a feature, or a refactor — not all three.
- **Tests come with the change.** A bug fix carries the test that would have
  caught it; a feature carries coverage for its contract.
- **Public API changes show up in `api-surface.md`.** Regenerate with
  `bun run api:surface` and include the diff — that file is the review surface
  for what the package promises.
- **Docs are part of the change** when behaviour a user can observe moves.
  Hand-written pages live in `docs/`.

## Security issues

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md)
for the private reporting channels and what to expect after reporting.
