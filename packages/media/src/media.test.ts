import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { UploadedFile } from "@zerotal/core/http";
import { StorageManager } from "@zerotal/core/storage";
import type { FakeDisk } from "@zerotal/core/storage";
import {
  Model,
  Schema,
  column,
  table,
  _setBaseModelConnection,
  _setDbConnection,
} from "@zerotal/orm";

import { MediaItem } from "./MediaItem.ts";
import { Media } from "./Media.ts";
import { MediaFake } from "./MediaFake.ts";
import { BunImageDriver } from "./conversions/BunImageDriver.ts";
import { ConversionRunner, partitionConversions } from "./conversions/ConversionRunner.ts";
import { setConversionDispatcher, isQueueAvailable } from "./conversions/dispatch.ts";
import { mediaDefaults, MediaConfig } from "./config.ts";
import { setMediaState, resetMediaState } from "./state.ts";
import { DefaultPathGenerator } from "./paths/PathGenerator.ts";
import { collectionNames, hasCollection, resolveCollection } from "./collections/resolve.ts";
import { setDiskResolver, setDefaultDiskName } from "./support/disks.ts";
import {
  DisallowedMimeTypeError,
  FileTooLargeError,
  UnknownCollectionError,
  UnsavedOwnerError,
} from "./errors.ts";
import type { ImageDriver } from "./conversions/ImageDriver.ts";
import type { MediaCollections } from "./types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A real 4×4 PNG — conversions decode it, so it cannot be arbitrary bytes. */
const PNG_4x4 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8z8AARIQBEwOZYFQj" +
      "AJ9gARL5lTPCAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

/** A wider PNG, so the responsive ladder has something to step down from. */
let PNG_WIDE: Uint8Array;

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n% test fixture\n");

@(table("products").withTimestamps())
class Product extends Model.using(Media) {
  @column() name!: string;

  static override fillable = ["name"];

  static override mediaCollections: MediaCollections = {
    images: {
      accepts: ["image/png", "image/jpeg"],
      conversions: {
        thumb: { width: 2, height: 2, format: "webp", quality: 70 },
      },
    },
    docs: { accepts: ["application/pdf"], maxSize: 64 },
    avatar: { single: true },
    gallery: { onlyKeepLatest: 2 },
    banner: { fallbackUrl: "/img/placeholder.svg", fallbackPath: "img/placeholder.svg" },
    deferred: { conversions: { later: { width: 2, queued: true } } },
    elsewhere: { disk: "other" },
    plain: {},
  };
}

let storage: StorageManager;
let disk: FakeDisk;

beforeAll(async () => {
  const db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);

  await Schema.create("products", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamp("created_at").nullable();
    t.timestamp("updated_at").nullable();
  });

  await Schema.create("media", (t) => {
    t.increments("id");
    t.string("model_type");
    t.string("model_id");
    t.string("uuid").nullable();
    t.string("collection_name");
    t.string("name");
    t.string("file_name");
    t.string("mime_type").nullable();
    t.string("disk");
    t.string("conversions_disk").nullable();
    t.integer("size");
    t.text("manipulations").nullable();
    t.text("custom_properties").nullable();
    t.text("generated_conversions").nullable();
    t.text("responsive_images").nullable();
    t.integer("order_column").nullable();
    t.timestamp("created_at").nullable();
    t.timestamp("updated_at").nullable();
  });

  PNG_WIDE = await new Bun.Image(PNG_4x4).resize(400, 200).png().bytes();
});

beforeEach(() => {
  storage = new StorageManager({
    default: "local",
    disks: {
      local: { driver: "local", root: "storage/app", url: "/storage" },
      other: { driver: "local", root: "storage/other", url: "/other" },
    },
  });
  disk = storage.fake("local");
  storage.fake("other");

  // Resolve disks straight off this manager rather than through the Storage
  // facade, which would need an ambient application these tests have no reason
  // to build.
  setDiskResolver((name) => storage.disk(name));
  setDefaultDiskName("local");

  setMediaState({ config: { ...mediaDefaults(), disk: "local" }, driver: new BunImageDriver() });
});

afterEach(async () => {
  storage.restoreFakes();
  setDiskResolver(null);
  setDefaultDiskName(null);
  resetMediaState();
  setConversionDispatcher(null);
  await MediaItem.query().delete();
  await Product.query().delete();
});

