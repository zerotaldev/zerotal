import { BaseModel, column, table } from "@zerotal/orm";
import type { StorageDriver } from "@zerotal/core/storage";
import { diskFor } from "./support/disks.ts";
import { DefaultPathGenerator, type PathGenerator } from "./paths/PathGenerator.ts";
import { MediaFileMissingError } from "./errors.ts";
import type { GeneratedConversion, ResponsiveImageSet } from "./types.ts";

/** Swappable at the container level by `MediaProvider`. */
let _pathGenerator: PathGenerator = new DefaultPathGenerator();

/** Replace the global path generator. Called by `MediaProvider` from config. */
export function setPathGenerator(generator: PathGenerator): void {
  _pathGenerator = generator;
}

/** The path generator currently in force. */
/** @internal — reads the active generator; `setPathGenerator` is the public seam. */
export function pathGenerator(): PathGenerator {
  return _pathGenerator;
}

/**
 * One stored file attached to a model.
 *
 * Rows are created by `model.addMedia(...)` rather than directly — the adder is
 * what sniffs the file's type, enforces the collection's rules, writes the bytes
 * and generates conversions. Constructing a `MediaItem` by hand gets you a row with
 * no file behind it.
 *
 * @example
 * const media = await product.addMedia(file).toCollection("images");
 * media.getUrl();          // the original
 * media.getUrl("thumb");   // a conversion, or "" when it has not been generated
 * await media.delete();    // removes the row, the original, and every derivative
 */
@(table("media").withTimestamps())
export class MediaItem extends BaseModel {
  /** Owner discriminator — the owning model's class name. */
  @column() modelType!: string;
  /** Owner primary key. Stored as text so UUID keys work as well as integers. */
  @column() modelId!: string;
  /** Public identifier. Used in paths, so it never exposes the row count. */
  @column() uuid!: string;
  @column() collectionName!: string;
  /** Human-facing label; defaults to the original filename without its extension. */
  @column() name!: string;
  /** Name on disk, e.g. `original.jpg`. */
  @column() fileName!: string;
  /** Sniffed from the file's own bytes — never the client-supplied header. */
  @column() mimeType!: string | null;
  @column() disk!: string;
  @column() conversionsDisk!: string | null;
  @column("number") size!: number;
  @column("json") manipulations!: Record<string, unknown>;
  @column("json") customProperties!: Record<string, unknown>;
  @column("json") generatedConversions!: Record<string, GeneratedConversion>;
  @column("json") responsiveImages!: ResponsiveImageSet | Record<string, never>;
  @column("number") orderColumn!: number | null;

  // ── Scopes ─────────────────────────────────────────────────────────────────

  static forOwner = this.scope((q, type: string, id: string | number) =>
    q.where("model_type", type).where("model_id", String(id)),
  );

  static inCollection = this.scope((q, collection: string) =>
    q.where("collection_name", collection),
  );

  static ordered = this.scope((q) => q.orderBy("order_column", "asc").orderBy("id", "asc"));

  // ── Disks ──────────────────────────────────────────────────────────────────

  /** The disk holding the original. */
  originalDisk(): StorageDriver {
    return diskFor(this.disk);
  }

