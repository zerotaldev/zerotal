# Changelog — @zerotal/arch

All notable changes to this package are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maturity: beta.** The API is close to final and breaking changes are rare, called out
here with migration steps — but a minor release may still contain one.

## [Unreleased]

## [1.7.1] — 2026-08-16

### Fixed

Faults that only appear once the surface is installed into a real app, found by installing
it into this repo's own `apps/docs` and calling every tool.

- **`search_docs` ranked a generated page above the right answer.** Scoring was raw term
  frequency weighted by field, with no length normalisation — so `components.md`, one
  generated page covering 53 components and long enough to mention nearly everything, came
  first for both "send an email" and "how do I write a test for a controller". Now BM25 over
  a small inverted index built when the corpus is read: length normalisation, inverse
  document frequency and term saturation, with title/description/heading matches scored as
  separate fields _outside_ the saturation, since folded in BM25 flattens a title hit to
  about twice a passing mention. Plus light stemming, so "test" meets "testing", and
  hyphenated terms indexed whole and in parts, so "soft deletes" finds `soft-delete`.

  Measured on fourteen questions an agent would actually ask, top-1 relevance went from
  roughly three in ten to twelve in fourteen. The remaining two return related pages rather
  than the best one; tuning further against a list that size fits the list, not the corpus.

- **`last_error` dropped the error.** The framework logs an exception's class in `error`,
  its trace in `stack` and the request it belongs to in `requestId`. The parser named the
  six fields it knew about and discarded the rest, so the tool whose entire job is saying
  _why_ something failed returned the generic `"Unhandled error"` that wraps the real one —
  a line that says nothing. Entries now carry every field the logger wrote, and
  `last_error` renders the exception, the request id and the trace. `logs` shows the first
  two but not the trace: a stack on each of two hundred entries buries the sequence the
  caller asked for.

- **`baselines` reported a ceiling smaller than the command's count, without saying so.**
  The cast baseline ratchets per file and exempts designated boundary modules, so it reads
  455 where `cast:check` prints 466. A reader comparing the two saw debt that had appeared
  between them. The reading now carries a `note` naming the exempt modules.

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
