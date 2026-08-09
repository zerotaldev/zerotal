import { deepMerge } from "@zerotal/core";
import type { SafeConversionFormat } from "./types.ts";

export interface MediaConfigShape {
  /**
   * Disk originals go to when a collection does not name one.
   * Empty string means "whatever `storage.default` resolves to".
   */
  disk: string;
  /** Disk conversions go to. Empty string means "the same disk as the original". */
  conversionsDisk: string;
  /** Table backing the {@link MediaItem} model. */
  table: string;
  /**
   * Provision the media table at boot instead of requiring a migration.
   * Idempotent; skipped when the table already exists or there is no database.
   */
  autoCreateTable: boolean;
  /** Image driver. `"bun"` needs no dependencies; `"sharp"` adds crop support. */
  driver: "bun" | "sharp";
  /**
   * Run conversions through the queue when one is bound and the conversion asks
   * for it. With no queue bound, conversions always run inline.
   */
  queueConversions: boolean;
  /** Queue name conversion jobs are dispatched to. */
  queue: string;
  /** Default encoder quality (1–100) when a conversion does not set one. */
  quality: number;
  /** Default output format when a conversion does not set one. */
  format: SafeConversionFormat;
  /**
   * Refuse to decode an image larger than this, in bytes.
   *
   * `Bun.Image` has no streaming API — the whole file is buffered to decode it,
   * then again to encode. Without a ceiling one 400 MB upload takes the worker
   * down. Originals above it are still stored; they just get no conversions.
   */
  maxConversionInputSize: number;
  /** Widths generated for `responsive: true` collections. */
  responsiveWidths: number[];
  /** Generate the inline blur placeholder alongside responsive images. */
  responsivePlaceholder: boolean;
  /**
   * Permit AVIF/HEIC conversion targets. Off by default: they depend on OS
   * codecs that are frequently missing, and the failure lands in a background
   * job rather than in the request that configured it.
   */
  allowHostFormats: boolean;
}

const defaults: MediaConfigShape = {
  disk: "",
  conversionsDisk: "",
  table: "media",
  autoCreateTable: true,
  driver: "bun",
  queueConversions: true,
  queue: "default",
  quality: 82,
  format: "webp",
  maxConversionInputSize: 32 * 1024 * 1024,
  responsiveWidths: [320, 640, 960, 1280, 1920],
  responsivePlaceholder: true,
  allowHostFormats: false,
};

/**
 * Create a typed media configuration object with defaults.
 *
 * @example
 * import { MediaConfig } from '@zerotal/media';
 * export default MediaConfig({ disk: 's3', driver: 'sharp' });
 */
export function MediaConfig(options: Partial<MediaConfigShape> = {}): MediaConfigShape {
  return deepMerge(defaults, options);
}

/** The defaults, for tests and for resolving config in DB-less runtimes. */
export function mediaDefaults(): MediaConfigShape {
  return { ...defaults, responsiveWidths: [...defaults.responsiveWidths] };
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    media: MediaConfigShape;
  }
}
