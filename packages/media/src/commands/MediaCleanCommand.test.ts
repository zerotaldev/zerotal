/**
 * `media:clean` deletes rows, and a wrong prune is not recoverable — the file is
 * already gone, and the row that recorded where it lived goes with it. So the
 * behaviour under test is mostly what the command *refuses* to do: delete
 * without `--force`, and delete anything whose file is still present.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
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

import { Application } from "@zerotal/core";

import { MediaCleanCommand } from "./MediaCleanCommand.ts";
import { MediaItem, setPathGenerator } from "../MediaItem.ts";
import { Media } from "../Media.ts";
import { MediaManager } from "../MediaManager.ts";
import { BunImageDriver } from "../conversions/BunImageDriver.ts";
import { mediaSchemaConcern } from "../mediaSchemaConcern.ts";
import { mediaDefaults } from "../config.ts";
import { setMediaState, resetMediaState } from "../state.ts";
import { DefaultPathGenerator } from "../paths/PathGenerator.ts";
import { setDiskResolver, setDefaultDiskName } from "../support/disks.ts";
import type { MediaCollections } from "../types.ts";

const PNG_4x4 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8z8AARIQBEwOZYFQj" +
      "AJ9gARL5lTPCAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

@(table("posts").withTimestamps())
class Post extends Model.using(Media) {
  @column() title!: string;

  static override fillable = ["title"];

  static override mediaCollections: MediaCollections = {
    images: { conversions: { thumb: { width: 2, format: "webp" } } },
    plain: {},
  };
}

/** Captures whatever the command writes, so assertions can read it back. */
class Collector {
  out = "";
  write(text: string): void {
    this.out += text;
  }
  writeLine(text: string): void {
    this.out += `${text}\n`;
  }
  writeError(text: string): void {
    this.out += `${text}\n`;
  }
}

let storage: StorageManager;
let disk: FakeDisk;
let db: SQL;

/** A command wired to a collecting writer, with `--force` optional. */
function makeCommand(force = false): { command: MediaCleanCommand; output: Collector } {
  const command = new MediaCleanCommand();
  const output = new Collector();
  (command as unknown as { _writer: Collector })._writer = output;
  command.flags = { force };
  return { command, output };
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);

  await Schema.create("posts", (t) => {
    t.increments("id");
    t.string("title");
    t.timestamp("created_at").nullable();
    t.timestamp("updated_at").nullable();
  });

  await mediaSchemaConcern.run!({
    resolve: () => ({ get: <T>(_path: string, fallback?: T): T | undefined => fallback }),
  } as never);
});

beforeEach(async () => {
  storage = new StorageManager({
    default: "local",
    disks: { local: { driver: "local", root: "storage/app", url: "/storage" } },
  });
  disk = storage.fake("local");
  setDiskResolver((name) => storage.disk(name));
  setDefaultDiskName("local");

  const config = { ...mediaDefaults(), disk: "local" };
  setMediaState({ config, driver: new BunImageDriver() });

  // The command reaches the manager through the `MediaLibrary` facade, which
  // resolves from the container — so the container is what has to exist, not a
  // stubbed facade. Booting a real app is also the only way the safety default
  // is exercised through the same path production uses.
  Application._resetInstance();
  const app = Application.create({ env: "test" });
  await app.boot();
  // `value`, not `singleton`: the facade resolves through `makeSync`, which can
  // only return a binding that is already built. MediaProvider gets there by
  // pre-resolving its singleton in onBooted; binding the instance directly is
  // the same end state without standing up the provider.
  app.container.value("media", new MediaManager(config, new BunImageDriver()));

  // Booting swaps in a fresh container, and the ORM resolves its connection
  // through that — so the in-memory database has to be re-attached after, not
  // only once in beforeAll.
  _setBaseModelConnection(db);
  _setDbConnection(db);
});

afterEach(async () => {
  storage.restoreFakes();
  setDiskResolver(null);
  setDefaultDiskName(null);
  resetMediaState();
  setPathGenerator(new DefaultPathGenerator());
  if (await Schema.hasTable("media")) {
    await MediaItem.query().delete();
    await Post.query().delete();
  }
  Application._resetInstance();
});