// ── Config ────────────────────────────────────────────────────────────────────

describe("MediaConfig", () => {
  it("fills in defaults and keeps overrides", () => {
    const config = MediaConfig({ disk: "s3", driver: "sharp" });

    expect(config.disk).toBe("s3");
    expect(config.driver).toBe("sharp");
    expect(config.table).toBe("media");
    expect(config.quality).toBe(82);
    expect(config.allowHostFormats).toBe(false);
  });
});

// ── Collection resolution ─────────────────────────────────────────────────────

describe("collections", () => {
  it("rejects an undeclared collection, listing the ones that exist", async () => {
    const product = await Product.create({ name: "Kettle" });

    const attempt = (): Promise<MediaItem> =>
      product.addMedia(UploadedFile.fake("a.png", { content: PNG_4x4 })).toCollection("imagez");

    await expect(attempt()).rejects.toThrow(UnknownCollectionError);
    await expect(attempt()).rejects.toThrow(/"images"/);
  });

  it("exposes declared names and membership", () => {
    expect(hasCollection(Product, "images")).toBe(true);
    expect(hasCollection(Product, "nope")).toBe(false);
    expect(collectionNames(Product)).toContain("avatar");
  });

  it("calls a thunked definition on every lookup", () => {
    let calls = 0;
    const host = {
      name: "Tenanted",
      mediaCollections: {
        images: () => {
          calls++;
          return { disk: `tenant-${calls}` };
        },
      },
    };

    expect(resolveCollection(host, "images").disk).toBe("tenant-1");
    expect(resolveCollection(host, "images").disk).toBe("tenant-2");
  });

  it("refuses to attach media to an unsaved model", async () => {
    const product = new Product();

    await expect(
      product.addMedia(UploadedFile.fake("a.png", { content: PNG_4x4 })).toCollection("images"),
    ).rejects.toThrow(UnsavedOwnerError);
  });
});

// ── Admission rules ───────────────────────────────────────────────────────────

describe("admission rules", () => {
  it("accepts a file whose bytes match the collection's mime list", async () => {
    const product = await Product.create({ name: "Kettle" });

    const media = await product
      .addMedia(UploadedFile.fake("a.png", { content: PNG_4x4 }))
      .toCollection("images");

    expect(media.mimeType).toBe("image/png");
    expect(media.collectionName).toBe("images");
  });

  it("rejects on the sniffed type, not the claimed one", async () => {
    const product = await Product.create({ name: "Kettle" });

    // Claims to be a PNG by filename and Content-Type; the bytes are a PDF.
    const liar = UploadedFile.fake("photo.png", { type: "image/png", content: PDF_BYTES });

    await expect(product.addMedia(liar).toCollection("images")).rejects.toThrow(
      DisallowedMimeTypeError,
    );
  });

  it("enforces maxSize", async () => {
    const product = await Product.create({ name: "Kettle" });
    const big = new Uint8Array(200);
    big.set(PDF_BYTES);

    await expect(product.addMedia(big, "big.pdf").toCollection("docs")).rejects.toThrow(
      FileTooLargeError,
    );
  });
});

// ── Storing and reading ───────────────────────────────────────────────────────

