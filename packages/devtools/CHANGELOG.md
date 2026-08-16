# Changelog — @zerotal/devtools

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **Durations printed their whole float.** `fmt()` interpolated the number raw, so anything
  measured with `performance.now()` — every Flow action, in the always-visible status bar —
  read `3.6370999999926426ms`, while anything a caller had already rounded read `0ms` for a
  query that plainly took time. Precision now follows magnitude: `0.42ms`, `3.6ms`, `143ms`,
  `1.4s`. Numeric cells also use tabular figures, which is what made the request list's
  right-aligned column ragged.

- **Timeline legend swatches floated away from their labels.** The legend reuses `.tmark` for
  its colour, and `.tmark` is absolutely positioned for the waterfall — so in the legend,
  whose rows are not positioned, all seven squares escaped to the nearest positioned ancestor
  and stacked above their own text.

- **The panel covered the bottom of the page.** It is fixed to the viewport and reserved no
  space, so the last strip of any page — 32px collapsed, the panel's full height open — could
  not be scrolled to. The host page now gets matching bottom padding, updated on toggle and
  resize, and `--zt-dt-height` is published on `<html>` for an app that would rather move
  something of its own.

- **Muted text failed WCAG AA, and focus was invisible.** `--muted` sat at 2.35:1 on the tab
  strip — below AA for text of any size, and this is 10–11px text. It now measures 4.69:1 on
  the strip and 5.50:1 on the status bar in dark, 5.38:1 in light. `:focus-visible` was
  suppressed panel-wide, leaving keyboard navigation with no indicator at all; focusable
  controls now draw a ring.

### Added

- **A contributed panel can read the selected trace.** `DevtoolsPanelPlugin.render` now
  receives a second `context` argument carrying the trace selected in the request list. A
  plugin exists because it owns live browser state, but the same events usually have a
  server half recorded against a trace, and a plugin that could not reach it had to either
  measure again client-side or show half the story in a tab of its own. `@zerotal/flow`'s
  time-travel frames now print what each action cost on the server. The argument is
  optional, so a plugin written against the one-argument form is untouched.

- **`hidden` on a channel descriptor.** Records the entries on the trace but gives them no
  tab, for a package that renders the data somewhere better than a generic row list. Flow
  declares its actions this way now that its own panel prints them on the frame they belong
  to.

- **`TraceSink.finalise` — a trace for work that never was an HTTP request.** The sink let
  a package buffer against a context but gave it no way to say that context was finished,
  and a trace was only ever built from core's `RequestHandled` / `RequestFailed`. Anything
  running against its own context outside the HTTP lifecycle therefore buffered its
  evidence and dropped it: a Flow action over the WebSocket, and by the same mechanism a
  queue job or a scheduled task.

  `finalise(ctx, { startMs, durationMs, method })` builds the trace and pushes it. `method`
  labels a synthetic request in the list — `@zerotal/flow` passes `FLOW`, which gets its own
  colour so an action does not read as a second `GET` of the page it ran on. Finalising is
  once per context, whichever claims it first, so a context that finalises itself can never
  push a duplicate carrying none of the evidence.

  Found by wiring DevTools into this repo's own `apps/docs`: the Flow tab could only ever
  report "No flow activity during this request".

## [1.7.0] — 2026-08-16

### Added

- **An App section: the framework as it _is_, not only as it just behaved.** Every surface
  until now read the trace stream — what one request did. The framework's own registries
  were CLI-only or invisible, so "is that route even registered", "who bound `cache`",
  "which provider is costing 200ms of boot" and "does anything actually listen to
  `OrderPlaced`" were all answered by reading source.

  Six tabs behind a **Requests | App** switch in the tab strip — two sections rather than
  fifteen tabs in one scrolling strip, because they answer different questions:

  - **Routes** — method, path, name, handler, middleware. GETs are clickable.
  - **Config** — the resolved tree, flattened to dotted paths, with secrets masked.
  - **Container** — every binding, its kind, and **which provider bound it**.
  - **Providers** — boot order and per-provider cost.
  - **Events** — application listeners and framework subscribers in one list.
  - **Commands** — console commands and scheduled tasks. A task that fails at 03:00 used
    to leave no trace in the tool whose job is to show you what your app did.

  One read of one map shared by all six, since six requests for it would be six answers
  that can disagree. Behind the same gate as everything else.

- **Every location in the panel is a link into your editor.** A repo-wide search for any
  editor URL scheme used to return nothing: no stack frame, query, log line, or prop in any
  Zerotal surface was clickable to source. Going from "this query is slow" to the line that
  ran it is the most frequent move in a debugging session, and it was two manual searches.

  `editor` in `config/devtools.ts` takes `vscode`, `vscode-insiders`, `cursor`, `windsurf`,
  `zed`, or `webstorm`; `editorPathMap` rewrites paths for editing on a machine that is not
  the one running the code.

