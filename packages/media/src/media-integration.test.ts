import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
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

import { MediaItem, setPathGenerator } from "./MediaItem.ts";
import { Media } from "./Media.ts";
import { MediaManager } from "./MediaManager.ts";
import { BunImageDriver } from "./conversions/BunImageDriver.ts";
import { performConversions, ownerClassFor } from "./conversions/queueBridge.ts";
import { setConversionDispatcher } from "./conversions/dispatch.ts";
import { mediaSchemaConcern } from "./mediaSchemaConcern.ts";
import { mediaDefaults } from "./config.ts";
import { setMediaState, resetMediaState } from "./state.ts";
import { DefaultPathGenerator, type PathGenerator } from "./paths/PathGenerator.ts";
import { setDiskResolver, setDefaultDiskName } from "./support/disks.ts";
import { fromDisk, fromPath, fromUrl } from "./sources.ts";
import { MediaError } from "./errors.ts";
import type { MediaCollections } from "./types.ts";

const PNG_4x4 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8z8AARIQBEwOZYFQj" +
      "AJ9gARL5lTPCAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

@(table("articles").withTimestamps())
class Article extends Model.using(Media) {
  @column() title!: string;

  static override fillable = ["title"];

  static override mediaCollections: MediaCollections = {
    images: { conversions: { thumb: { width: 2, format: "webp" } } },
    plain: {},
  };
}

let storage: StorageManager;
let disk: FakeDisk;
let manager: MediaManager;

beforeAll(async () => {
  const db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);

  await Schema.create("articles", (t) => {
    t.increments("id");
    t.string("title");
    t.timestamp("created_at").nullable();
    t.timestamp("updated_at").nullable();
  });

  // The concern is the thing that provisions `media`, and it is also under test
  // here — so build the table up front rather than letting the rest of the file
  // depend on the concern's own tests having run first.
  await mediaSchemaConcern.run!(concernContext());
});

/** A ConcernContext whose config returns `overrides`, else the caller's fallback. */
function concernContext(overrides: Record<string, unknown> = {}) {
  return {
    resolve: () => ({
      get: <T>(path: string, fallback?: T): T | undefined =>
        (overrides[path] as T | undefined) ?? fallback,
    }),
  } as never;
}

beforeEach(() => {
  storage = new StorageManager({
    default: "local",
    disks: { local: { driver: "local", root: "storage/app", url: "/storage" } },
  });
  disk = storage.fake("local");
  setDiskResolver((name) => storage.disk(name));
  setDefaultDiskName("local");
  setMediaState({ config: { ...mediaDefaults(), disk: "local" }, driver: new BunImageDriver() });
  manager = new MediaManager({ ...mediaDefaults(), disk: "local" }, new BunImageDriver());
});

afterEach(async () => {
  storage.restoreFakes();
  setDiskResolver(null);
  setDefaultDiskName(null);
  resetMediaState();
  setConversionDispatcher(null);
  setPathGenerator(new DefaultPathGenerator());
  if (await Schema.hasTable("media")) {
    await MediaItem.query().delete();
    await Article.query().delete();
  }
});

// ── Schema provisioning ───────────────────────────────────────────────────────

describe("mediaSchemaConcern", () => {
  const ctx = concernContext;

  it("creates the media table when it is missing", async () => {
    await Schema.dropIfExists("media");
    expect(await Schema.hasTable("media")).toBe(false);

    await mediaSchemaConcern.run!(ctx());

    expect(await Schema.hasTable("media")).toBe(true);
  });

  it("is idempotent — a second run leaves existing rows alone", async () => {
    const article = await Article.create({ title: "Hello" });
    await article.addMedia(PNG_4x4, "a.png").toCollection("plain");

    await mediaSchemaConcern.run!(ctx());

    expect(await MediaItem.query().get()).toHaveLength(1);
  });

  it("does nothing when autoCreateTable is off", async () => {
    await Schema.dropIfExists("media");

    await mediaSchemaConcern.run!(ctx({ "media.autoCreateTable": false }));

    expect(await Schema.hasTable("media")).toBe(false);

    // Restore for the rest of the file.
    await mediaSchemaConcern.run!(ctx());
    expect(await Schema.hasTable("media")).toBe(true);
  });

  it("never throws when there is no database", async () => {
    const broken = {
      resolve: () => {
        throw new Error("no container");
      },
    } as never;

    expect(mediaSchemaConcern.run!(broken)).resolves.toBeUndefined();
  });
});

// ── Alternate sources ─────────────────────────────────────────────────────────