describe("storing", () => {
  it("writes the file under media/<uuid>/ and records the row", async () => {
    const product = await Product.create({ name: "Kettle" });

    const media = await product
      .addMedia(UploadedFile.fake("front.png", { content: PNG_4x4 }))
      .toCollection("images");

    expect(media.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(media.fileName).toBe("original.png");
    expect(media.name).toBe("front");
    expect(media.size).toBe(PNG_4x4.byteLength);
    expect(media.disk).toBe("local");

    disk.assertExists(`media/${media.uuid}/original.png`);
    disk.assertContentType(`media/${media.uuid}/original.png`, "image/png");
  });

  it("uses the uuid in the path, never the sequential id", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    const path = new DefaultPathGenerator().forOriginal(media);
    expect(path).toBe(`media/${media.uuid}`);
    expect(path).not.toContain(`/${String(media.id)}/`);
  });

  it("derives the stored extension from the bytes, not the filename", async () => {
    const product = await Product.create({ name: "Kettle" });

    // A PNG that claims to be a shell script.
    const media = await product.addMedia(PNG_4x4, "payload.sh").toCollection("plain");

    expect(media.fileName).toBe("original.png");
    expect(media.mimeType).toBe("image/png");
  });

  it("carries a custom name and properties onto the row", async () => {
    const product = await Product.create({ name: "Kettle" });

    const media = await product
      .addMedia(PNG_4x4, "a.png")
      .usingName("Front view")
      .withCustomProperties({ alt: "A kettle", credit: "Studio B" })
      .toCollection("plain");

    expect(media.name).toBe("Front view");
    expect(media.getCustomProperty("alt")).toBe("A kettle");
    expect(media.getCustomProperty("missing", "fallback")).toBe("fallback");
  });

  it("round-trips custom properties through the database", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product
      .addMedia(PNG_4x4, "a.png")
      .withCustomProperties({ alt: "A kettle", tags: ["kitchen", "steel"] })
      .toCollection("plain");

    const reloaded = await MediaItem.find(media.id as number);

    expect(reloaded!.getCustomProperty("alt")).toBe("A kettle");
    expect(reloaded!.getCustomProperty("tags")).toEqual(["kitchen", "steel"]);
  });

  it("honours a per-collection disk", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("elsewhere");

    expect(media.disk).toBe("other");
    expect(media.getUrl()).toContain("/other/");
    disk.assertNothingStored();
  });

  it("honours a per-file disk override", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toDisk("other").toCollection("plain");

    expect(media.disk).toBe("other");
  });

  it("reads back through getMedia and getFirstMedia in order", async () => {
    const product = await Product.create({ name: "Kettle" });

    await product.addMedia(PNG_4x4, "one.png").toCollection("plain");
    await product.addMedia(PNG_4x4, "two.png").toCollection("plain");

    const all = await product.getMedia("plain");
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.name)).toEqual(["one", "two"]);
    expect((await product.getFirstMedia("plain"))!.name).toBe("one");
    expect(await product.hasMedia("plain")).toBe(true);
    expect(await product.hasMedia("images")).toBe(false);
  });

  it("keeps one model's media out of another's", async () => {
    const a = await Product.create({ name: "A" });
    const b = await Product.create({ name: "B" });

    await a.addMedia(PNG_4x4, "a.png").toCollection("plain");

    expect(await a.mediaCount("plain")).toBe(1);
    expect(await b.mediaCount("plain")).toBe(0);
  });

  it("copies an item onto another model as an independent file", async () => {
    const source = await Product.create({ name: "Source" });
    const target = await Product.create({ name: "Target" });

    const original = await source
      .addMedia(PNG_4x4, "a.png")
      .withCustomProperties({ alt: "shared" })
      .toCollection("plain");

    const copy = await target.copyMedia(original).toCollection("plain");

    expect(copy.uuid).not.toBe(original.uuid);
    expect(copy.getCustomProperty("alt")).toBe("shared");

    await copy.delete();

    // The source still has its bytes — the two were never sharing a file.
    disk.assertExists(`media/${original.uuid}/original.png`);
  });
});

// ── Fallbacks ─────────────────────────────────────────────────────────────────

describe("fallbacks", () => {
  it("returns the collection's fallback url and path when empty", async () => {
    const product = await Product.create({ name: "Kettle" });

    expect(await product.getFirstMediaUrl("banner")).toBe("/img/placeholder.svg");
    expect(await product.getFirstMediaPath("banner")).toBe("img/placeholder.svg");
  });

  it("returns an empty string when a collection has no fallback", async () => {
    const product = await Product.create({ name: "Kettle" });
    expect(await product.getFirstMediaUrl("plain")).toBe("");
  });

  it("falls back to the original when the conversion is not yet generated", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    const url = await product.getFirstMediaUrl("plain", "thumb");

    expect(url).toBe(media.getUrl());
    expect(url).not.toBe("");
  });
});

// ── Retention ─────────────────────────────────────────────────────────────────

