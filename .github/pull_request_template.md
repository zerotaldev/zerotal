## What

<!-- What does this change do, in a sentence or two? -->

## Why

<!-- The problem or motivation. Link the issue if one exists. -->

## Checklist

- [ ] `bun run typecheck`, `bun run lint:ci`, and `bun run test` pass locally
- [ ] Tests cover the change (a fix carries the test that would have caught it)
- [ ] `api-surface.md` regenerated (`bun run api:surface`) if a public API changed
- [ ] Docs updated if user-observable behaviour changed
- [ ] Baselines (`cast-baseline.json`, `lint-baseline.json`,
      `typecheck-tests-baseline.json`) unchanged — or the PR description
      explains why moving one is justified
