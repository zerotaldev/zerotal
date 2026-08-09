import type { MediaItem } from "../MediaItem.ts";

/**
 * Decides where a media item's files live on disk.
 *
 * Every media item gets its own directory. That is what makes deleting one item
 * safe: removing its directory can never take a sibling's file with it, however
 * the two were named.
 */
export interface PathGenerator {
  /** Directory for the original, relative to the disk root. No trailing slash. */
  forOriginal(media: MediaItem): string;
  /** Directory for generated conversions. */
  forConversions(media: MediaItem): string;
  /** Directory for responsive image variants. */
  forResponsiveImages(media: MediaItem): string;
}

/**
 * The default layout:
 *
 * ```text
 * media/<uuid>/original.jpg
 * media/<uuid>/conversions/thumb.webp
 * media/<uuid>/responsive/640.webp
 * ```
 *
 * Keyed on `uuid` rather than the numeric `id` that Laravel's media library
 * uses. These paths end up in public URLs, and a sequential id in a public URL
 * discloses how many rows the table has — plus it lets anyone walk the range.
 * The uuid costs nothing and leaks nothing.
 */
export class DefaultPathGenerator implements PathGenerator {
  constructor(private readonly prefix: string = "media") {}

  forOriginal(media: MediaItem): string {
    return `${this.prefix}/${media.uuid}`;
  }

  forConversions(media: MediaItem): string {
    return `${this.forOriginal(media)}/conversions`;
  }

  forResponsiveImages(media: MediaItem): string {
    return `${this.forOriginal(media)}/responsive`;
  }
}