describe("retention", () => {
  it("single keeps only the newest file and deletes the old one's bytes", async () => {
    const product = await Product.create({ name: "Kettle" });

    const first = await product.addMedia(PNG_4x4, "one.png").toCollection("avatar");
    const firstPath = `media/${first.uuid}/original.png`;
    disk.assertExists(firstPath);

    const second = await product.addMedia(PNG_4x4, "two.png").toCollection("avatar");

    expect(await product.mediaCount("avatar")).toBe(1);
    expect((await product.getFirstMedia("avatar"))!.id).toBe(second.id);
    disk.assertMissing(firstPath);
  });

  it("onlyKeepLatest(2) trims to the two newest", async () => {
    const product = await Product.create({ name: "Kettle" });

    await product.addMedia(PNG_4x4, "one.png").toCollection("gallery");
    await product.addMedia(PNG_4x4, "two.png").toCollection("gallery");
    await product.addMedia(PNG_4x4, "three.png").toCollection("gallery");

    const remaining = await product.getMedia("gallery");
    expect(remaining.map((m) => m.name)).toEqual(["two", "three"]);
  });

  it("retention is scoped to one collection", async () => {
    const product = await Product.create({ name: "Kettle" });

    await product.addMedia(PNG_4x4, "keep.png").toCollection("plain");
    await product.addMedia(PNG_4x4, "one.png").toCollection("avatar");
    await product.addMedia(PNG_4x4, "two.png").toCollection("avatar");

    expect(await product.mediaCount("plain")).toBe(1);
    expect(await product.mediaCount("avatar")).toBe(1);
  });
});

// ── Conversions ───────────────────────────────────────────────────────────────

describe("conversions", () => {
  it("generates a declared conversion inline and records it", async () => {
    const product = await Product.create({ name: "Kettle" });

    const media = await product
      .addMedia(UploadedFile.fake("a.png", { content: PNG_4x4 }))
      .toCollection("images");

    expect(media.hasConversion("thumb")).toBe(true);

    const generated = media.conversion("thumb")!;
    expect(generated.fileName).toBe("thumb.webp");
    expect(generated.mimeType).toBe("image/webp");
    expect(generated.width).toBeLessThanOrEqual(2);
    expect(generated.size).toBeGreaterThan(0);

    disk.assertExists(`media/${media.uuid}/conversions/thumb.webp`);
    disk.assertContentType(`media/${media.uuid}/conversions/thumb.webp`, "image/webp");
  });

  it("survives a reload — generated_conversions round-trips as json", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    const reloaded = await MediaItem.find(media.id as number);

    expect(reloaded!.hasConversion("thumb")).toBe(true);
    expect(reloaded!.conversion("thumb")!.fileName).toBe("thumb.webp");
  });

  it("getUrl(conversion) points at the conversion, and '' when absent", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    expect(media.getUrl("thumb")).toContain(`media/${media.uuid}/conversions/thumb.webp`);
    expect(media.getUrl("nope")).toBe("");
    expect(media.getPath("nope")).toBe("");
  });

  it("does not attempt conversions for a non-image", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PDF_BYTES, "a.pdf").toCollection("docs");

    expect(media.conversionNames()).toEqual([]);
  });

  it("skips conversion when the file exceeds maxConversionInputSize", async () => {
    setMediaState({
      config: { ...mediaDefaults(), disk: "local", maxConversionInputSize: 4 },
      driver: new BunImageDriver(),
    });

    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    expect(media.hasConversion("thumb")).toBe(false);
    // The original is still stored — too big to thumbnail is not too big to keep.
    disk.assertExists(`media/${media.uuid}/original.png`);
  });

  it("one failing conversion loses neither the others nor the upload", async () => {
    // A driver that fails one specific conversion. Previously this test used
    // `fit: "cover"` as its guaranteed failure, which the default driver now
    // handles — so the failure is injected rather than borrowed from a gap.
    const base = new BunImageDriver();
    const driver: ImageDriver = {
      name: base.name,
      supportsCrop: base.supportsCrop,
      metadata: (bytes) => base.metadata(bytes),
      placeholder: (bytes) => base.placeholder(bytes),
      canEncode: (format) => base.canEncode(format),
      convert: (bytes, manipulation) => {
        if (manipulation.width === 3) throw new Error("codec exploded");
        return base.convert(bytes, manipulation);
      },
    };

    const runner = new ConversionRunner(driver, { ...mediaDefaults(), disk: "local" });
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    const { generated, failed } = await runner.run(media, {
      ok: { width: 2, format: "webp" },
      broken: { width: 3, format: "webp" },
    });

    expect(generated).toEqual(["ok"]);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.name).toBe("broken");
    expect(failed[0]!.reason).toContain("codec exploded");
    disk.assertExists(`media/${media.uuid}/original.png`);
  });
});

