# Changelog — @zerotal/arch

All notable changes to this package are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Maturity: `stable`** — matching this package's `maturity` field. The public API
follows SemVer strictly: anything importable without an `@internal` marker keeps its
shape for the rest of the 1.x line, and `api-surface.md` is diffed by CI on every
change. That promise covers the MCP tool contract too — the tool names, their inputs
and the shape of what they return — which is the part an agent client is configured
against. `mcp-surface.md` is diffed alongside it.

## [Unreleased]

## [1.8.0] — 2026-08-24

### Added

- **Agent skills — the depth the upfront block cannot afford.** The generated `AGENTS.md`
  is short because every prompt it lands in pays for its whole length, so it points rather
  than teaches. That constraint has a cost: an agent gets a map and no detail, and the
  detail is where the expensive mistakes live. A skill is a file with a one-line
  description that costs nothing until an agent decides it is relevant, so a procedure can
  be written out in full. Two ship — `zerotal-schema-changes` (who owns the schema here,
  the mixin columns nothing declares, and why an unguarded `ALTER TABLE` collides during a
  release's `migrate`) and `zerotal-releases` (naming your own deploy steps, replacing the
  asset directory rather than merging into it, `trustedProxies` behind a proxy, and the
  pipe that hides a test suite's exit status). Both are shaped by the project like the
  block is: the schema skill states this app's actual answer, and refuses to pick a side
  when `synchronize` and migrations are both in play.

  Written to `.agents/skills`, the cross-client path, plus `.claude/skills` when that agent
  is detected. Frontmatter descriptions are JSON-quoted, because unquoted a colon makes the
  rest a nested mapping and the file stops parsing — an inert skill looks exactly like an
  installed one. Overriding a shipped skill is deleting its marker line: a `SKILL.md`
  without the marker is yours and is never rewritten. Turn the whole feature off with
  `ArchConfig({ skills: false })`.

- **`doctor` reports agent instructions that no longer describe this project.** The block
  used to describe the framework, which moved when the framework did. It now also describes
  the project, and every fact in it moves without anyone thinking about the file — add a
  migrations directory, turn `synchronize` off, install a package. It still reads as current
  while describing the app you used to have, and guidance that is confidently out of date
  gets followed. Skills rot the same way and are easier to miss, because nothing reads one
  until an agent decides it is relevant, by which point it is being acted on. The check
  regenerates both in memory and compares, naming `arch:update` as the fix. A warning, never
  a failure: a misleading instruction file does not stop an application working, and this
  check earns the right to gate a deploy by failing only for what would. The server name is
  read back from `.mcp.json` rather than assumed, so a project that renamed its server is
  not reported as permanently stale.

### Changed

- **The generated `AGENTS.md` block describes how this app is set up, not only what it
  installed.** A package list answers "what is available here", which is not the question that
  decides what to write: the framework's contracts are not uniform across projects, and the
  places they differ are the places where guessing wrong compiles cleanly and fails at runtime.
  `detectShape()` reads four facts off disk and the block states only the ones that change an
  instruction — who owns the schema, whether route names are typed, whether
  `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess` are on, and whether there are
  tests to run. Read from files rather than a booted app, because a project that will not boot
  is often why the agent surface is being installed; `.env` is deliberately not among them,
  since this output is committed and pasted into prompts. The `extends` chain is followed, so
  an app inheriting a strict base is not read as unstrict. Additive — a caller that passes no
  shape gets the block it got before.

## [1.7.5] — 2026-08-22

### Changed

- **`@zerotal/arch` is `stable`.** Reviewed ahead of its 1.9.0 date. The public API
  follows SemVer strictly from here, and that promise covers the MCP tool contract —
  tool names, their inputs, and the shape of what they return — because that is what
  an agent client is configured against and nothing type-level can see it. The
  protocol revision the server speaks is not covered; it follows the protocol.

- **INTERNAL — the writers behind `arch:install` are no longer public API.** `detectAgents`,
  `applyMcpConfig`, `serverEntry`, `SERVER_ENTRY_PATH`, `applyBlock`, `fence`,
  `BLOCK_START`, `BLOCK_END`, `agentsPreamble`, `buildGuidelines`, `claudeShim` and
  their types. They are still exported and still work; they are no longer promised.
  Their only caller is `ArchInstallCommand`, and freezing them would have committed
  the shape of `.mcp.json` writing and marker fencing to the rest of the 1.x line on
  behalf of a caller who never arrived. Marked before the label attached rather than
  withdrawn after.

- **INTERNAL — `api-surface.md` now honours `@internal` across every package.** The
  contract has always been stated as "anything importable without an `@internal`
  marker keeps its shape", and the generator did not read the tag: symbols already
  marked internal were recorded as though promised. They are omitted now — 374
  entries across 13 packages, every one verified marked, either at its declaration
  or by a module docblock covering a whole subpath as `@zerotal/core/dev` does.
  Nothing changes at runtime or in the types. What changed is that the file listing
  the promises lists the promises.

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
