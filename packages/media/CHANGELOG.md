# Changelog — @zerotal/media

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `experimental`**

## [Unreleased]

## [1.3.0] — 2026-08-09

### Added

- Initial release. Attach files to models with the `Media` mixin —
  `class Product extends Model.using(Media)` — declaring collections
  declaratively on the model, and store originals on any configured disk. One
  stored file is a `MediaItem`.
- Media collections with `accepts` (checked against sniffed bytes), `maxSize`,
  `single`, `onlyKeepLatest`, `fallbackUrl` / `fallbackPath`, and per-collection
  disk overrides.
- Image conversions on `Bun.Image` — no native module required. `fit: "cover"`
  is unavailable on the default driver and raises `UnsupportedManipulationError`
  naming the fix; install `sharp` and set `driver: "sharp"` for cropping.
- Responsive image ladders with `srcset()` and a ThumbHash inline placeholder.
- Arbitrary per-item metadata via `withCustomProperties()` on the adder and
  `getCustomProperty()` / `setCustomProperty()` / `forgetCustomProperty()` on the
  item, round-tripped through the row's JSON column. Reading without a fallback
  yields `unknown` (narrow it yourself); reading with one yields the fallback's
  type and never `undefined`.
- Queued conversions through `@zerotal/queue` when it is registered, falling
  back to inline generation when it is not.
- `media` table provisioned at boot by `mediaSchemaConcern`, so apps write no
  migration.
- `MediaFake` assertions, `media:clean` and `media:regenerate` commands.
