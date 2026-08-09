import { sniffContentType } from "@zerotal/core/http";
import { MediaItem, pathGenerator } from "./MediaItem.ts";
import { resolveCollection, type CollectionHost } from "./collections/resolve.ts";
import { applyRetentionRules } from "./collections/retention.ts";
import { ConversionRunner, partitionConversions } from "./conversions/ConversionRunner.ts";
import { dispatchConversions, isQueueAvailable } from "./conversions/dispatch.ts";
import { DisallowedMimeTypeError, FileTooLargeError, UnsavedOwnerError } from "./errors.ts";
import { mediaState } from "./state.ts";
import { defaultDiskName, diskFor, diskNameFor } from "./support/disks.ts";
import type { SourceResolver } from "./sources.ts";
import type { CollectionDefinition, MediaOwner, PendingMediaMeta } from "./types.ts";

/**
 * The pending file returned by `model.addMedia(...)`, awaiting a collection.
 *
 * Nothing is read, validated or written until {@link toCollection} runs — the
 * builder just records intent, so the collection's own rules decide what is
 * allowed before any bytes are buffered.
 *
 * @example
 * await product
 *   .addMedia(await ctx.file("photo"))
 *   .usingName("Front view")
 *   .withCustomProperties({ alt: "Front view of the kettle" })
 *   .toCollection("images");
 */
export class MediaAdder {
  #meta: PendingMediaMeta = {};
  #fileName: string | undefined;

  constructor(
    private readonly owner: MediaOwner,
    private readonly ownerClass: CollectionHost,
    private readonly resolve: SourceResolver,
  ) {}

  /** Set the human-facing label. Defaults to the filename without its extension. */
  usingName(name: string): this {
    this.#meta.name = name;
    return this;
  }

  /**
   * Override the name written to disk.
   *
   * The extension is still taken from the file's own bytes: a name you chose is
   * yours to get right, but the stored `Content-Type` is a security boundary and
   * is never client-derived.
   */
  usingFileName(fileName: string): this {
    this.#fileName = fileName;
    return this;
  }

  /** Attach arbitrary JSON to the media row. */
  withCustomProperties(properties: Record<string, unknown>): this {
    this.#meta.customProperties = { ...(this.#meta.customProperties ?? {}), ...properties };
    return this;
  }

  /** Set an explicit sort position. Defaults to the end of the collection. */
  withOrder(order: number): this {
    this.#meta.order = order;
    return this;
  }

  /** Override the collection's disk for this one file. */
  toDisk(disk: string): this {
    this.#meta.disk = disk;
    return this;
  }

  /**
   * Store the file, create its row, and generate whatever the collection asks for.
   *
   * @param collection - Name of a collection the model declares.
   * @returns The saved {@link MediaItem}, with inline conversions already generated.
   * @throws {UnknownCollectionError} when the model declares no such collection.
   * @throws {DisallowedMimeTypeError} when the sniffed type is not accepted.
   * @throws {FileTooLargeError} when the file exceeds the collection's `maxSize`.
   */
  async toCollection(collection = "default"): Promise<MediaItem> {
    if (this.owner.id === undefined || this.owner.id === null || this.owner.id === "") {
      throw new UnsavedOwnerError(this.ownerClass.name);
    }

    const definition = resolveCollection(this.ownerClass, collection);
    const { bytes, originalName } = await this.resolve();

    const sniffed = sniffContentType(bytes);
    this.guard(definition, collection, sniffed.contentType, bytes.byteLength);

    const config = mediaState().config;
    const diskName = diskNameFor(
      this.#meta.disk ?? definition.disk,
      diskNameFor(config.disk, defaultDiskName()),
    );
    const conversionsDiskName = definition.conversionsDisk ?? config.conversionsDisk;

    const media = new MediaItem();
    media.modelType = this.ownerClass.name;
    media.modelId = String(this.owner.id);
    media.uuid = crypto.randomUUID();
    media.collectionName = collection;
    media.name = this.#meta.name ?? _stripExtension(originalName);
    media.fileName = this.#fileName ?? `original.${sniffed.extension}`;
    media.mimeType = sniffed.contentType;
    media.disk = diskName;
    media.conversionsDisk = conversionsDiskName === "" ? null : conversionsDiskName;
    media.size = bytes.byteLength;
    media.manipulations = {};
    media.customProperties = this.#meta.customProperties ?? {};
    media.generatedConversions = {};
    media.responsiveImages = {};
    media.orderColumn = this.#meta.order ?? (await _nextOrder(this.ownerClass.name, this.owner.id));

    // The row is saved before the bytes land so the uuid — which the path is
    // built from — is fixed and unique before anything is written under it.
    await media.save();

    const path = `${pathGenerator().forOriginal(media)}/${media.fileName}`;
    await diskFor(diskName).put(path, bytes, { contentType: sniffed.contentType });

    await this.generate(media, definition);
    await applyRetentionRules(this.ownerClass.name, this.owner.id, collection, definition, media);

    return media;
  }

  /** Enforce the collection's admission rules against the sniffed type. */
  private guard(
    definition: CollectionDefinition,
    collection: string,
    contentType: string,
    size: number,
  ): void {
    if (definition.accepts !== undefined && !definition.accepts.includes(contentType)) {
      throw new DisallowedMimeTypeError(collection, contentType, definition.accepts);
    }
    if (definition.maxSize !== undefined && size > definition.maxSize) {
      throw new FileTooLargeError(collection, size, definition.maxSize);
    }
  }

  /** Run inline conversions now and hand the rest to the queue. */
  private async generate(media: MediaItem, definition: CollectionDefinition): Promise<void> {
    const state = mediaState();
    const { inline, queued } = partitionConversions(
      definition.conversions,
      isQueueAvailable() && state.config.queueConversions,
    );

    const runner = new ConversionRunner(state.driver, state.config);
    await runner.run(media, inline);

    if (definition.responsive !== undefined && definition.responsive !== false) {
      const widths = Array.isArray(definition.responsive)
        ? definition.responsive
        : state.config.responsiveWidths;
      await runner.runResponsive(media, widths);
    }

    if (Object.keys(queued).length > 0) {
      await dispatchConversions(media.id as number, Object.keys(queued));
    }
  }
}

/** Position one past the current end of the collection. */
async function _nextOrder(modelType: string, modelId: number | string): Promise<number> {
  const rows = await MediaItem.query()
    .where("model_type", modelType)
    .where("model_id", String(modelId))
    .orderBy("order_column", "desc")
    .limit(1)
    .get();

  const highest = rows[0]?.orderColumn;
  return typeof highest === "number" ? highest + 1 : 0;
}

function _stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}