describe("sources", () => {
  it("addMediaFromDisk reads a file already on a disk", async () => {
    await disk.put("incoming/photo.png", PNG_4x4, { contentType: "image/png" });

    const article = await Article.create({ title: "Hello" });
    const media = await article.addMediaFromDisk("incoming/photo.png").toCollection("plain");

    expect(media.name).toBe("photo");
    expect(media.mimeType).toBe("image/png");
    disk.assertExists(`media/${media.uuid}/original.png`);
    // The source is left where it was — copying, not moving.
    disk.assertExists("incoming/photo.png");
  });

  it("addMediaFromDisk fails clearly when the file is not there", async () => {
    const article = await Article.create({ title: "Hello" });

    await expect(article.addMediaFromDisk("nope.png").toCollection("plain")).rejects.toThrow(
      /No file at "nope.png"/,
    );
  });

  it("addMediaFromPath reads from the local filesystem", async () => {
    // Written outside the repo so a test run never leaves the tree dirty.
    const path = `${tmpdir()}/zerotal-media-${crypto.randomUUID()}.png`;
    await Bun.write(path, PNG_4x4);

    try {
      const article = await Article.create({ title: "Hello" });
      const media = await article.addMediaFromPath(path).toCollection("plain");

      expect(media.name).toContain("zerotal-media-");
      expect(media.size).toBe(PNG_4x4.byteLength);
      expect(media.mimeType).toBe("image/png");
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("fromPath rejects a missing file", async () => {
    await expect(fromPath("does/not/exist.png")()).rejects.toThrow(MediaError);
  });

  it("fromUrl refuses a non-http scheme", async () => {
    await expect(fromUrl("file:///etc/passwd", 1000)()).rejects.toThrow(/supports http and https/);
  });

  it("fromUrl refuses a relative url", async () => {
    await expect(fromUrl("/local/path.png", 1000)()).rejects.toThrow(/absolute URL/);
  });

  it("fromDisk names the file after the last path segment", async () => {
    await disk.put("a/b/c/deep.png", PNG_4x4);
    const resolved = await fromDisk("a/b/c/deep.png")();

    expect(resolved.originalName).toBe("deep.png");
    expect(resolved.bytes.byteLength).toBe(PNG_4x4.byteLength);
  });
});

// ── Path generators ───────────────────────────────────────────────────────────

describe("path generators", () => {
  it("a custom generator changes where files land", async () => {
    const flat: PathGenerator = {
      forOriginal: (media) => `uploads/${media.collectionName}`,
      forConversions: (media) => `uploads/${media.collectionName}/c`,
      forResponsiveImages: (media) => `uploads/${media.collectionName}/r`,
    };
    setPathGenerator(flat);

    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    disk.assertExists("uploads/images/original.png");
    disk.assertExists("uploads/images/c/thumb.webp");
    expect(media.getUrl()).toContain("uploads/images/original.png");
  });
});

// ── MediaManager ──────────────────────────────────────────────────────────────

describe("MediaManager.regenerate", () => {
  it("rebuilds a conversion after its definition changes", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    const before = media.conversion("thumb")!;
    expect(before.mimeType).toBe("image/webp");

    Article.mediaCollections["images"] = {
      conversions: { thumb: { width: 3, format: "png" } },
    };

    try {
      const generated = await manager.regenerate(media, Article);

      expect(generated).toEqual(["thumb"]);
      expect(media.conversion("thumb")!.mimeType).toBe("image/png");
      disk.assertExists(`media/${media.uuid}/conversions/thumb.png`);
    } finally {
      Article.mediaCollections["images"] = {
        conversions: { thumb: { width: 2, format: "webp" } },
      };
    }
  });

  it("honours an `only` filter", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    expect(await manager.regenerate(media, Article, ["nothing-by-this-name"])).toEqual([]);
    expect(await manager.regenerate(media, Article, ["thumb"])).toEqual(["thumb"]);
  });
});

describe("MediaManager.clean", () => {
  it("reports rows whose file has gone, without deleting by default", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("plain");

    disk.clear();

    const report = await manager.clean();

    expect(report.orphanedRows).toEqual([Number(media.id)]);
    expect(report.deletedRows).toEqual([]);
    expect(await MediaItem.find(media.id as number)).not.toBeNull();
  });

  it("deletes them when dryRun is off", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("plain");

    disk.clear();

    const report = await manager.clean({ dryRun: false });

    expect(report.deletedRows).toEqual([Number(media.id)]);
    expect(await MediaItem.find(media.id as number)).toBeNull();
  });

  it("reports a conversion whose file went missing but keeps the row", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    await storage.disk("local").delete(`media/${media.uuid}/conversions/thumb.webp`);

    const report = await manager.clean();

    expect(report.orphanedRows).toEqual([]);
    expect(report.danglingConversions).toEqual([
      { mediaId: Number(media.id), conversion: "thumb" },
    ]);
  });

  it("is quiet when everything is in order", async () => {
    const article = await Article.create({ title: "Hello" });
    await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    const report = await manager.clean();

    expect(report.orphanedRows).toEqual([]);
    expect(report.danglingConversions).toEqual([]);
  });
});

// ── Queue bridge ──────────────────────────────────────────────────────────────

describe("queue bridge", () => {
  it("resolves a registered model class by its model_type", () => {
    expect(ownerClassFor("Article")).toBe(Article as never);
    expect(ownerClassFor("NeverRegistered")).toBeNull();
  });

  it("performConversions generates the named conversions for a row", async () => {
    setConversionDispatcher(async () => {});

    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    // Wipe what the inline pass produced so the queued path has work to do.
    media.generatedConversions = {};
    await media.save();

    const { generated } = await performConversions(Number(media.id), ["thumb"]);

    expect(generated).toEqual(["thumb"]);
    expect((await MediaItem.find(media.id as number))!.hasConversion("thumb")).toBe(true);
  });

  it("is a no-op for a media row that no longer exists", async () => {
    const result = await performConversions(999_999, ["thumb"]);
    expect(result).toEqual({ generated: [], failed: [] });
  });

  it("is a no-op when the owning model type is gone", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    media.modelType = "DeletedModel";
    await media.save();

    expect(await performConversions(Number(media.id), ["thumb"])).toEqual({
      generated: [],
      failed: [],
    });
  });
});

// ── Temporary URLs ────────────────────────────────────────────────────────────

describe("temporary urls", () => {
  it("signs a link to the original and to a conversion", async () => {
    const article = await Article.create({ title: "Hello" });
    const media = await article.addMedia(PNG_4x4, "a.png").toCollection("images");

    expect(await media.getTemporaryUrl(60)).toContain("expires=");
    expect(await media.getTemporaryUrl(60, "thumb")).toContain("expires=");
    expect(await media.getTemporaryUrl(60, "missing")).toBe("");
  });
});
