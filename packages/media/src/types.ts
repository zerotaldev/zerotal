// ── Public types for @zerotal/media ──────────────────────────────────────────

/**
 * Output formats a conversion may target.
 *
 * Deliberately narrower than what {@link https://bun.sh/docs/api/image | Bun.Image}
 * can emit. `Bun.Image` reports `backend: "system"`, meaning AVIF/HEIC/TIFF encode
 * through OS codecs that are simply absent on many hosts — a conversion that works
 * on a developer's laptop then fails inside a queued job on an Alpine container.
 * These three are available everywhere.
 *
 * Need AVIF? Set `allowHostFormats` in config and use {@link ConversionFormat} —
 * the boot probe will tell you whether this host can actually do it.
 */
export type SafeConversionFormat = "jpeg" | "png" | "webp";

/** Every format the image driver may be asked for, including host-dependent ones. */
export type ConversionFormat = SafeConversionFormat | "avif" | "heic";

/**
 * How a source image is fitted into the target box.
 *
 * - `inside` — scale down to fit within `width` × `height`, preserving aspect
 *   ratio. The result may be smaller than the box in one dimension.
 * - `fill` — stretch to exactly `width` × `height`, ignoring aspect ratio.
 * - `cover` — scale and centre-crop to exactly fill the box, preserving aspect
 *   ratio. Needs both `width` and `height`: given one, there is nothing to crop
 *   away and it behaves as `inside`.
 *
 * With `withoutEnlargement` (the default), a source too small to fill the box is
 * never scaled up — `cover` then yields the largest centre window the source can
 * supply, which may not have the requested aspect ratio. A 300×500 source asked
 * to cover 400×400 gives 300×400.
 */
export type ConversionFit = "inside" | "fill" | "cover";

/** A single derived image generated from an original. */
export interface ConversionDefinition {
  /** Target width in pixels. At least one of `width`/`height` is required. */
  width?: number;
  /** Target height in pixels. */
  height?: number;
  /** How to fit the source into the box. Default: `"inside"`. */
  fit?: ConversionFit;
  /** Output format. Default: the original's format when safe, else `"jpeg"`. */
  format?: ConversionFormat;
  /** Encoder quality, 1–100. Default: 82. */
  quality?: number;
  /** Clockwise rotation in degrees applied before resizing. */
  rotate?: number;
  /**
   * Allow scaling a source *up* to meet the target box. Default: `false`.
   *
   * Off by default because upscaling produces a larger file that looks worse.
   * Turn it on when the exact box matters more than fidelity — a `cover`
   * thumbnail for a fixed-size grid slot, say, which would otherwise come back
   * undersized (and off-aspect) for small sources.
   */
  allowEnlargement?: boolean;
  /** Generate this conversion on the queue instead of inline. Default: `false`. */
  queued?: boolean;
}

/** A named set of conversions. */
export type ConversionMap = Record<string, ConversionDefinition>;

/** Declarative rules for one media collection. */
export interface CollectionDefinition {
  /** Disk originals are written to. Default: the configured default disk. */
  disk?: string;
  /** Disk conversions are written to. Default: whatever `disk` resolves to. */
  conversionsDisk?: string;
  /**
   * Allowed MIME types. Checked against the type **sniffed from the file's own
   * bytes**, never the client-supplied one, so renaming `payload.html` to
   * `photo.jpg` does not get past it.
   */
  accepts?: string[];
  /** Maximum accepted size in bytes for a single file. */
  maxSize?: number;
  /** Keep only the most recently added file; adding a second removes the first. */
  single?: boolean;
  /** Keep only the `n` most recent files, removing older ones as they fall out. */
  onlyKeepLatest?: number;
  /** URL returned by `getFirstMediaUrl()` when the collection is empty. */
  fallbackUrl?: string;
  /** Path returned by `getFirstMediaPath()` when the collection is empty. */
  fallbackPath?: string;
  /** Conversions generated for files in this collection. */
  conversions?: ConversionMap;
  /**
   * Generate a responsive width ladder plus an inline blur placeholder.
   * `true` uses the configured default widths; an array pins them explicitly.
   */
  responsive?: boolean | number[];
}

/**
 * The collections a model declares, as the static `mediaCollections` field.
 *
 * A function is accepted for values only known at runtime (a per-tenant disk,
 * say); it is called once per operation, not cached.
 */
export type MediaCollections = Record<string, CollectionDefinition | (() => CollectionDefinition)>;

/** What a generated conversion records in the `generated_conversions` column. */
export interface GeneratedConversion {
  /** File name on the conversions disk, e.g. `thumb.webp`. */
  fileName: string;
  /** Bytes written. */
  size: number;
  /** MIME type of the generated file. */
  mimeType: string;
  width: number;
  height: number;
  /** ISO-8601 timestamp of generation. */
  generatedAt: string;
}

/** One entry in the responsive width ladder. */
export interface ResponsiveImage {
  fileName: string;
  width: number;
  height: number;
}

/** The `responsive_images` column payload. */
export interface ResponsiveImageSet {
  /** Generated widths, ascending. */
  images: ResponsiveImage[];
  /** A `data:image/png;base64,…` low-quality placeholder, when one was produced. */
  placeholder?: string;
}

/** Metadata carried alongside a file being added to a collection. */
export interface PendingMediaMeta {
  /** Human-facing label. Defaults to the original filename without extension. */
  name?: string;
  /** Arbitrary JSON stored in `custom_properties`. */
  customProperties?: Record<string, unknown>;
  /** Explicit sort position. Defaults to the end of the collection. */
  order?: number;
  /** Override the collection's disk for this one file. */
  disk?: string;
}

/** The minimum a model must expose for media to attach to it. */
export interface MediaOwner {
  /** Primary key. */
  id: number | string;
  /** Discriminator written to `model_type`. */
  readonly constructor: { name: string };
}
