# Changelog — @zerotal/inertia

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.10.0] — 2026-08-30

### Fixed

- **React SSR emits the page's `<Head>` tags.** The React branch rendered the page
  component directly — `createElement(Page, props)` — which produces correct body
  markup and drops every `<Head>` on the page. `<Head>` renders nothing; it reports
  its children to a head manager it reads from context, and rendering the component
  alone puts none there. So a page that set a title, a description and an og: card
  contributed all three to nothing, and the server sent the template's `<head>`
  verbatim. Nothing failed and nothing logged — the page was perfect in a browser,
  where React had run — and a link pasted into a chat was a grey rectangle with a
  domain in it.

  Both server-rendered paths (`inertiaStream()` and `POST /__ssr`) now render through
  `@inertiajs/react`'s `<App>`, which installs the head manager, and splice what comes
  back into the template's `<head>`. **React apps using SSR must have
  `@inertiajs/react` installed** — the same adapter the browser entry point already
  uses; a missing one is now a named error rather than a silent omission.

- **An injected head tag replaces the template's, rather than being appended after
  it.** This applies to Vue as well, where head injection did work: the templates all
  ship a `<title>`, and a document with two titles is a document with the _first_
  one. The page's tag was present, correct and ignored. A rendered `<title>` now
  replaces the template's, and a `<meta>` replaces the one with the same `name` or
  `property`; anything with no counterpart is appended before `</head>`.

- **The React SSR root is marked `data-server-rendered`, and the page script comes
  first.** The streaming branch emitted an unmarked `<div id="app">`, so the client
  discarded the server's markup and rendered the page a second time — paying for SSR
  and then throwing it away. `POST /__ssr` also returns the same body shape as the Vue
  branch now (the whole Inertia root, ready to drop into a template) instead of the
  bare component HTML.

### Documented