describe("media:clean", () => {
  it("is registered under a name that says what it does", () => {
    expect(MediaCleanCommand.commandName).toBe("media:clean");
    expect(MediaCleanCommand.needsApp).toBe(true);
  });

  it("defaults --force to false, so the destructive path is never the accidental one", () => {
    const force = MediaCleanCommand.flags.find((flag) => flag.name === "force");
    expect(force).toBeDefined();
    expect(force!.type).toBe("boolean");
    expect(force!.default).toBe(false);
  });

  it("reports an orphaned row without deleting it", async () => {
    const post = await Post.create({ title: "Hello" });
    const media = await post.addMedia(PNG_4x4, "a.png").toCollection("plain");
    disk.clear();

    const { command, output } = makeCommand();
    await command.run();

    expect(output.out).toContain("1 media row(s) point at a file that is gone");
    expect(output.out).toContain("Re-run with --force");
    // The row survives: reporting is not deleting.
    expect(await MediaItem.find(media.id as number)).not.toBeNull();
  });

  it("deletes only with --force, and says how many", async () => {
    const post = await Post.create({ title: "Hello" });
    const media = await post.addMedia(PNG_4x4, "a.png").toCollection("plain");
    disk.clear();

    const { command, output } = makeCommand(true);
    await command.run();

    expect(output.out).toContain("Deleted 1 row(s)");
    expect(await MediaItem.find(media.id as number)).toBeNull();
  });

  it("never deletes a row whose file is present, even with --force", async () => {
    // The unrecoverable mistake this command could make. Two intact rows and one
    // orphan: only the orphan may go.
    const post = await Post.create({ title: "Hello" });
    const intact = await post.addMedia(PNG_4x4, "keep.png").toCollection("plain");
    const alsoIntact = await post.addMedia(PNG_4x4, "keep-too.png").toCollection("plain");
    const orphan = await post.addMedia(PNG_4x4, "gone.png").toCollection("plain");

    await storage.disk("local").delete(orphan.getPath());

    const { command, output } = makeCommand(true);
    await command.run();

    expect(output.out).toContain("Deleted 1 row(s)");
    expect(await MediaItem.find(intact.id as number)).not.toBeNull();
    expect(await MediaItem.find(alsoIntact.id as number)).not.toBeNull();
    expect(await MediaItem.find(orphan.id as number)).toBeNull();
    // And the surviving files are still on the disk.
    disk.assertExists(intact.getPath());
    disk.assertExists(alsoIntact.getPath());
  });

  it("does not delete a row just because one conversion is missing", async () => {
    // A dangling conversion is regenerable; the original is not. Deleting the
    // row here would throw away a good file to fix a derived one.
    const post = await Post.create({ title: "Hello" });
    const media = await post.addMedia(PNG_4x4, "a.png").toCollection("images");

    await storage.disk("local").delete(`media/${media.uuid}/conversions/thumb.webp`);

    const { command, output } = makeCommand(true);
    await command.run();

    expect(output.out).toContain("1 recorded conversion(s) are missing their file");
    expect(output.out).toContain("media:regenerate");
    expect(output.out).toContain("Deleted 0 row(s)");
    expect(await MediaItem.find(media.id as number)).not.toBeNull();
    disk.assertExists(media.getPath());
  });

  it("says so plainly when there is nothing to do", async () => {
    const post = await Post.create({ title: "Hello" });
    await post.addMedia(PNG_4x4, "a.png").toCollection("images");

    const { command, output } = makeCommand();
    await command.run();

    expect(output.out).toContain("Every media row has its file");
    expect(output.out).not.toContain("Deleted");
  });

  it("is a no-op on an empty library", async () => {
    const { command, output } = makeCommand(true);
    await command.run();

    expect(output.out).toContain("Every media row has its file");
  });

  it("names the orphaned rows, so the report can be acted on", async () => {
    const post = await Post.create({ title: "Hello" });
    const first = await post.addMedia(PNG_4x4, "a.png").toCollection("plain");
    const second = await post.addMedia(PNG_4x4, "b.png").toCollection("plain");
    disk.clear();

    const { command, output } = makeCommand();
    await command.run();

    expect(output.out).toContain("2 media row(s)");
    expect(output.out).toContain(String(first.id));
    expect(output.out).toContain(String(second.id));
  });
});