- **Queries and log lines know where they came from.** One stack walk per recorded event,
  filtered to application frames — the first frame that is _not_ framework code is the
  answer, and every frame above it is noise.

  This was the plan's one item of genuinely unknown viability, so it was measured before it
  was built: **~2µs per capture, flat from stack depth 5 to 80**, because the engine builds
  the trace lazily. A request running forty queries pays about 0.08ms. On by default;
  `captureSource: false` turns it off.

- **An Exception tab.** Type, message, and the full stack with every frame a link. Framework
  frames are kept and dimmed rather than dropped — you read a stack trace to find out how you
  got somewhere, and a trace with the middle removed does not tell you that.

- **Three more tabs, from events already on the bus and going nowhere.** **Models**
  (`ModelChanged`, grouped per model — a request that wrote four rows and one that wrote none
  looked identical), **Transactions** (`TransactionCommitted` / `RolledBack` — a rollback
  showed only as queries that appeared to succeed), and **Outgoing** (`OutgoingRequestCompleted`).

- **The Request tab shows the whole exchange.** Response headers and the status line
  alongside the request, plus **session key names** — "is the CSRF token there, did the flash
  survive the redirect" are answered by the keys, and the values are the request's real state
  on a trace kept for a day. `headers: ["x-tenant"]` (or `["*"]`) opens up the request headers
  the built-in allowlist withholds; `cookie` and `authorization` are never recorded whatever
  you ask for.

- **What the browser measured, on the Timeline.** The panel reported server duration as
  though it were the user's experience. A 12ms response the browser spends 900ms painting is
  a slow page, and nothing in the trace said so — so TTFB, parse, load, and first paint now
  sit above the waterfall, labelled as the page's rather than this request's.

### Security

- **The Config tab masks a bare `key`, which the shared rule does not.** `app.key` is the
  application's encryption key; the package-wide list covers `api_key` and `private_key` but
  not `key` alone, which is right for a query binding — a column called `key` is usually a
  lookup key — and wrong for config, where secrets are _supposed_ to live. Config gets the
  stricter rule, `dsn` with it, on top of whatever the app's own `allow`/`deny` say.

- **An access gate, so running the inspector outside development is a supported thing to do
  rather than a lie about `APP_ENV`.** It was all-or-nothing on the dev-surface check, which
  is the right default and the only option — and Phase 4 widens what it exposes considerably.

  ```ts
  export default DevtoolsConfig({
    enabled: null,          // null → follow the dev-surface gate (unchanged default)
    gate: async (req) => …, // required anywhere else; absent is a refusal
  });
  ```

  A development process always passes — a gate that can lock a developer out of their own
  machine gets switched off, and then nothing is gated. Anywhere else the absence of a gate
  is a **refusal**, a throwing gate is a refusal, and one gate answers for every endpoint:
  the stream, the trace JSON, the dashboard, and the panel bundle are the same secret.
  Unauthorised requests get 404, not 403 — outside development the honest answer to a
  stranger is that there is nothing here.

  Auto-injection of the panel script is now dev-only. On a gated environment it would go into
  every visitor's HTML and then 404 in their console; there the way in is the dashboard.

- **The panel remembers, follows, and gets out of the way.** Five things it could not do:

  - **Resize.** The height was 380px, which is either too little to read a stack trace in or
    too much to see the page under. Drag the strip above the tab row; the height is kept.
  - **Light theme.** Follows `prefers-color-scheme` by default, with a toggle in the bar
    cycling auto → dark → light for when the panel and the page you are debugging disagree.
  - **Facets.** Method chips (only the verbs actually recorded), status-class chips, and
    `errors` / `slow` / `n+1` toggles, composing with the text box rather than replacing it.
    `POST` plus `5xx` means failing writes, not writes-or-failures.
  - **Keyboard navigation.** `j`/`k` through the filtered list, `1`–`9` for tabs, `/` to
    focus the filter, `Esc` to close. Only while the panel has focus — it is an overlay on
    somebody's application, and binding `j` globally would navigate the trace list every time
    a developer typed into their own form.
  - **Copy buttons** on every SQL statement (and the whole statement list), log line, header
    block, channel entry, and prop path.

- **New traces are offered, not forced.** While pinned, the bar shows `⤒ N new` instead of
  silently accumulating. A list that scrolls away from what you were reading is the one
  thing a request inspector must not do.

### Changed

