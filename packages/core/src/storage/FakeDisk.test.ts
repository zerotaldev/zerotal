import { describe, it, expect, beforeEach } from "bun:test";
import { FakeDisk } from "./FakeDisk.ts";

// Local disks must live inside the storage root; pin it for this suite so the
// value does not depend on which test file the worker loaded first.
Bun.env["ZT_STORAGE_ROOT"] = "storage";
import { StorageManager } from "./StorageManager.ts";

let disk: FakeDisk;

beforeEach(() => {
  disk = new FakeDisk();
});

describe("FakeDisk — driver behaviour", () => {
  it("stores and reads text", async () => {
    await disk.put("notes/a.txt", "hello");

    expect(await disk.get("notes/a.txt")).toBe("hello");
    expect(await disk.exists("notes/a.txt")).toBe(true);
    expect(await disk.size("notes/a.txt")).toBe(5);
  });

  it("stores and reads bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await disk.put("bin/x", bytes);

    expect(await disk.getBuffer("bin/x")).toEqual(bytes);
  });

  it("returns null for a missing file rather than throwing", async () => {
    expect(await disk.get("nope")).toBeNull();
    expect(await disk.getBuffer("nope")).toBeNull();
    expect(await disk.size("nope")).toBeNull();
    expect(await disk.lastModified("nope")).toBeNull();
  });

  it("treats a leading slash as the same path", async () => {
    await disk.put("/a.txt", "x");
    expect(await disk.exists("a.txt")).toBe(true);
  });

  it("deletes, copies, and moves", async () => {
    await disk.put("a.txt", "one");

    await disk.copy("a.txt", "b.txt");
    expect(await disk.get("b.txt")).toBe("one");

    await disk.move("b.txt", "c.txt");
    expect(await disk.exists("b.txt")).toBe(false);
    expect(await disk.get("c.txt")).toBe("one");

    await disk.delete("a.txt");
    expect(await disk.exists("a.txt")).toBe(false);
  });

  it("refuses to copy a file that is not there", async () => {
    await expect(disk.copy("ghost", "b")).rejects.toThrow("ghost");
  });

  it("builds urls and temporary urls", async () => {
    expect(disk.url("a/b.png")).toBe("/storage/a/b.png");
    expect(await disk.temporaryUrl("a/b.png", 60)).toContain("expires=");
  });
});

describe("FakeDisk — assertions", () => {
  it("assertExists passes for a stored file and can check contents", async () => {
    await disk.put("a.txt", "hello");

    expect(() => disk.assertExists("a.txt")).not.toThrow();
    expect(() => disk.assertExists("a.txt", "hello")).not.toThrow();
    expect(() => disk.assertExists("a.txt", "goodbye")).toThrow("contents differ");
  });

  it("assertExists lists what is on the disk when the file is absent", async () => {
    await disk.put("other.txt", "x");
    expect(() => disk.assertExists("a.txt")).toThrow("other.txt");
  });

  it("assertMissing is the inverse", async () => {
    expect(() => disk.assertMissing("a.txt")).not.toThrow();
    await disk.put("a.txt", "x");
    expect(() => disk.assertMissing("a.txt")).toThrow("a.txt");
  });

  it("assertExistsMatching handles generated filenames", async () => {
    await disk.put(`avatars/${crypto.randomUUID()}.png`, "x");

    expect(() => disk.assertExistsMatching(/^avatars\/[0-9a-f-]+\.png$/)).not.toThrow();
    expect(() => disk.assertExistsMatching(/^docs\//)).toThrow("no stored path matched");
  });

  it("assertContentType checks how the file was stored", async () => {
    await disk.put("a.png", "x", { contentType: "image/png" });

    expect(() => disk.assertContentType("a.png", "image/png")).not.toThrow();
    expect(() => disk.assertContentType("a.png", "image/jpeg")).toThrow("image/png");
  });

  it("assertCount and assertNothingStored", async () => {
    expect(() => disk.assertNothingStored()).not.toThrow();

    await disk.put("a", "1");
    await disk.put("b", "2");

    expect(() => disk.assertCount(2)).not.toThrow();
    expect(() => disk.assertCount(1)).toThrow("2:");
  });

  it("clear() empties the disk", async () => {
    await disk.put("a", "1");
    disk.clear();
    expect(disk.count).toBe(0);
  });
});

describe("StorageManager.fake()", () => {
  const config = {
    default: "local",
    disks: {
      local: { driver: "local" as const, root: "./storage/app", url: "/files" },
      s3: {
        driver: "s3" as const,
        key: "k",
        secret: "s",
        region: "r",
        bucket: "b",
      },
    },
  };

  it("swaps the default disk for a fake and hands it back", async () => {
    const manager = new StorageManager(config);
    const fake = manager.fake();

    await manager.disk().put("a.txt", "x");

    fake.assertExists("a.txt");
    expect(manager.disk()).toBe(fake);
  });

  it("uses the disk's configured url so links still look right", () => {
    const manager = new StorageManager(config);
    const fake = manager.fake();
    expect(fake.url("a.png")).toBe("/files/a.png");
  });

  it("fakes a named disk without touching the others", () => {
    const manager = new StorageManager(config);
    const fake = manager.fake("s3");

    expect(manager.disk("s3")).toBe(fake);
    expect(manager.disk("local")).not.toBe(fake);
  });

  it("restoreFakes puts the real drivers back", () => {
    const manager = new StorageManager(config);
    const fake = manager.fake();

    manager.restoreFakes();

    expect(manager.disk()).not.toBe(fake);
  });
});

describe("append", () => {
  it("creates the file on first append and adds to it after", async () => {
    await disk.append("logs/app.log", "one\n");
    await disk.append("logs/app.log", "two\n");

    expect(await disk.get("logs/app.log")).toBe("one\ntwo\n");
  });

  it("appends to a file that was written with put()", async () => {
    await disk.put("logs/app.log", "header\n");
    await disk.append("logs/app.log", "line\n");

    expect(await disk.get("logs/app.log")).toBe("header\nline\n");
  });
});
