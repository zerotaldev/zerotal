/**
 * Media with no disk configured, in an app with the built-in storage config.
 *
 * Up to 1.18.0 an item went to `storage.default`, which is the private `local`
 * disk: no `serve` block, no URL base. `getUrl()` came back as
 * `/media/<uuid>/original.png`, a path nothing answers, so every media link in a
 * new app 404ed until somebody wrote a `config/media.ts`. The row also recorded
 * its disk as `""`, because the default was read from config the app never wrote.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@zerotal/core";
import { StorageProvider, StorageConfig } from "@zerotal/core/storage";
import {
  Model,
  Schema,
  column,
  table,
  _setBaseModelConnection,
  _setDbConnection,
} from "@zerotal/orm";
import { Media } from "./Media.ts";
import { MediaItem } from "./MediaItem.ts";
import { BunImageDriver } from "./conversions/BunImageDriver.ts";
import { mediaDefaults } from "./config.ts";
import { setMediaState, resetMediaState } from "./state.ts";
import { mediaSchemaConcern } from "./mediaSchemaConcern.ts";
import type { MediaCollections } from "./types.ts";

const PNG_4x4 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8z8AARIQBEwOZYFQj" +
      "AJ9gARL5lTPCAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

@(table("albums").withTimestamps())
class Album extends Model.using(Media) {
  @column() title!: string;

  static override fillable = ["title"];

  static override mediaCollections: MediaCollections = {
    covers: {},
    private: { disk: "local" },
  };
}

let root: string;
let previousRoot: string | undefined;
let app: Application;
let base: string;

beforeAll(async () => {
  previousRoot = Bun.env["ZT_STORAGE_ROOT"];
  root = await mkdtemp(join(tmpdir(), "zt-media-default-disk-"));
  Bun.env["ZT_STORAGE_ROOT"] = root;

  // The app a new project has: StorageProvider and no config/storage.ts or config/media.ts.
  Application._resetInstance();
  app = Application.create({ env: "web", providers: [StorageProvider] });
  await app.start(0);
  const server = Reflect.get(app, "_static") as { port: number } | undefined;
  base = `http://localhost:${server?.port}`;

  await useDatabase();
  setMediaState({ config: mediaDefaults(), driver: new BunImageDriver() });
});

/** A fresh in-memory database for the current app, with the tables these tests write. */
async function useDatabase(): Promise<void> {
  const db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);
  await Schema.create("albums", (t) => {
    t.increments("id");
    t.string("title");
    t.timestamp("created_at").nullable();
    t.timestamp("updated_at").nullable();
  });
  await mediaSchemaConcern.run!({
    resolve: () => ({ get: <T>(_path: string, fallback?: T) => fallback }),
  } as never);
}

afterEach(async () => {
  await MediaItem.query().delete();
  await Album.query().delete();
});

afterAll(async () => {
  resetMediaState();
  await app?.close();
  Application._resetInstance();
  if (previousRoot === undefined) delete Bun.env["ZT_STORAGE_ROOT"];
  else Bun.env["ZT_STORAGE_ROOT"] = previousRoot;
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("media with no disk configured", () => {
  it("serves what it stores: getUrl() answers 200 with the file", async () => {
    const album = await Album.create({ title: "Summer" });
    const media = await album.addMedia(new File([PNG_4x4], "a.png")).toCollection("covers");

    const url = media.getUrl();
    expect(url).toStartWith("/storage/public/media/");

    const res = await fetch(`${base}${url}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_4x4);
  });

  it("records the disk it wrote to by name", async () => {
    const album = await Album.create({ title: "Winter" });
    const media = await album.addMedia(new File([PNG_4x4], "a.png")).toCollection("covers");

    expect(media.disk).toBe("public");
    expect(await media.fileExists()).toBe(true);
  });

  it("still writes to a disk a collection names, served or not", async () => {
    const album = await Album.create({ title: "Receipts" });
    const media = await album.addMedia(new File([PNG_4x4], "a.png")).toCollection("private");

    expect(media.disk).toBe("local");
    expect(await media.fileExists()).toBe(true);
  });

  it("keeps the storage default when that disk has a URL of its own", async () => {
    await app.close();
    Application._resetInstance();
    app = Application.create({
      env: "test",
      providers: [StorageProvider],
      config: {
        storage: StorageConfig({
          default: "assets",
          disks: { assets: { driver: "local", root: join(root, "public", "assets"), url: "/a" } },
        }),
      },
    });
    await app.boot();
    await useDatabase();

    const album = await Album.create({ title: "CDN" });
    const media = await album.addMedia(new File([PNG_4x4], "a.png")).toCollection("covers");

    expect(media.disk).toBe("assets");
    expect(media.getUrl()).toStartWith("/a/media/");
  });
});