- **The browser client is a directory, not a 1,400-line closure.** `client.ts` held its
  state, its transport, its styles, eight renderers, and every helper in one function scope
  — which made adding a tab an edit to the middle of it, and made none of its logic reachable
  from a test. It is now `src/client/`: a store, a transport, a shell, and one file per tab.
  Adding a tab is adding a file.

  No behaviour was dropped. Both mount modes still run one set of renderers, both extension
  doors are unchanged, and `@zerotal/devtools/client` still resolves — the subpath now points
  at `src/client/index.ts`.

- **Rows are reconciled rather than rebuilt.** Every arriving request used to replace the
  whole content pane, which threw away the scroll position, every open `<details>`, every
  loaded mail-preview iframe, and the caret in the filter box — the last of which the old
  panel worked around by re-focusing and re-selecting the field after each keystroke. A keyed
  list diff (about sixty lines, no dependency) now inserts one node and touches nothing else,
  and tabs that read a single trace are not redrawn at all until that trace changes.

- **The request list is windowed above 200 rows**, so `DevtoolsConfig({ capacity: 5000 })` is
  a list you can scroll rather than five thousand nodes.

### Fixed

- **A negative render window.** Whenever the request list shrank under a scrolled viewport —
  which is every "clear" — the windowing arithmetic asked for a slice starting past the end
  of the list. Found by the test that could finally be written for it.

- **An Inertia tab, with the prop tree.** `@zerotal/inertia` has always resolved the richest
  data in the framework — per-prop metadata, request classification, batch correlation — and
  shipped no UI for it, while this panel shipped the UI and knew nothing about Inertia. A
  developer got a panel that could not show a prop and an extension that could not show a
  query, and neither could answer "this page is slow — is it the query or the deferred prop?"

  Inertia now contributes a channel, and one row shows the component, its props, **and** the
  SQL that produced them. Nothing matches a key: the entry is recorded against the same
  request context as the queries, so the two cannot disagree about which request they
  describe.

- **Channels choose how they are drawn.** A flat list of rows is right for an audit feed and
  wrong for a prop map or a route table, and a package that needs a tree should not have to
  ship a renderer into devtools to get one. `TraceChannelDescriptor` gains `render` —
  `"rows"` (the default, unchanged), `"tree"`, `"table"`, `"kv"`, `"grouped"` — plus
  `treeField`, `treeBadge`, `groupBy`, and `flags`. All of it crosses the wire as data, so
  this remains the only channel-rendering code in the panel however many packages contribute.

- **Correlated requests fold together on the All tab.** A channel names the field that
  relates traces (`traceGroup`); everything sharing a value there collapses under the oldest
  member with a `+N` toggle. One thing you did is often several requests — a visit and the
  deferred props that follow it — and listing them as unrelated siblings is how the request
  you are reading gets pushed off the top.

- **Badge chips are accented by hashing their own text**, so `partial` and `deferred` are
  tellable apart at a glance without devtools holding a list of every value any package
  might use. Stable per value, so a badge keeps its colour between requests.

- `buildPathTree` and `traceGroupKey` are exported from `@zerotal/devtools/client`, for the
  same reason `matchesFilter` is: they are the parts of the panel that are logic rather than
  markup, and they are worth testing without a DOM.

### Changed

- **The redaction walk moved to `redactGraph` in `@zerotal/core/security`**, and the Inertia
  recorder runs the same one. Both had independently solved the same three problems — cycles,
  depth, and values that read better flat than walked — and only one of them had to.
  Markers are still each caller's own: a panel's `‹redacted›` is a display choice, while an
  adapter implementing a published protocol has `[REDACTED]` specified for it. Sharing the
  traversal does not mean agreeing on the words. No behaviour change.

- **Failed requests say what failed.** `RequestFailed` has always carried the error
  message; the trace dropped it, so a request that threw showed as a red status code with
  nothing to read beside it. Traces now carry an `exception` (`message` and `status`), the
  Queries tab leads with it, and the All tab marks the row and shows the message inline —
  so you can find the request that broke without opening each one in turn.

- **Mail previews.** The rendered HTML of every captured email has crossed the wire on
  every request since mail capture landed, and has never been shown. Each mail now has a
  **Preview**, collapsed by default, rendered in a fully sandboxed frame — no scripts, no
  same-origin access, no navigation. The sandbox is not optional hardening: the panel lives
  in a shadow root on the app's own origin, so inserting a template's markup inline would
  make any user input inside a mail a self-XSS on every dev machine.

- **N+1 warnings say what to do about them again.** Each warning now carries the eager-load
  that removes it and the `DB.allowNPlusOne(…)` call that suppresses it when the repetition
  is intended. A warning without a remedy is half a feature.

- **The panel remembers where you were.** Whether it was open, which tab you were on, and
  what you had filtered to survive a reload. On a page you are reloading _because_ you are
  debugging it, that was the wrong moment to lose your place.

### Fixed