- **["What a crawler sees"](/docs/inertia/ssr#what-a-crawler-sees)** — `inertia()` does
  not server-render the component at all, which is the normal Inertia arrangement and
  worth saying out loud: the served document is a `<title>` and a JSON blob. The page
  names which readers run JavaScript (browsers, search engines on a second pass) and
  which do not (every link-preview scraper, `curl`, most reader tools), and the three
  ways to give the second group something to read.

## [1.9.0] — 2026-08-29

### Fixed

- **A rebuilt bundle no longer 404s on a chunk the browser asks for.** `resources/js/app.tsx`
  builds to `/assets/app.js` under that name every time, while `splitting: true` names each chunk
  after its content. A rebuild therefore rewrites `app.js` to import `chunk-NEW.js` and prunes
  `chunk-OLD.js` — and a browser holding a cached `app.js` asks for the pruned one and gets

      GET /assets/chunk-hrnspqda.js  status=404

  from a page that renders and a server that is healthy. Nothing in that line leads back to the
  template.

  The template hardcodes `/assets/app.js` rather than calling `asset()`, so the version token the
  rest of the framework appends never reached it, and cache-busting had only ever been
  implemented for `--dev-worker`. It now applies everywhere: the file's mtime in dev, where a
  rebuild happens without a restart, and the boot-derived asset version otherwise, memoised
  because a deploy restarts the process. An unchanged asset keeps a stable URL and stays cached,
  which is why the token is derived rather than random.

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

### Added

- **A warning when a model crosses into page props having declared no boundary.** Page props
  are page source: everything handed to `inertia()` is serialised into the document, and
  `return inertia("Trips/Show", { trip })` is what a newcomer writes on their first afternoon
  and ships the whole row — the internal cost, the margin, the note about the customer, on
  the customer's own screen. Nothing fails and the page looks right, which makes it the one
  mistake here that never announces itself.

  The ORM's `hidden` / `visible` lists were already honoured, since they are applied by
  `toJSON()` and that is what serialises a prop — nothing said so. In development, passing a
  model that declares neither list now names the model and the number of fields it is about
  to publish. It fires once per model class and goes quiet as soon as either list exists, so
  the normal case of passing models stays quiet.

## [1.8.0] — 2026-08-24

### Fixed

- **A `303` redirect was not marked as Inertia's, so the browser did nothing at all.**
  `X-Inertia: true` was set inside the 302-to-303 conversion, so it only ever reached a
  redirect arriving as a 301 or 302 from a non-GET handler. A handler returning the 303 the
  protocol asks for skipped the only line that marked its response — and `redirect(to, 303)`
  is exactly what `docs/authentication.md` tells people to write, in eight places. The form
  submitted, the row was written, the mail went out, and the fields stayed filled in: a hang
  from both ends. Marking now happens for every redirect status on an Inertia request, with
  the conversion a separate decision on top of it. `307` and `308` are marked but left alone,
  since preserving the method is the whole reason to choose them.

## [1.7.1] — 2026-08-16

### Fixed

- **The `@inertiajs/*` peer range excluded v3.** This package advertises "full Inertia v3
  protocol support" and `create-zerotal`'s React and Vue templates install `^3.0.0`, but the
  peer range read `^1 || ^2` — so following our own documentation, with our own scaffolder,
  produced a peer-dependency warning, and a stricter installer than Bun would have refused
  outright. Widened to `^1 || ^2 || ^3`. Found while scaffolding the first Inertia cookbook
  app, which resolved `@inertiajs/react@3.6.1`.

## [1.7.0] — 2026-08-16

### Added

- **The recorder now also feeds Zerotal's own DevTools panel.** Everything it resolves —
  which prop came from which wrapper, what kind of request this was, which batch it belongs
  to — went to the browser-extension read API and nowhere else. So a developer running the
  in-page panel could not see a single prop, and a developer running the extension could not
  see a single SQL query; the two halves described the same request and never met.

  Entries are now also pushed onto an `inertia` channel when `@zerotal/devtools` is
  installed, where the panel draws the prop map as a tree, badges each prop with the wrapper
  that produced it, and folds a visit together with the deferred loads it triggered. Because
  the entry is recorded against the same `HttpContext` the queries were, one row shows the
  props **and** the SQL that produced them — with no key to match and no way for the two to
  disagree about which request they describe.

  Deliberately a fan-out and not a migration: `DevtoolsEntry` and `/_inertia/devtools` are a
  published contract and keep serving the extension either way. Nor is devtools a new
  dependency — the sink is resolved by container key through a local structural interface, so
  this package imports `@zerotal/devtools` nowhere and does nothing at all when it is absent.

### Changed

- **`redactValue` runs `redactGraph` from `@zerotal/core/security`** rather than its own copy
  of the same walk. The protocol markers (`[REDACTED]`, `[Circular]`, `[Max depth]`) and the
  depth limit are unchanged — they are specified by the wire contract, not chosen here, so
  only the traversal is shared. Its last two parameters (`seen`, `depth`) were internal
  bookkeeping and are gone; no caller passed them.

## [1.6.1] — 2026-08-15

### Fixed

- **DevTools reported that the app was not in dev mode, and suggested starting a Vite
  server.** The advice cannot be followed in a Zerotal app, and the cause was real: the
  Inertia adapter enables its client-side hooks from a `dev` option whose default is
  `import.meta.env.DEV` — a Vite convention. Bun's bundler leaves that expression alone, so
  it survived into the bundle and evaluated to `false` on every build.

  Zerotal now defines `import.meta.env` for every Inertia build, development and production
  alike, so the adapter's own default resolves. Nothing to configure, and no `dev` option to
  pass by hand.

  The subtlety worth recording: the adapter writes `import.meta.env?.DEV`, optional-chained
  — which is why an undefined `import.meta.env` yields `false` rather than throwing, and why
  a bundler define keyed on `import.meta.env.DEV` **does not match it**. The whole object has
  to be replaced, not the member. A test pins that, because the member form compiles to a
  perfectly clean no-op.

## [1.6.0] — 2026-08-15

### Added

- **Inertia DevTools support.** Zerotal now implements the server half of the
  [Inertia DevTools protocol](https://inertiajs.com/docs/v3/advanced/devtools-protocol), so the
  browser extension shows a timeline of every request: the component that rendered, the route
  that matched by name, every prop tagged with the wrapper that produced it (`defer` and its
  group, `optional`, `always`, `merge` and its direction, `once`, `scroll`, and which props came
  from `share()`), the resolved values, headers, status, and server time. Follow-up requests are
  grouped with the navigation that caused them, so a page whose deferred props arrive in three
  later requests reads as one batch.

  On in development, off everywhere else — it follows `devSurfacesEnabled()`, the same gate as the
  stack-trace error page, so a production deploy records nothing and registers no endpoints.
  `INERTIA_DEVTOOLS_ENABLED` or `inertia.devtools.enabled` overrides it.

  Sensitive values are redacted **before** an entry is stored rather than when it is served, so a
  withheld value is never written down: any key containing `password`, `token`, `secret`, and the
  rest of the built-in list, plus the `authorization` and `cookie` headers. Matching is a
  case-insensitive substring, so `password` also covers `password_confirmation`. Uploads are
  summarised instead of inlined, and a prop graph with a cycle records `[Circular]` rather than
  failing the request. Add your own patterns with `devtools.redact` / `devtools.redactHeaders`.

  Entries live in a bounded in-memory ring (`devtools.maxEntries`, default 200) in the process
  that recorded them — no disk IO on the request path, no pruning job, and nothing to leak from a
  directory later. `devtools.except` keeps chosen paths out of the timeline; the read API always
  excludes itself. Enabling the recorder outside a development process requires a `devtools.gate`,
  and without one the read API refuses every request rather than defaulting to open.

- **`route()` for pages.** `route`, `defineRoutes`, and `hasRoute` are re-exported from this
  package, so a page component imports the URL helper from the package it already uses. See
  `@zerotal/core`'s entry for the full feature. Note that `inertiaRoute()` is a different thing:
  it **registers** a page route on the server, where `route()` **generates a URL** for one.

## [1.5.0] — 2026-08-15

### Added

- **Typed pages: `Inertia.render(component, props)` is checked against the page component.**
  The name must be a page that exists — a renamed or misspelled component was a runtime
  500 before, the kind that reaches production because the route it lives on is the one
  nobody clicked — and the props are checked against the props that component declares.

  Nothing new is annotated to make this work. `resources/js/pages.generated.ts` already
  holds an `import()` thunk per page, and an `import()` thunk carries the module's full
  type; the file's `Record<string, () => Promise<{ default: unknown }>>` annotation was
  throwing all of it away — widening every page name to `string` and every default export
  to `unknown`, which is precisely what typed props need. It is now written with
  `satisfies`: same constraint enforced, types kept, nothing changed at runtime. One
  type-only `declare module` line in that same file hands them to the server, which keeps
  the server's only view of the client component graph in exactly one place.

  The check runs in the cheap direction: the **component** declares its props (which a
  React component does anyway) and the **controller** is checked against them.

  Three details worth knowing:

  - **Wrappers are unwrapped, and carry their payload.** A prop accepts its value, a
    factory, or a wrapper — and `merge(() => [1, 2])` for a `Post[]` prop is an error.
  - **`optional()` and `defer()` are rejected on a required prop.** They are absent on
    first paint by definition, so a component typing such a prop as required is wrong
    about its own contract; a type that accepted it would launder that bug into something
    the compiler had signed off on. Declare the prop `?`.
  - **Shared props are never required.** `auth`/`flash`/`errors`/`old` are merged in, so a
    page declaring one does not force every controller to pass it. Declare your own
    `Inertia.share()` keys on the `SharedProps` interface and they behave the same way.

  Vue pages are checked by **name** only: a `.vue` SFC resolves through a
  `declare module '*.vue'` shim whose default export is `DefineComponent<{}, {}, any>`, so
  its props are invisible to TypeScript without `vue-tsc` in the typecheck path. Those
  pages accept any props rather than failing on a shape nobody can see — documented rather
  than silently degraded.

- **`Inertia.render.dynamic(name, props)` / `inertia.dynamic()`** — render a page whose
  name is only known at runtime (an error page chosen by status code, a component from
  config), with no checking. A separate function rather than a `string` overload: an
  overload that accepts every string is matched by every string, which would make the
  checked signature decorative. `inertiaStream.dynamic()` is its streaming counterpart.

- **The prop wrappers are generic.** `optional`, `lazy`, `always`, `defer`, `merge` and
  `deepMerge` carry what they resolve to (`defer(() => stats())` is a `DeferProp<Stats>`),
  which is what lets the wrapper be checked against the prop it fills. Existing calls are
  unaffected — the parameter defaults to `unknown`.

- **Tests for `PrecognitionMiddleware`.** A precognitive request validates a form
  without running the controller's side effects, answering 204 or 422 instead of the
  real response — so those answers must never be confused with real ones by a cache.
  Without the `Vary`, a shared cache can serve a precognitive 204 to an actual form
  submission, and the user's data silently never reaches the controller. Pinned:
  the header is added only for `Precognition: true` (not `1`, not `TRUE`), it is
  appended to an existing `Vary` rather than replacing it — replacing would discard
  the app's own content negotiation — it is not duplicated when already present, and
  the decorated response keeps its status and body. 76 tests → 84.

- **The prop wrapper classes, the error classes and `SsrHandler` are documented.**
  `OptionalProp`, `AlwaysProp`, `DeferProp`, `MergeProp` and `InfiniteScrollProp` are
  what the prop helpers return; the reference now says so, and names `InertiaProp` as
  the type to accept for "any wrapped prop". `InertiaError`, `InvalidComponentError`
  and `InertiaTemplateNotLoadedError` gained a table of what throws each.

### Changed

- **`detectVuePlugin` is marked `@internal`** — build plumbing for `inertia:build`,
  reached only by the build command. With the eight markers already present the
  promise is 30 exports, not 39.

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. Every promised export is documented across seven guide pages, and
  the only dependency is `@zerotal/core`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.2] — 2026-08-06

### Fixed

- Type-checking a Vue app no longer fails on React. React is an optional peer
  and is imported dynamically at runtime, but the literal specifiers were still
  resolved by TypeScript, so Vue projects were asked for modules they never
  install.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
