import { MediaItem } from "./MediaItem.ts";

/**
 * Assertions over what a test attached to its models.
 *
 * Pairs with `Storage.fake()`, which handles the bytes: that one asserts a file
 * landed on a disk, this one asserts a row points at it from the right
 * collection. Both matter — a media row with no file and a file with no row are
 * different bugs.
 *
 * @example
 * const disk = Storage.fake();
 * await product.addMedia(file).toCollection("images");
 *
 * await MediaFake.assertHas(product, "images");
 * await MediaFake.assertCount(product, "images", 1);
 * disk.assertExistsMatching(/^media\/[0-9a-f-]+\/original\.png$/);
 */
export const MediaFake = {
  /** Every media row attached to a model. */
  async all(owner: { id: number | string; constructor: { name: string } }): Promise<MediaItem[]> {
    return MediaItem.query()
      .where("model_type", owner.constructor.name)
      .where("model_id", String(owner.id))
      .orderBy("id", "asc")
      .get();
  },

  /** Media rows in one of a model's collections. */
  async inCollection(
    owner: { id: number | string; constructor: { name: string } },
    collection: string,
  ): Promise<MediaItem[]> {
    const all = await MediaFake.all(owner);
    return all.filter((media) => media.collectionName === collection);
  },

  /** Fail unless the collection holds at least one item. */
  async assertHas(
    owner: { id: number | string; constructor: { name: string } },
    collection: string,
  ): Promise<void> {
    const found = await MediaFake.inCollection(owner, collection);
    if (found.length > 0) return;

    const all = await MediaFake.all(owner);
    const others = [...new Set(all.map((m) => m.collectionName))];
    throw new Error(
      `Expected ${owner.constructor.name}#${owner.id} to have media in "${collection}", ` +
        `but it has none. Collections with media: ${others.length > 0 ? others.join(", ") : "none"}.`,
    );
  },

  /** Fail unless the collection is empty. */
  async assertMissing(
    owner: { id: number | string; constructor: { name: string } },
    collection: string,
  ): Promise<void> {
    const found = await MediaFake.inCollection(owner, collection);
    if (found.length === 0) return;
    throw new Error(
      `Expected "${collection}" to be empty, but it holds ${found.length}: ` +
        found.map((m) => m.fileName).join(", "),
    );
  },

  /** Fail unless the collection holds exactly `count` items. */
  async assertCount(
    owner: { id: number | string; constructor: { name: string } },
    collection: string,
    count: number,
  ): Promise<void> {
    const found = await MediaFake.inCollection(owner, collection);
    if (found.length === count) return;
    throw new Error(
      `Expected "${collection}" to hold ${count} item(s), found ${found.length}: ` +
        (found.map((m) => m.fileName).join(", ") || "none"),
    );
  },

  /** Fail unless a named conversion was generated for the collection's first item. */
  async assertConversion(
    owner: { id: number | string; constructor: { name: string } },
    collection: string,
    conversion: string,
  ): Promise<void> {
    const [first] = await MediaFake.inCollection(owner, collection);
    if (first === undefined) {
      throw new Error(`Expected a conversion "${conversion}", but "${collection}" is empty.`);
    }
    if (first.hasConversion(conversion)) return;

    const generated = first.conversionNames();
    throw new Error(
      `Expected conversion "${conversion}" on ${first.fileName}, but it has ` +
        `${generated.length > 0 ? generated.join(", ") : "none"}.`,
    );
  },
};
