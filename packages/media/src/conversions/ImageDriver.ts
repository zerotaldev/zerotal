import type { ConversionFit, ConversionFormat } from "../types.ts";

/** What a driver is asked to do to one image. */
export interface ImageManipulation {
  /** Target width. Omit both dimensions to re-encode without resizing. */
  width?: number;
  /** Target height. */
  height?: number;
  /** How to fit the source into the box. Default `"inside"`. */
  fit?: ConversionFit;
  /** Output format. Always resolved by the caller — drivers never guess. */
  format: ConversionFormat;
  /** Encoder quality 1–100. */
  quality?: number;
  /** Clockwise rotation in degrees, applied before resizing. */
  rotate?: number;
  /** Never scale a source up to meet the target box. Default `true`. */
  withoutEnlargement?: boolean;
}

/** A generated image and what it turned out to be. */
export interface ImageResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: ConversionFormat;
  mimeType: string;
}

/** What an image's header says it is. */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

/**
 * The seam between this package and whatever actually manipulates pixels.
 *
 * Two implementations ship: `BunImageDriver` (the default — no dependencies)
 * and `SharpImageDriver` (opt-in, a native module). Both support every
 * manipulation in {@link ImageManipulation}, and a shared parity suite holds
 * them to the same output dimensions, so `media.driver` is a throughput and
 * codec-coverage choice rather than a feature one.
 *
 * Keeping both behind one interface is also what makes `Bun.Image` — which is
 * young — a safe thing to depend on: if its API moves, one file changes.
 *
 * ## How this interface may grow
 *
 * This is the one type in the package a third-party implements, so a new
 * **required** member is a breaking change for code this repository cannot see.
 * The policy, decided when the package was promoted to `stable`:
 *
 * - **New members arrive optional**, and the package supplies the fallback —
 *   the same way `supportsCrop` lets a driver decline `fit: "cover"` instead of
 *   failing at conversion time. A capability nobody implements must degrade to
 *   the behaviour drivers already have.
 * - **{@link ImageManipulation} may gain optional fields** (a background colour,
 *   a device-pixel-ratio multiplier, EXIF stripping). Drivers ignore what they
 *   do not understand, so this stays additive — but a field that *changes*
 *   existing output is a new field, never a new default.
 * - **{@link ImageResult} and {@link ImageMetadata} may not gain required
 *   fields**, because drivers produce them. Optional only.
 *
 * Buffers rather than streams is deliberate and does not change: media is read
 * from and written to a storage disk, both of which hand over whole objects, so
 * a streaming seam here would only re-buffer at each end.
 */
export interface ImageDriver {
  /** Name used in error messages. */
  readonly name: string;
  /**
   * Whether `fit: "cover"` is available.
   *
   * Both shipped drivers report `true`. It stays part of the interface for
   * third-party drivers wrapping a backend that genuinely cannot crop, which
   * need a way to say so other than failing at conversion time.
   */
  readonly supportsCrop: boolean;

  /** Read dimensions and format without decoding the whole image. */
  metadata(bytes: Uint8Array): Promise<ImageMetadata | null>;

  /** Apply a manipulation and return the encoded result. */
  convert(bytes: Uint8Array, manipulation: ImageManipulation): Promise<ImageResult>;

  /**
   * A tiny inline `data:` URI of the image, for rendering while the real one
   * loads. `null` when the driver cannot produce one.
   */
  placeholder(bytes: Uint8Array): Promise<string | null>;

  /** Whether this host can encode `format`. */
  canEncode(format: ConversionFormat): Promise<boolean>;
}

// These three are exported for reading — to label a download, or to check a type
// before offering an upload. They are frozen because they are shared module
// state: an app that mutated one would change how conversions behave for every
// other caller in the process, including ones it does not own.

/** MIME type for each format a driver may emit. */
export const FORMAT_MIME: Readonly<Record<ConversionFormat, string>> = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
});

/** File extension for each format. */
export const FORMAT_EXTENSION: Readonly<Record<ConversionFormat, string>> = Object.freeze({
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  heic: "heic",
});

/** MIME types this package will attempt to convert. */
export const CONVERTIBLE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/bmp",
  "image/tiff",
]);

/** Whether a stored file is worth handing to an image driver at all. */
export function isConvertible(mimeType: string | null | undefined): boolean {
  return mimeType !== null && mimeType !== undefined && CONVERTIBLE_MIME_TYPES.has(mimeType);
}
