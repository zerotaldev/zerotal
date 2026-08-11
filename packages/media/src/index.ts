// @zerotal/media — public API
//
// Test and advanced-wiring seams (state swapping, disk resolver overrides,
// queue-bridge internals) live at `@zerotal/media/testing`. They are
// deliberately not re-exported here: this entry point is what the package's
// stability guarantee covers, and it should stay small enough to keep.

// Model + model mixin
// `Media` is the mixin — it reads as `Model.using(Media)`. `MediaItem` is one
// stored file: a row in the `media` table.
export { Media } from "./Media.ts";
export { MediaItem, pathGenerator, setPathGenerator } from "./MediaItem.ts";
export { MediaAdder } from "./MediaAdder.ts";

// Application-level operations
export { MediaManager } from "./MediaManager.ts";
export type { CleanReport } from "./MediaManager.ts";
export { MediaLibrary } from "./facades/MediaLibrary.ts";
export { MediaProvider } from "./provider/MediaProvider.ts";

// Collections
export { resolveCollection, hasCollection, collectionNames } from "./collections/resolve.ts";
export type { CollectionHost } from "./collections/resolve.ts";
export { applyRetentionRules } from "./collections/retention.ts";

// Conversions
export { ConversionRunner } from "./conversions/ConversionRunner.ts";
export { BunImageDriver } from "./conversions/BunImageDriver.ts";
export { SharpImageDriver } from "./conversions/SharpImageDriver.ts";
export {
  FORMAT_EXTENSION,
  FORMAT_MIME,
  CONVERTIBLE_MIME_TYPES,
  isConvertible,
} from "./conversions/ImageDriver.ts";
export type {
  ImageDriver,
  ImageManipulation,
  ImageMetadata,
  ImageResult,
} from "./conversions/ImageDriver.ts";
export { isQueueAvailable, dispatchConversions } from "./conversions/dispatch.ts";

// Paths
export { DefaultPathGenerator } from "./paths/PathGenerator.ts";
export type { PathGenerator } from "./paths/PathGenerator.ts";

// Sources
export { fromValue, fromUrl, fromDisk, fromPath } from "./sources.ts";
export type { MediaSource, ResolvedSource, SourceResolver } from "./sources.ts";

// Disk resolution
export { diskFor, defaultDiskName } from "./support/disks.ts";

// Schema provisioning
export { mediaSchemaConcern } from "./mediaSchemaConcern.ts";

// Config
export { MediaConfig, mediaDefaults } from "./config.ts";
export type { MediaConfigShape } from "./config.ts";

// Testing
export { MediaFake } from "./MediaFake.ts";

// Types
export type {
  CollectionDefinition,
  ConversionDefinition,
  ConversionFit,
  ConversionFormat,
  ConversionMap,
  GeneratedConversion,
  MediaCollections,
  MediaOwner,
  PendingMediaMeta,
  ResponsiveImage,
  ResponsiveImageSet,
  SafeConversionFormat,
} from "./types.ts";

// Errors
export * from "./errors.ts";
