# Changelog — @zerotal/i18n

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`**

## [Unreleased]

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
