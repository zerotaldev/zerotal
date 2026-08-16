# Changelog — @zerotal/arch

All notable changes to this package are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maturity: beta.** The API is close to final and breaking changes are rare, called out
here with migration steps — but a minor release may still contain one.

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