  /** The disk holding conversions — falls back to the original's disk. */
  derivedDisk(): StorageDriver {
    return diskFor(this.conversionsDisk ?? this.disk);
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  /**
   * Path to the original, or to a named conversion.
   *
   * Returns `""` for a conversion that has not been generated — matching
   * `getUrl()`, so a template can use either without a null check.
   */
  getPath(conversion?: string): string {
    if (conversion === undefined) {
      return `${pathGenerator().forOriginal(this)}/${this.fileName}`;
    }
    const generated = this.generatedConversions?.[conversion];
    if (!generated) return "";
    return `${pathGenerator().forConversions(this)}/${generated.fileName}`;
  }

  /** Path to one responsive variant by width, or `""` when absent. */
  getResponsivePath(width: number): string {
    const entry = this.responsiveSet().images.find((i) => i.width === width);
    if (!entry) return "";
    return `${pathGenerator().forResponsiveImages(this)}/${entry.fileName}`;
  }

  // ── URLs ───────────────────────────────────────────────────────────────────

  /**
   * Public URL for the original, or for a named conversion.
   *
   * Returns `""` when the conversion does not exist, so `<img src="">` renders
   * nothing rather than a broken path — check `hasConversion()` when you need to
   * branch.
   */
  getUrl(conversion?: string): string {
    const path = this.getPath(conversion);
    if (path === "") return "";
    const disk = conversion === undefined ? this.originalDisk() : this.derivedDisk();
    return disk.url(path);
  }

  /**
   * A signed, expiring URL — the way to expose a file on a private disk without
   * making the disk public.
   *
   * @param expiresInSeconds - Lifetime of the link. Default 900 (15 minutes).
   */
  async getTemporaryUrl(expiresInSeconds = 900, conversion?: string): Promise<string> {
    const path = this.getPath(conversion);
    if (path === "") return "";
    const disk = conversion === undefined ? this.originalDisk() : this.derivedDisk();
    return disk.temporaryUrl(path, expiresInSeconds);
  }

  // ── Conversions ────────────────────────────────────────────────────────────

  /** Whether a named conversion has been generated. */
  hasConversion(name: string): boolean {
    return Boolean(this.generatedConversions?.[name]);
  }

  /** Metadata for a generated conversion, or `null`. */
  conversion(name: string): GeneratedConversion | null {
    return this.generatedConversions?.[name] ?? null;
  }

  /** Names of every generated conversion. */
  conversionNames(): string[] {
    return Object.keys(this.generatedConversions ?? {});
  }

  // ── Responsive images ──────────────────────────────────────────────────────

  /** The responsive set, normalised so callers never see `undefined`. */
  responsiveSet(): ResponsiveImageSet {
    const raw = this.responsiveImages as ResponsiveImageSet | undefined;
    if (!raw || !Array.isArray(raw.images)) return { images: [] };
    return raw;
  }

  /**
   * A `srcset` attribute value for the responsive ladder, or `""` when none was
   * generated.
   *
   * @example
   * <img src={media.getUrl()} srcset={media.srcset()} sizes="(max-width: 768px) 100vw, 50vw" />
   */
  srcset(): string {
    const set = this.responsiveSet();
    if (set.images.length === 0) return "";
    const disk = this.derivedDisk();
    const dir = pathGenerator().forResponsiveImages(this);
    return set.images
      .map((image) => `${disk.url(`${dir}/${image.fileName}`)} ${image.width}w`)
      .join(", ");
  }

  /**
   * An inline `data:` URI of a tiny blurred version, for rendering while the
   * real image loads. `null` when none was generated.
   */
  get placeholder(): string | null {
    return this.responsiveSet().placeholder ?? null;
  }

  // ── Custom properties ──────────────────────────────────────────────────────

  /**
   * Read a custom property, with an optional fallback.
   *
   * Custom properties are an untyped JSON bag, so without a fallback the result is `unknown` —
   * narrow it yourself (`as string`, or a type guard). With a fallback the result is the
   * fallback's type and can never be `undefined`.
   *
   * The no-fallback overload is deliberately **non-generic**. A `<T = unknown>` parameter that
   * appears only in the return type is inferred from the CALL SITE's context rather than falling
   * back to its default, so `expect(item.getCustomProperty("alt"))` collapsed `T` to `undefined`
   * and rejected every assertion against it. A concrete `unknown` cannot be hijacked that way.
   */
  getCustomProperty(key: string): unknown;
  getCustomProperty<T>(key: string, fallback: T): T;
  getCustomProperty<T>(key: string, fallback?: T): T | undefined {
    const value = this.customProperties?.[key];
    return (value as T | undefined) ?? fallback;
  }

  /** Set a custom property in memory. Call `save()` to persist. */
  setCustomProperty(key: string, value: unknown): this {
    this.customProperties = { ...(this.customProperties ?? {}), [key]: value };
    return this;
  }

  /** Remove a custom property in memory. Call `save()` to persist. */
  forgetCustomProperty(key: string): this {
    const next = { ...(this.customProperties ?? {}) };
    delete next[key];
    this.customProperties = next;
    return this;
  }

  // ── Contents ───────────────────────────────────────────────────────────────

  /** Read the original's bytes. */
  async bytes(): Promise<Uint8Array> {
    const path = this.getPath();
    const buffer = await this.originalDisk().getBuffer(path);
    if (buffer === null) throw new MediaFileMissingError(path, this.disk);
    return buffer;
  }

  /** Whether the original is actually present on its disk. */
  async fileExists(): Promise<boolean> {
    return this.originalDisk().exists(this.getPath());
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Delete the row and every file behind it — original, conversions, responsive
   * variants.
   *
   * Files go first. A failure part-way then leaves a row pointing at a missing
   * file, which `media:clean` can find and fix; the reverse order would leave an
   * orphaned file that nothing references and nothing can find.
   */
  override async delete(): Promise<void> {
    await this.deleteFiles();
    await super.delete();
  }

  /** Remove every file for this item, leaving the row. */
  async deleteFiles(): Promise<void> {
    const original = this.originalDisk();
    const derived = this.derivedDisk();

    await _ignoreMissing(original.delete(this.getPath()));

    const conversionDir = pathGenerator().forConversions(this);
    for (const generated of Object.values(this.generatedConversions ?? {})) {
      await _ignoreMissing(derived.delete(`${conversionDir}/${generated.fileName}`));
    }

    const responsiveDir = pathGenerator().forResponsiveImages(this);
    for (const image of this.responsiveSet().images) {
      await _ignoreMissing(derived.delete(`${responsiveDir}/${image.fileName}`));
    }
  }
}

/**
 * Deleting a file that is already gone is the outcome we wanted. Anything else
 * propagates.
 */
async function _ignoreMissing(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|no such file|ENOENT|does not exist/i.test(message)) throw error;
  }
}