// ── The default driver ────────────────────────────────────────────────────────

describe("BunImageDriver", () => {
  it('crops for fit: "cover" without sharp installed', async () => {
    const driver = new BunImageDriver();
    const result = await driver.convert(PNG_WIDE, {
      width: 50,
      height: 50,
      fit: "cover",
      format: "webp",
    });

    expect([result.width, result.height]).toEqual([50, 50]);
    expect(result.mimeType).toBe("image/webp");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  it("declares that it can crop", () => {
    expect(new BunImageDriver().supportsCrop).toBe(true);
  });

  it("passes allowEnlargement from the collection through to the driver", async () => {
    const runner = new ConversionRunner(new BunImageDriver(), {
      ...mediaDefaults(),
      disk: "local",
    });
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    const { generated } = await runner.run(media, {
      // The 4px source cannot fill a 32px box without being scaled up.
      capped: { width: 32, height: 32, fit: "cover", format: "png" },
      stretched: { width: 32, height: 32, fit: "cover", format: "png", allowEnlargement: true },
    });

    expect(generated.sort()).toEqual(["capped", "stretched"]);
    expect(media.generatedConversions!["capped"]).toMatchObject({ width: 4, height: 4 });
    expect(media.generatedConversions!["stretched"]).toMatchObject({ width: 32, height: 32 });
  });

  it("resizes with inside and never upscales by default", async () => {
    const result = await new BunImageDriver().convert(PNG_4x4, { width: 500, format: "png" });

    // The 4px source is left alone rather than blown up to 500px.
    expect(result.width).toBeLessThanOrEqual(4);
  });

  it("reads metadata, returning null for bytes that are not an image", async () => {
    const driver = new BunImageDriver();

    expect(await driver.metadata(PNG_4x4)).toEqual({ width: 4, height: 4, format: "png" });
    expect(await driver.metadata(PDF_BYTES)).toBeNull();
  });

  it("produces an inline placeholder data url", async () => {
    expect(await new BunImageDriver().placeholder(PNG_4x4)).toMatch(/^data:image\/png;base64,/);
  });

  it("reports jpeg, png and webp as encodable on every host", async () => {
    const driver = new BunImageDriver();

    expect(await driver.canEncode("jpeg")).toBe(true);
    expect(await driver.canEncode("png")).toBe(true);
    expect(await driver.canEncode("webp")).toBe(true);
  });
});

// ── Responsive images ─────────────────────────────────────────────────────────

describe("responsive images", () => {
  it("generates a width ladder, a srcset and a placeholder", async () => {
    const runner = new ConversionRunner(new BunImageDriver(), {
      ...mediaDefaults(),
      disk: "local",
    });
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_WIDE, "wide.png").toCollection("plain");

    const set = await runner.runResponsive(media, [100, 320, 5000]);

    expect(set).not.toBeNull();
    // 5000 is wider than the 400px source, so it is skipped rather than upscaled.
    expect(set!.images.map((i) => i.width)).toEqual([100, 320]);
    expect(set!.placeholder).toMatch(/^data:image/);

    const srcset = media.srcset();
    expect(srcset).toContain("100w");
    expect(srcset).toContain("320w");
    expect(media.placeholder).toMatch(/^data:image/);
    expect(media.getResponsivePath(320)).toContain("responsive/320.png");
  });

  it("returns an empty srcset when nothing was generated", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    expect(media.srcset()).toBe("");
    expect(media.placeholder).toBeNull();
    expect(media.getResponsivePath(320)).toBe("");
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("ordering", () => {
  it("assigns increasing order and reorders on demand", async () => {
    const product = await Product.create({ name: "Kettle" });

    const a = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");
    const b = await product.addMedia(PNG_4x4, "b.png").toCollection("plain");
    const c = await product.addMedia(PNG_4x4, "c.png").toCollection("plain");

    expect([a.orderColumn, b.orderColumn, c.orderColumn]).toEqual([0, 1, 2]);

    await product.setMediaOrder([c.id as number, a.id as number], "plain");

    const reordered = await product.getMedia("plain");
    expect(reordered.map((m) => m.name)).toEqual(["c", "a", "b"]);
  });
});

// ── Deleting ──────────────────────────────────────────────────────────────────

describe("deleting", () => {
  it("removes the original and every conversion with the row", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    const original = `media/${media.uuid}/original.png`;
    const thumb = `media/${media.uuid}/conversions/thumb.webp`;
    disk.assertExists(original);
    disk.assertExists(thumb);

    await media.delete();

    disk.assertMissing(original);
    disk.assertMissing(thumb);
    expect(await MediaItem.find(media.id as number)).toBeNull();
  });

  it("clearMediaCollection empties one collection and leaves the rest", async () => {
    const product = await Product.create({ name: "Kettle" });

    await product.addMedia(PNG_4x4, "a.png").toCollection("plain");
    await product.addMedia(PNG_4x4, "b.png").toCollection("images");

    const removed = await product.clearMediaCollection("plain");

    expect(removed).toBe(1);
    expect(await product.mediaCount("plain")).toBe(0);
    expect(await product.mediaCount("images")).toBe(1);
  });

  it("deleting the model cascades to its files", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");
    const path = `media/${media.uuid}/original.png`;

    await product.delete();

    disk.assertMissing(path);
    expect(await MediaItem.query().where("model_type", "Product").get()).toHaveLength(0);
  });

  it("deleting a media row whose file is already gone still succeeds", async () => {
    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("plain");

    disk.clear();

    await media.delete();
    expect(await MediaItem.find(media.id as number)).toBeNull();
  });
});

// ── Queue integration ─────────────────────────────────────────────────────────

describe("queued conversions", () => {
  it("runs everything inline when no queue is bound", () => {
    setConversionDispatcher(null);
    expect(isQueueAvailable()).toBe(false);

    const { inline, queued } = partitionConversions(
      { a: { width: 10 }, b: { width: 10, queued: true } },
      false,
    );

    expect(Object.keys(inline).sort()).toEqual(["a", "b"]);
    expect(Object.keys(queued)).toEqual([]);
  });

  it("defers the queued ones when a dispatcher is installed", () => {
    setConversionDispatcher(async () => {});
    expect(isQueueAvailable()).toBe(true);

    const { inline, queued } = partitionConversions(
      { a: { width: 10 }, b: { width: 10, queued: true } },
      true,
    );

    expect(Object.keys(inline)).toEqual(["a"]);
    expect(Object.keys(queued)).toEqual(["b"]);
  });

  it("hands queued conversion names to the dispatcher instead of running them", async () => {
    const seen: Array<{ id: number; names: string[] }> = [];
    setConversionDispatcher(async (id, names) => {
      seen.push({ id, names });
    });

    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("deferred");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.names).toEqual(["later"]);
    expect(seen[0]!.id).toBe(media.id as number);
    expect(media.hasConversion("later")).toBe(false);
  });

  it("runs a queued conversion inline when no dispatcher exists", async () => {
    setConversionDispatcher(null);

    const product = await Product.create({ name: "Kettle" });
    const media = await product.addMedia(PNG_4x4, "a.png").toCollection("deferred");

    expect(media.hasConversion("later")).toBe(true);
  });
});

// ── Test helpers ──────────────────────────────────────────────────────────────

describe("MediaFake", () => {
  it("asserts presence, absence, count and conversions", async () => {
    const product = await Product.create({ name: "Kettle" });
    await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    await MediaFake.assertHas(product, "images");
    await MediaFake.assertCount(product, "images", 1);
    await MediaFake.assertMissing(product, "plain");
    await MediaFake.assertConversion(product, "images", "thumb");
  });

  it("explains what it found when an assertion fails", async () => {
    const product = await Product.create({ name: "Kettle" });
    await product.addMedia(PNG_4x4, "a.png").toCollection("images");

    await expect(MediaFake.assertHas(product, "plain")).rejects.toThrow(/has none/);
    await expect(MediaFake.assertCount(product, "images", 3)).rejects.toThrow(/found 1/);
    await expect(MediaFake.assertMissing(product, "images")).rejects.toThrow(/holds 1/);
  });
});
