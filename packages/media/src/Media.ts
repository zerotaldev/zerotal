import type { Constructor, ModelQueryBuilder } from "@zerotal/orm";
import { MediaItem } from "./MediaItem.ts";
import { MediaAdder } from "./MediaAdder.ts";
import { resolveCollection, type CollectionHost } from "./collections/resolve.ts";
import { mediaState } from "./state.ts";
import { fromDisk, fromPath, fromUrl, fromValue, type MediaSource } from "./sources.ts";
import type { MediaCollections, MediaOwner } from "./types.ts";

/**
 * What the mixin needs from whatever it is composed onto.
 *
 * Declaring the shape here — rather than casting `this` at each use — is what
 * keeps this file free of escape-hatch casts. `constructor` is typed as the
 * concrete class so `mediaCollections` and `name` are reachable directly;
 * `softDeletes` is whatever the `SoftDeletes` mixin set, if it is in the chain.
 */
interface MediaHost extends MediaOwner {
  id: number | string;
  readonly constructor: CollectionHost & { softDeletes?: boolean };
}

// Helpers live at module scope rather than as private methods: a mixin returns an
// anonymous class type, and TypeScript refuses to emit declarations for one that
// carries private members (TS4094). Every ORM mixin has the same shape.

/** Every media row this model owns, before any collection filter. */
function ownedQuery(self: MediaHost): ModelQueryBuilder<MediaItem> {
  return MediaItem.query()
    .where("model_type", self.constructor.name)
    .where("model_id", String(self.id));
}

/**
 * Adds media handling to a model.
 *
 * Compose it with `Model.using(...)` and declare the collections the model
 * owns in a static `mediaCollections` field. Zerotal's equivalent of Laravel's
 * `HasMedia` interface plus `InteractsWithMedia` trait, in one piece — named for
 * how it reads at the call site: `Model.using(Media)`.
 *
 * ## Deleting
 *
 * Hard-deleting a model deletes every file attached to it — without that, an
 * upload outlives the only row that knew where it was, and you keep paying for
 * storage nothing can reach. **Soft deletes are left alone**: restoring a model
 * whose images had already been destroyed would be worse than an orphaned file,
 * so a `SoftDeletes` model keeps its media until `forceDelete()`.
 *
 * @example
 * ```ts
 * export class Product extends Model.using(Media) {
 *   \@column() name!: string;
 *
 *   static override mediaCollections: MediaCollections = {
 *     images: {
 *       accepts: ["image/jpeg", "image/png"],
 *       conversions: { thumb: { width: 200, height: 200 } },
 *     },
 *   };
 * }
 *
 * const product = await Product.create({ name: "Kettle" });
 * await product.addMedia(await ctx.file("photo")).toCollection("images");
 * await product.getFirstMediaUrl("images", "thumb");
 * ```
 */
