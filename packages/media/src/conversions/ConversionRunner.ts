import {
  FORMAT_EXTENSION,
  isConvertible,
  type ImageDriver,
  type ImageManipulation,
} from "./ImageDriver.ts";
import { UnsupportedFormatError } from "../errors.ts";
import { pathGenerator, type MediaItem } from "../MediaItem.ts";
import { diskFor } from "../support/disks.ts";
import type { MediaConfigShape } from "../config.ts";
import type {
  ConversionDefinition,
  ConversionFormat,
  ConversionMap,
  GeneratedConversion,
  ResponsiveImage,
  ResponsiveImageSet,
  SafeConversionFormat,
} from "../types.ts";

/** Formats that encode on every host, whatever OS codecs it has. */
const PORTABLE: ReadonlySet<string> = new Set<SafeConversionFormat>(["jpeg", "png", "webp"]);

/** Which of a collection's conversions run now versus on the queue. */
export function partitionConversions(
  conversions: ConversionMap | undefined,
  queueAvailable: boolean,
): { inline: ConversionMap; queued: ConversionMap } {
  const inline: ConversionMap = {};
  const queued: ConversionMap = {};

  for (const [name, definition] of Object.entries(conversions ?? {})) {
    // Without a queue bound there is nowhere to defer to, so a conversion marked
    // `queued` still runs — late is better than never, and an app with no queue
    // would otherwise get silently empty thumbnails.
    if (definition.queued === true && queueAvailable) queued[name] = definition;
    else inline[name] = definition;
  }

  return { inline, queued };
}

/**
 * Generates derived images and writes them next to their original.
 *
 * Failure of a single conversion is contained: the original is already stored
 * and its row already exists, so a codec that chokes on one file should cost
 * that file its thumbnail, not the upload. Failures are collected and returned
 * rather than thrown.
 *
 * @internal — the conversion engine, constructed by MediaProvider.
 */
export class ConversionRunner {
  constructor(
    private readonly driver: ImageDriver,
    private readonly config: MediaConfigShape,
  ) {}

  /**
   * Run `conversions` against `media` and record what was generated.
   *
   * Mutates and saves the media row's `generated_conversions`. Returns the names
   * that failed, with the reason, so a caller can log or surface them.
   */
  async run(
    media: MediaItem,
    conversions: ConversionMap,
  ): Promise<{ generated: string[]; failed: Array<{ name: string; reason: string }> }> {
    const generated: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    if (Object.keys(conversions).length === 0) return { generated, failed };
    if (!isConvertible(media.mimeType)) return { generated, failed };

    const source = await this.readSource(media);
    if (source === null) return { generated, failed };

    const metadata = await this.driver.metadata(source);
    if (metadata === null) return { generated, failed };

    const disk = diskFor(media.conversionsDisk ?? media.disk);
    const directory = pathGenerator().forConversions(media);
    const results: Record<string, GeneratedConversion> = { ...(media.generatedConversions ?? {}) };

    for (const [name, definition] of Object.entries(conversions)) {
      try {
        const format = await this.resolveFormat(definition, metadata.format);
        const manipulation = this.toManipulation(definition, format);
        const result = await this.driver.convert(source, manipulation);

        const fileName = `${name}.${FORMAT_EXTENSION[format]}`;
        await disk.put(`${directory}/${fileName}`, result.bytes, {
          contentType: result.mimeType,
        });

        results[name] = {
          fileName,
          size: result.bytes.byteLength,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          generatedAt: new Date().toISOString(),
        };
        generated.push(name);
      } catch (error) {
        failed.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    if (generated.length > 0) {
      media.generatedConversions = results;
      await media.save();
    }

    return { generated, failed };
  }

  /**
   * Generate the responsive width ladder plus an inline placeholder.
   *
   * Widths at or above the source's own width are skipped — upscaling produces a
   * bigger file that looks worse, and a `srcset` entry claiming a width the
   * pixels do not support makes the browser pick the wrong candidate.
   */
  async runResponsive(media: MediaItem, widths: number[]): Promise<ResponsiveImageSet | null> {
    if (!isConvertible(media.mimeType)) return null;

    const source = await this.readSource(media);
    if (source === null) return null;

    const metadata = await this.driver.metadata(source);
    if (metadata === null) return null;

    const disk = diskFor(media.conversionsDisk ?? media.disk);
    const directory = pathGenerator().forResponsiveImages(media);
    const format = await this.resolveFormat({}, metadata.format);
    const images: ResponsiveImage[] = [];

    for (const width of [...widths].sort((a, b) => a - b)) {
      if (width > metadata.width) continue;
      try {
        const result = await this.driver.convert(source, {
          width,
          fit: "inside",
          format,
          quality: this.config.quality,
          withoutEnlargement: true,
        });
        const fileName = `${width}.${FORMAT_EXTENSION[format]}`;
        await disk.put(`${directory}/${fileName}`, result.bytes, {
          contentType: result.mimeType,
        });
        images.push({ fileName, width: result.width, height: result.height });
      } catch {
        // One missing rung does not invalidate the ladder.
      }
    }

    const set: ResponsiveImageSet = { images };

    if (this.config.responsivePlaceholder) {
      const placeholder = await this.driver.placeholder(source);
      if (placeholder !== null) set.placeholder = placeholder;
    }

    if (images.length === 0 && set.placeholder === undefined) return null;

    media.responsiveImages = set;
    await media.save();
    return set;
  }

  /** Read the original, refusing anything too large to decode safely. */
  private async readSource(media: MediaItem): Promise<Uint8Array | null> {
    if (media.size > this.config.maxConversionInputSize) return null;
    try {
      return await media.bytes();
    } catch {
      return null;
    }
  }

  /**
   * The output format for one conversion.
   *
   * An explicit `format` wins but is verified against the host — asking for AVIF
   * where no AV1 encoder exists is a configuration error worth reporting, not
   * something to silently substitute. Otherwise the source format is kept when
   * it is portable, and the configured default is used when it is not (a GIF or
   * BMP source has no encoder at all, so it must change).
   */
  private async resolveFormat(
    definition: ConversionDefinition,
    sourceFormat: string,
  ): Promise<ConversionFormat> {
    if (definition.format !== undefined) {
      const requested = definition.format;
      if (!PORTABLE.has(requested) && !(await this.driver.canEncode(requested))) {
        throw new UnsupportedFormatError(requested, [...PORTABLE]);
      }
      return requested;
    }

    if (PORTABLE.has(sourceFormat)) return sourceFormat as SafeConversionFormat;
    return this.config.format;
  }

  private toManipulation(
    definition: ConversionDefinition,
    format: ConversionFormat,
  ): ImageManipulation {
    return {
      ...(definition.width !== undefined ? { width: definition.width } : {}),
      ...(definition.height !== undefined ? { height: definition.height } : {}),
      ...(definition.rotate !== undefined ? { rotate: definition.rotate } : {}),
      fit: definition.fit ?? "inside",
      format,
      quality: definition.quality ?? this.config.quality,
      // Inverted at the boundary: the collection API reads better as an opt-in
      // ("allow this"), the driver contract as a constraint ("do not do this").
      withoutEnlargement: definition.allowEnlargement !== true,
    };
  }
}
