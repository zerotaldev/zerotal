# Changelog — @zerotal/arch

All notable changes to this package are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maturity: beta.** The API is close to final and breaking changes are rare, called out
here with migration steps — but a minor release may still contain one.

## [Unreleased]

### Fixed

Three faults that only appear once the surface is installed into a real app, found by
installing it into this repo's own `apps/docs`.

- **Packages in a workspace were invisible.** `node_modules/@zerotal/*` is a symlink in
  every workspace — this monorepo, `bun link`, any app developed against a checkout — and
  `Bun.Glob` will not descend into one, `followSymlinks` or not. `installedPackages()`
  returned nothing for an app with seventeen packages, so `app_info` reported an empty list
  and `arch:install` wrote generic guidance with none of the per-package sections that are
  the reason it is composed rather than canned. Listed with `readdir` now, which sees the
  link, and read through `Bun.file`, which follows it.

- **The generated Markdown failed the formatter.** `arch:install` wrote files that did not
  pass the `prettier --check .` the project it had just installed into already runs. The
  markers now sit on their own lines with blank lines around them — which is correctness
  before it is formatting, since Markdown parses text pressed against an HTML comment as
  part of that raw-HTML block.

- **`arch:update` fought the formatter over `.mcp.json`.** `JSON.stringify(…, 2)` expands a
  one-element array where a formatter collapses it, so the command rewrote a file it had no
  change to make to, and the next `prettier --write` put it back. Idempotence is now
  measured on the parsed data: when the config already says what it should, the file is
  returned exactly as it was found, in whatever shape its owner keeps it.

## [1.7.0] — 2026-08-16

### Added

- **The agent surface.** An MCP server exposing what the framework already knows about an
  app: `app_info`, `api_surface`, `search_docs`, `routes`, `schema`, `logs`, `last_error`,
  `baselines` and `doctor`. Every tool is read-only and publishes an `outputSchema`.
- **`zt arch:install` / `zt arch:update`.** Writes `.mcp.json`, `AGENTS.md` and a
  `CLAUDE.md` shim, detecting Cursor and VS Code configs alongside. Every generated region
  is marker-fenced, so re-running preserves anything written around it. `--dry` shows what
  would change.
- **`zt arch:probe <topic>`.** Prints one JSON report — `doctor`, `routes`, `schema` or
  `app-info` — for the tools that need a booted app.
- **Dual-era MCP.** Serves the stateless `2026-07-28` revision, including the mandatory
  `server/discover`, and the `initialize` handshake of `2025-11-25` and earlier. The era is
  selected per request.
- **A vendored documentation corpus.** The framework's hand-written pages ship inside this
  package, so `search_docs` is version-matched by construction — no embeddings, no hosted
  API, and no way to answer from documentation for a version the app is not running.
- **A doctor check** reporting whether the MCP server is actually registered anywhere. A
  project that installed the package and never ran `arch:install` has an agent surface
  connected to nothing, which looks exactly like it working.