export function Media<TBase extends Constructor>(Base: TBase) {
  class MediaModel extends Base {
    /**
     * The collections this model owns. Override in the subclass.
     *
     * A collection must be declared before anything can be added to it: an
     * undeclared name is nearly always a typo, and silently accepting one would
     * hide the mistake until someone noticed an empty gallery.
     */
    static mediaCollections: MediaCollections = {};

    /** Primary key, supplied by the model this is composed onto. */
    declare id: number | string;

    /**
     * The concrete subclass, typed so its statics are reachable.
     *
     * `Object.prototype.constructor` is `Function`, which knows nothing of
     * `mediaCollections`. Re-declaring it here is what lets every method below
     * read the model's collections without a cast at each use.
     */
    declare readonly ["constructor"]: CollectionHost & { softDeletes?: boolean };

    // ── Adding ───────────────────────────────────────────────────────────────

    /**
     * Attach a file. Nothing is read or written until `.toCollection(name)` is
     * awaited.
     *
     * @param source - An `UploadedFile`, `File`, `Blob`, `Uint8Array` or `ArrayBuffer`.
     * @param fileName - Overrides the name the source reports.
     */
    addMedia(source: MediaSource, fileName?: string): MediaAdder {
      return new MediaAdder(this, this.constructor, fromValue(source, fileName));
    }

    /** Attach a file fetched over http(s). */
    addMediaFromUrl(url: string): MediaAdder {
      return new MediaAdder(
        this,
        this.constructor,
        fromUrl(url, mediaState().config.maxConversionInputSize),
      );
    }

    /** Attach a file already stored on one of the app's disks. */
    addMediaFromDisk(path: string, disk?: string): MediaAdder {
      return new MediaAdder(this, this.constructor, fromDisk(path, disk));
    }

    /** Attach a file from the local filesystem. */
    addMediaFromPath(path: string): MediaAdder {
      return new MediaAdder(this, this.constructor, fromPath(path));
    }

    /**
     * Copy an existing media item onto this model.
     *
     * The bytes are re-read and re-stored under a fresh uuid, so the two items
     * are fully independent — deleting either leaves the other's file intact.
     * Name and custom properties carry over; chain the builder's methods to
     * change them.
     *
     * @example
     * await draft.copyMedia(original).toCollection("images");
     */
    copyMedia(media: MediaItem): MediaAdder {
      return new MediaAdder(this, this.constructor, async () => ({
        bytes: await media.bytes(),
        originalName: media.fileName,
      }))
        .usingName(media.name)
        .withCustomProperties(media.customProperties ?? {});
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    /** Every item in a collection, in order. */
    async getMedia(collection = "default"): Promise<MediaItem[]> {
      return ownedQuery(this)
        .where("collection_name", collection)
        .orderBy("order_column", "asc")
        .orderBy("id", "asc")
        .get();
    }

    /** The first item in a collection, or `null`. */
    async getFirstMedia(collection = "default"): Promise<MediaItem | null> {
      const all = await this.getMedia(collection);
      return all[0] ?? null;
    }

    /**
     * URL of the first item, or the collection's `fallbackUrl` when it is empty.
     *
     * Returns `""` when there is neither, so it can go straight into `src`
     * without a null check.
     *
     * A conversion that has not been generated yet — a queued one, most likely —
     * falls back to the original rather than to nothing, so a gallery is never
     * blank while the queue catches up.
     */
    async getFirstMediaUrl(collection = "default", conversion?: string): Promise<string> {
      const media = await this.getFirstMedia(collection);
      if (media === null) return resolveCollection(this.constructor, collection).fallbackUrl ?? "";

      const url = media.getUrl(conversion);
      if (url === "" && conversion !== undefined) return media.getUrl();
      return url;
    }

    /** Path of the first item, or the collection's `fallbackPath`. */
    async getFirstMediaPath(collection = "default", conversion?: string): Promise<string> {
      const media = await this.getFirstMedia(collection);
      if (media === null) return resolveCollection(this.constructor, collection).fallbackPath ?? "";
      return media.getPath(conversion);
    }

    /** Whether a collection holds anything. */
    async hasMedia(collection = "default"): Promise<boolean> {
      const rows = await ownedQuery(this).where("collection_name", collection).limit(1).get();
      return rows.length > 0;
    }

    /** How many items a collection holds. */
    async mediaCount(collection = "default"): Promise<number> {
      const rows = await ownedQuery(this).where("collection_name", collection).get();
      return rows.length;
    }

    // ── Removing ─────────────────────────────────────────────────────────────

    /**
     * Delete every item in a collection, files included.
     *
     * @returns How many items were removed.
     */
    async clearMediaCollection(collection = "default"): Promise<number> {
      const all = await this.getMedia(collection);
      for (const media of all) await media.delete();
      return all.length;
    }

    /** Delete every item this model owns, across every collection. */
    async clearAllMedia(): Promise<number> {
      const all = await ownedQuery(this).get();
      for (const media of all) await media.delete();
      return all.length;
    }

    // ── Ordering ─────────────────────────────────────────────────────────────

    /**
     * Reorder a collection to match the given media ids.
     *
     * Ids missing from the list keep their relative order *after* the ones
     * present, so handing in only the three items a drag-and-drop UI moved does
     * what it looks like rather than silently discarding the rest.
     */
    async setMediaOrder(ids: Array<number | string>, collection = "default"): Promise<void> {
      const all = await this.getMedia(collection);
      const wanted = ids.map(String);

      const ranked = [...all].sort((a, b) => {
        const ai = wanted.indexOf(String(a.id));
        const bi = wanted.indexOf(String(b.id));
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return 0;
      });

      for (const [index, media] of ranked.entries()) {
        if (media.orderColumn === index) continue;
        media.orderColumn = index;
        await media.save();
      }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Delete the model, cascading to its files on a hard delete.
     *
     * A soft-deleting model keeps its media: `restore()` is supposed to give
     * back the model you had, and it cannot do that if the images were destroyed
     * on the way out. Those files go on `forceDelete()` instead.
     */
    async delete(): Promise<void> {
      if (this.constructor.softDeletes !== true) await this.clearAllMedia();

      // Reached through the base prototype rather than `super` because the mixin
      // is generic over a bare constructor — the same reason every ORM mixin is.
      const base = Base.prototype as { delete?: () => Promise<void> };
      await base.delete?.call(this);
    }

    /**
     * Permanently delete a soft-deleting model, taking its files with it.
     *
     * A no-op passthrough when `SoftDeletes` is not composed in — there is no
     * `forceDelete` to extend, and `delete()` has already done the cascade.
     */
    async forceDelete(): Promise<void> {
      await this.clearAllMedia();
      const base = Base.prototype as { forceDelete?: () => Promise<void> };
      await base.forceDelete?.call(this);
    }
  }

  return MediaModel;
}
