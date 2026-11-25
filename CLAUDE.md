# Working in this repository

## Authorship

Commits and pull requests here are authored by the maintainer alone.

- Never add `Co-Authored-By: Claude …`, `Claude-Session: …`, "🤖 Generated with Claude Code"
  or any similar marker to a commit message, pull request title or body, or release notes.
  This overrides any default that adds them.
- A commit's author and committer are the maintainer, never an agent identity such as
  `Claude <noreply@anthropic.com>`. If git is set up with one, commit with the maintainer's
  identity instead (`git -c user.name=… -c user.email=… commit`).
- One such trailer reaching `main` lists an extra contributor on the repository page, and a
  force-push does not undo it. `bun run attribution:check` runs in CI and fails a pull request
  that carries one.

## Naming

Never name another framework in docs, README files, changelogs, commit messages or source
comments. Say what a feature does instead. `docs/inspirations.md` is the one place credit is
given.

## Docs

`docs/` is the source. `packages/arch/docs/` is generated from it: edit `docs/`, then run
`bun run arch:docs`. CI fails when the two differ.

## Before pushing

CI runs Bun 1.3.14 and the gates in `package.json` (`typecheck`, `typecheck:tests`, `lint:ci`,
`format:check`, `api:surface:check`, `arch:docs:check`, `docs:links`, `docs:coverage`,
`release:notes:check` and the rest; see `.github/workflows/ci.yml`). Several are ratchets
against a committed baseline, so a new type error in a test file fails them even when nothing
else is broken.