- **`capacity` did not do what it said.** The browser panel trimmed its list at a hardcoded
  100 regardless of config, so an app with `DevtoolsConfig({ capacity: 250 })` received 250
  traces in the opening frame and then silently lost everything past 100 as soon as the next
  request arrived. The stream now sends the store's capacity and the panel trims to it.

- **A circular argument to `console.log` threw out of the log capture** and into the
  caller. The capture ran `JSON.stringify` on the raw argument, so anything
  self-referential — a model with a loaded relation back to its parent, a request object —
  raised `Converting circular structure to JSON` from inside a patched `console.log`.

### Security

- **Redaction covered query bindings only.** Console log arguments, channel entries, and
  cache keys were streamed to the browser and written to `.zerotal/devtools.sqlite`
  unredacted, where they sat for a day — so one `console.log(user)` during a debug session
  wrote a full user record, password hash included, to disk.

  All four are now masked at the sink, where the value enters the trace rather than where
  the panel draws it: redacting in a renderer protects nothing, because the unredacted copy
  is already persisted by then. One rule decides all four, so `allow` and `deny` in
  `config/devtools.ts` mean the same thing everywhere. A cache key keeps its name and loses
  only what follows it, so the Cache tab stays legible.

  New exports: `redactValue`, `redactCacheKey`, and `isSensitiveName`.

### Removed

- **`src/panel-app.js`** — ~500 lines of the pre-`client.ts` panel, unimported, unbundled,
  and unserved since the rewrite.

## [1.6.2] — 2026-08-15

### Fixed

- **The panel's event stream was abandoned rather than closed on shutdown**, so the browser
  was left holding a truncated chunked response and logged
  `GET /__zerotal/devtools/sse net::ERR_INCOMPLETE_CHUNKED_ENCODING` — under `serve --dev`,
  on every save. Nothing was broken by it (`EventSource` reconnects on its own), but a
  devtools panel that fills the console with network errors is working against its own
  purpose. Shutdown now closes each open stream, which writes the terminating chunk and
  ends the request the way a reader expects.

  On Windows the fix needed [`@zerotal/core`](../core/CHANGELOG.md)'s side too — a worker
  that is terminated outright never reaches this code.

### Added

- **A heartbeat on the event stream.** A comment frame every 25 seconds, which readers
  ignore. Without one an idle stream can be dropped by an intermediary with nothing written
  for either end to notice it by, and the panel goes on reporting a connection it no longer
  has. The timer is unref'd, so it never holds a process open.

## [1.5.1] — 2026-08-15

### Fixed

- **DevTools never activated.** The panel was missing from every app, in every mode,
  however the environment was configured.

  `DevtoolsProvider` gated itself on `isDevSurfaceAllowed(Bun.env["APP_ENV"])`, which fails
  twice over. `APP_ENV` holds the _runtime mode_ by the time a provider boots — `setAppEnv()`
  replaced it — so the check was asking whether `"web"` is a development environment. And it
  was the one dev gate that did not honour `ZT_DEV`, the flag the dev orchestrator sets on
  the server it supervises, so `zt dev` did not rescue it either.

  It asks `devSurfacesEnabled()` now, which reads the preserved deployment name and honours
  `ZT_DEV`. Still fails closed: an unset, `staging` or `production` deployment does not get
  the unauthenticated trace inspector.

## [1.5.0] — 2026-08-15

### Changed

- **Maturity is now `stable`.** The public API is covered by the SemVer promise from
  here: anything importable without an `@internal` marker keeps its shape for the rest
  of the 1.x line, and `api-surface.md` is diffed by CI on every change. The package
  earned it by being small and self-contained — 32 exported symbols, a single dependency
  on `@zerotal/core`, no breaking change since its first release, and the one internal
  seam (`_setTraceStore`) correctly marked. The in-page panel extension API
  (`window.__zerotalDevtools`, used by Flow to contribute its Timeline tab) is part of
  that promise.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Added

- **Extensible panel — other packages can add their own tab.** The injected panel now exposes a global registry, `window.__zerotalDevtools`, that any package's browser code pushes a panel into: `window.__zerotalDevtools?.register({ id, title, badge?, render })` adds a tab alongside Queries/Logs/Request/Mail/Cache/Jobs, and `refresh(id)` pushes a live update (badge + re-render the open tab). Registration is order-independent (the registry is created by whichever runs first) and optional-peer friendly (guard with `?.`; a no-op when devtools isn't present). Panels render into the shared Shadow-DOM content area, so the devtools CSS classes/variables are available and contributed tabs match the panel without shipping styles. The `DevtoolsPanelPlugin` type is exported for TypeScript consumers. First consumer: `@zerotal/flow`'s time-travel Timeline. See [Extending the panel](/docs/devtools#extending-the-panel).

### Changed

- Moved service provider to `src/provider/`.
