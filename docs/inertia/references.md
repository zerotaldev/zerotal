---
title: Inertia Reference
description: Every helper, prop type, and config key in one table.
---

# References

A consolidated cheat-sheet for `@zerotal/inertia`. Each entry links to the section above where it's explained in full.

## Commands

| Command                                            | Purpose                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `bun zt make:page <Name>`                          | Scaffold a page component under your pages directory.           |
| `bun zt make:page <Name> --layout <Layout>`        | Scaffold a page wrapped in a persistent layout.                 |
| `bun zt make:page <Name> --framework <vue\|react>` | Force the frontend framework instead of auto-detecting.         |
| `bun zt inertia:build`                             | Bundle the frontend — development build (external source maps). |
| `bun zt inertia:build -p`                          | Production build (minified, no source maps).                    |

## Server exports

| Export                                               | Purpose                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `inertia(component, props?)`                         | Render an Inertia page from a controller action. See [the inertia helper](/docs/inertia/rendering#the-inertia-helper).                      |
| `inertiaStream(component, props?)`                   | Streaming SSR alternative to `inertia()`. See [Streaming SSR](/docs/inertia/ssr#streaming-ssr).                                             |
| `optional(fn)` / `lazy(fn)`                          | Prop sent only on a partial reload that requests it. See [optional and always props](/docs/inertia/props#optional-and-always-props).        |
| `always(value)`                                      | Prop always sent, even when a partial reload would exclude it.                                                                              |
| `defer(fn, group?, opts?)`                           | Prop fetched in a follow-up request after first paint. See [deferred props](/docs/inertia/props#deferred-props).                            |
| `merge(value)` / `deepMerge(value)`                  | Combine reloaded data with existing client data. See [merging props](/docs/inertia/props#merging-props).                                    |
| `scroll(paginator, opts?)`                           | Infinite-scroll pagination wired to `<InfiniteScroll>`. See [infinite scroll](/docs/inertia/props#infinite-scroll).                         |
| `sharedProps()`                                      | The auto-merged `auth` / `flash` / `errors` / `old` bag. See [Shared Props](/docs/inertia/props).                                           |
| `share(key, value)` / `share(map)`                   | Register custom shared props. See [adding custom shared props](/docs/inertia/props#adding-custom-shared-props).                             |
| `setAssetVersion(v)` / `assetVersion()`              | Set / read the current asset version. See [asset versioning](/docs/inertia/middleware#asset-versioning).                                    |
| `generatePageRegistry(cwd?)`                         | Regenerate the page registry module. See [page registry](/docs/inertia/build#page-registry).                                                |
| `inertiaRoute(path, component, props?, middleware?)` | The function behind the `Router.inertia()` macro. See [controller-less routes](/docs/inertia/rendering#controller-less-routes).             |
| `InertiaProvider`                                    | Wires the middleware, template, asset version, and optional SSR endpoint. See [Register the provider](/docs/inertia#register-the-provider). |
| `InertiaMiddleware`                                  | Protocol mechanics; auto-registered by the provider. See [Middleware & versioning](/docs/inertia/middleware).                               |
| `PrecognitionMiddleware`                             | Enables precognition validation. See [precognition](/docs/inertia/props#precognition).                                                      |
| `InertiaConfig(options?)`                            | Build a typed `config/inertia.ts` object with defaults. See [Configuration](/docs/inertia#configuration).                                   |
| `Inertia`                                            | Unified facade — see below.                                                                                                                 |

## The Inertia facade

| Method                                              | Equivalent / purpose                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Inertia.render(component, props?)`                 | Same as `inertia()`.                                                                                                                                |
| `Inertia.stream(component, props?)`                 | Same as `inertiaStream()`.                                                                                                                          |
| `Inertia.optional(fn)` / `Inertia.lazy(fn)`         | Same as `optional()`.                                                                                                                               |
| `Inertia.always(value)`                             | Same as `always()`.                                                                                                                                 |
| `Inertia.defer(fn, group?, opts?)`                  | Same as `defer()`.                                                                                                                                  |
| `Inertia.merge(value)` / `Inertia.deepMerge(value)` | Same as `merge()` / `deepMerge()`.                                                                                                                  |
| `Inertia.scroll(paginator, opts?)`                  | Same as `scroll()`.                                                                                                                                 |
| `Inertia.share(key, value)` / `Inertia.share(map)`  | Register custom shared props. See [adding custom shared props](/docs/inertia/props#adding-custom-shared-props).                                     |
| `Inertia.location(url)`                             | External / full-page redirect (`409` + `X-Inertia-Location`). See [external & fragment redirects](/docs/inertia/props#external-fragment-redirects). |
| `Inertia.encryptHistory()`                          | Encrypt this page's history entry. See [history encryption](/docs/inertia/props#history-encryption).                                                |
| `Inertia.clearHistory()`                            | Clear encrypted history (e.g. on logout).                                                                                                           |

## Prop helpers

| Helper / chain                      | Behaviour                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `optional(fn)`                      | Never sent on a normal visit; only on a partial reload that asks for it.                                             |
| `lazy(fn)`                          | Alias of `optional(fn)`.                                                                                             |
| `always(value)`                     | Always sent, even past a partial reload's include / exclude filter.                                                  |
| `defer(fn, group?, { rescue? })`    | Excluded from the first render; fetched in a grouped follow-up request.                                              |
| `merge(value)` / `deepMerge(value)` | Append / deep-merge reloaded data instead of replacing it.                                                           |
| `.append(path)`                     | Append merged data at `path`.                                                                                        |
| `.prepend(path?)`                   | Prepend merged data at the root (no arg) or at `path`.                                                               |
| `.matchOn(path)`                    | Replace items matching the key at `path`.                                                                            |
| `.once(expiresAt?)`                 | Resolve a single time; the client remembers it across navigations. See [once props](/docs/inertia/props#once-props). |

## Configuration options

Set in `config/inertia.ts` via `InertiaConfig({ … })` — every field is optional.

| Option           | Default                  | Purpose                                                                                              |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `htmlTemplate`   | `"./resources/app.html"` | Path to the root HTML template (must contain `<!-- @inertia -->`); falls back to a built-in default. |
| `version`        | `"1"`                    | Asset version string embedded in every page object; bump on each deploy.                             |
| `assetsUrl`      | `"/"`                    | Public URL prefix for built assets.                                                                  |
| `pagesDir`       | `"resources/js/pages"`   | Directory where Inertia page components live.                                                        |
| `ssr`            | `false`                  | Register `POST /__ssr` for endpoint SSR.                                                             |
| `encryptHistory` | `false`                  | Encrypt history state globally.                                                                      |

## Protocol headers

| Header                                                | Direction          | Used for                                                     |
| ----------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `X-Inertia`                                           | request / response | Marks an Inertia XHR visit; echoed on the response.          |
| `X-Inertia-Version`                                   | request            | Client's asset version — a mismatch triggers a `409` reload. |
| `X-Inertia-Partial-Data` / `X-Inertia-Partial-Except` | request            | Partial-reload prop include / exclude lists.                 |
| `X-Inertia-Partial-Component`                         | request            | The component a partial reload targets.                      |
| `X-Inertia-Reset`                                     | request            | Props to clear before merging fresh data.                    |
| `X-Inertia-Except-Once-Props`                         | request            | Once-props the client already holds.                         |
| `X-Inertia-Error-Bag`                                 | request            | Namespaces validation errors under a named bag.              |
| `X-Inertia-Infinite-Scroll-Merge-Intent`              | request            | `prepend` vs append intent when scrolling up.                |
| `Precognition` / `Precognition-Validate-Only`         | request            | Precognition validation and field scoping.                   |
| `Vary: X-Inertia`                                     | response           | Keeps cached HTML and JSON variants separate.                |
| `X-Inertia-Location`                                  | response           | `409` full-page reload / external redirect target.           |
| `X-Inertia-Redirect`                                  | response           | `409` redirect that preserves a URL fragment.                |

## Page object fields

See [page object reference](/docs/inertia/props#page-object-reference) for the full table of fields — `component`, `props`, `url`, `version`, `deferredProps`, `mergeProps`, `scrollProps`, `onceProps`, and the rest — and which API sets each.
