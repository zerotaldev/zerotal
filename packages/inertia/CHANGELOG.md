# Changelog — @zerotal/inertia

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
