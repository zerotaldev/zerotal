# Changelog — @zerotal/i18n

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.5.0] — 2026-08-15

### Added

- **Tests for the `Lang` facade and the `t()` global.** The translator itself was
  covered thoroughly, but nothing in an application calls it directly — apps call
  `Lang.translate(...)` or `t(...)`, and those resolve through the container and
  the ambient locale context first. That path was untested, and its failure mode is
  quiet: a facade resolving the wrong instance, or a helper ignoring the request's
  locale, returns a plausible string in the wrong language rather than throwing.
  Now pinned, including that the ambient locale wins inside `I18nContext.run()`,
  does not leak past it, and yields to an explicit locale argument. 21 tests → 31.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. All nine promised exports are documented, every one deliberately
  public (no `@internal` triage was needed here — the surface was already the API),
  the only dependency is `@zerotal/core`, and there has never been a breaking change.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Added

- Initial release: request-scoped localization for Zerotal.
- `Translator` with dot-path lookup, fallback-locale resolution, `{var}` / `:var`
  interpolation, and pipe-segment pluralization (`"none | one | {count} many"`).
- `I18nConfig` factory (`defaultLocale`, `fallbackLocale`, `supportedLocales`,
  `resolvers`, `loadPath`, in-memory `catalogs`).
- `loadCatalogs()` — loads `<locale>.json` files from a directory.
- Request locale resolution via query string, cookie, and `Accept-Language`.
- `I18nProvider` + `LocaleMiddleware` — resolve the locale per request and inject
  `ctx.t()` / `ctx.locale`; AsyncLocalStorage-backed `I18nContext` for the
  `Lang` facade and the global `t()` helper.
- Typed error vocabulary (`I18nError` / `CatalogLoadError`, `E_I18N*` codes).
