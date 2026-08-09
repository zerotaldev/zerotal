import { MediaItem } from "./MediaItem.ts";
import { ConversionRunner } from "./conversions/ConversionRunner.ts";
import { resolveCollection, type CollectionHost } from "./collections/resolve.ts";
import { diskFor } from "./support/disks.ts";
import type { MediaConfigShape } from "./config.ts";
import type { ImageDriver } from "./conversions/ImageDriver.ts";
import type { ConversionMap } from "./types.ts";

/** Outcome of a {@link MediaManager.clean} pass. */
export interface CleanReport {
  /** Rows whose file is gone from its disk. */
  orphanedRows: number[];
  /** Rows deleted (empty when `dryRun`). */
  deletedRows: number[];
  /** Conversions recorded on a row whose file is missing. */
  danglingConversions: Array<{ mediaId: number; conversion: string }>;
}

/**
 * Application-level media operations — the thing behind the `MediaLibrary` facade.
 *
 * Per-model work lives on the {@link Media} mixin; this is for the jobs that
 * cut across models: regenerating conversions after changing a definition, and
 * reconciling rows against what is actually on disk.
 */
export class MediaManager {
  constructor(
    readonly config: MediaConfigShape,
    readonly driver: ImageDriver,
  ) {}

  /** A runner bound to the configured driver. */
  runner(): ConversionRunner {
    return new ConversionRunner(this.driver, this.config);
  }

  /**
   * Regenerate conversions for one media item.
   *
   * Reads the collection definition off the owning model class, so changing a
   * conversion's width and re-running this is all it takes to reprocess.
   *
   * @param media - The item to reprocess.
   * @param ownerClass - The owning model class, for its collection definitions.
   * @param only - Limit to these conversion names; omit for all of them.
   */
  async regenerate(
    media: MediaItem,
    ownerClass: CollectionHost,
    only?: string[],
  ): Promise<string[]> {
    const definition = resolveCollection(ownerClass, media.collectionName);
    const all = definition.conversions ?? {};

    const wanted: ConversionMap = {};
    for (const [name, conversion] of Object.entries(all)) {
      if (only === undefined || only.includes(name)) wanted[name] = conversion;
    }

    const { generated } = await this.runner().run(media, wanted);

    if (definition.responsive !== undefined && definition.responsive !== false) {
      const widths = Array.isArray(definition.responsive)
        ? definition.responsive
        : this.config.responsiveWidths;
      await this.runner().runResponsive(media, widths);
    }

    return generated;
  }

  /**
   * Find media rows whose files have gone missing, and optionally remove them.
   *
   * Rows are checked one at a time against their own disk rather than by listing
   * the disk, because the two live on different sides of a network for S3 and a
   * full listing of a large bucket is not something to do casually.
   *
   * @param options.dryRun - Report without deleting. Default `true`, because the
   *   destructive reading of "clean" should never be the one you get by accident.
   */
  async clean(options: { dryRun?: boolean } = {}): Promise<CleanReport> {
    const dryRun = options.dryRun ?? true;
    const report: CleanReport = { orphanedRows: [], deletedRows: [], danglingConversions: [] };

    const all = await MediaItem.query().get();

    for (const media of all) {
      const id = Number(media.id);

      if (!(await media.fileExists())) {
        report.orphanedRows.push(id);
        if (!dryRun) {
          await media.delete();
          report.deletedRows.push(id);
        }
        continue;
      }

      const derived = diskFor(media.conversionsDisk ?? media.disk);
      for (const name of media.conversionNames()) {
        const path = media.getPath(name);
        if (path !== "" && !(await derived.exists(path))) {
          report.danglingConversions.push({ mediaId: id, conversion: name });
        }
      }
    }

    return report;
  }
}
