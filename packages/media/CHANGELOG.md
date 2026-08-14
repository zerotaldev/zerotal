# Changelog — @zerotal/media

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`** — the public API follows SemVer strictly: anything
importable without an `@internal` marker keeps its shape for the rest of the 1.x
line, and `api-surface.md` is diffed by CI on every change.

## [Unreleased]

### Changed

- **`@zerotal/media` is `stable`.** The blocker was never the feature set — it was
  that the default driver could not centre-crop, so freezing `ImageDriver` would
  have frozen the workaround with it. `fit: "cover"` on `BunImageDriver` removed
  that, and nothing reopened the promotion afterwards, which is the only reason
  this package was still beta.

  Two things had to happen first, and both are the promotion rather than
  paperwork around it:

  - **The surface was triaged.** It listed 79 exports and carried exactly one
    `@internal` marker — plumbing that had leaked out of a module because
    something else in the package needed it. Collection resolution, retention,
    conversion dispatch, source resolvers, disk resolution, schema provisioning
    and the config defaults are now marked `@internal`. Narrowing a surface after
    `stable` is itself a breaking change, so an export that shipped stable by
    accident would have been stuck for the rest of 1.x.
  - **What survived is documented.** All 47 promised exports appear in
    `docs/media.md`, and `bun run docs:coverage` now fails CI if that stops being
    true. A SemVer promise over a surface nobody wrote down is not a promise
    anyone can use.

  Nothing is removed and nothing is renamed: an `@internal` export still imports
  and still works. It is a statement about what the guarantee covers.

- **`ImageDriver` is frozen, and its growth rule is written down.** It is the one
  type in this package a third party implements, so a new _required_ member would
  break code this repository cannot see. New members arrive optional, with the
  package supplying the fallback; `ImageManipulation` may gain optional fields;
  `ImageResult` and `ImageMetadata` may not gain required ones, because drivers
  produce them. Buffers rather than streams stays: media is read from and written
  to a storage disk, and both hand over whole objects.

### Added

- **`fit: "cover"` works on the default driver.** No `sharp`, no native module. `Bun.Image`
  still exposes no crop primitive, so the centre window is taken through a lossless PNG
  round-trip on the already-downscaled image — scaling stays native, and the extra cost is
  roughly 40 ms on an 8 MB photo, off the request path via the queue. This removes the one
  blocker that sat outside the repo: `sharp` is now a throughput and codec-coverage choice
  rather than a feature one.
- **`allowEnlargement` on a conversion.** Off by default, as before. Worth setting when the
  exact box matters more than fidelity — a `cover` thumbnail for a fixed-size grid slot
  would otherwise come back undersized for small sources.
- **`@zerotal/media/testing`** — the state-swapping and disk-resolver seams, moved out of the
  main entry point so it can be frozen while these stay free to change.

### Fixed

- **`fit: "inside"` returned dimensions that were off, sometimes short of the box asked
  for.** `Bun.Image` floors internally, so a 400×300 source asked for `width: 150` came back
  **149** px wide, and derived heights sat a pixel below what `sharp` produced. Both drivers
  now resolve exact dimensions in shared code before touching their backend. Affects the
  responsive ladder, which records these widths into `srcset`.

### Changed

- **Both shipped drivers are held to one parity suite**, over a sweep of sizes, fits and
  enlargement settings. `BunImageDriver.supportsCrop` is now `true`; the flag stays on
  `ImageDriver` for third-party drivers that genuinely cannot crop.
- **`fit: "fill"` with a single dimension now behaves as `inside`** in both drivers. `sharp`
  would stretch that one axis and leave the other at source size, which is almost never
  what a caller meant.
- `FORMAT_MIME`, `FORMAT_EXTENSION` and `CONVERTIBLE_MIME_TYPES` are frozen — they are
  shared module state, and mutating one changed conversion behaviour process-wide.
- `UnsupportedManipulationError` is no longer thrown for `cover`. It remains exported as
  the way any driver reports a manipulation it cannot express.

### Removed

- Test seams from the package root: `mediaState`, `setMediaState`, `resetMediaState`,
  `setDiskResolver`, `setDefaultDiskName`, `diskNameFor`, `setConversionDispatcher`,
  `performConversions`, `ownerClassFor`, `partitionConversions`. All still available from
  `@zerotal/media/testing`; update the import path.

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
