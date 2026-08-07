/**
 * The storage root jail, and serving files out of a disk over HTTP.
 */
import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalDriver } from "./drivers/LocalDriver.ts";
import { FakeDisk } from "./FakeDisk.ts";
import { StorageManager } from "./StorageManager.ts";
import { StorageConfig } from "./config.ts";
import { StorageFilesMiddleware, mountsFrom } from "./StorageFilesMiddleware.ts";
import { storageRoot, isInsideStorageRoot, assertInsideStorageRoot } from "./root.ts";
import {
  StorageRootEscapeError,
  DiskNotServedError,
  DiskNotConfiguredError,
  UnsafePublicMountError,
} from "./errors.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";

const SCRATCH = `.tmp-serving-test-${Date.now()}`;
Bun.env["ZT_STORAGE_ROOT"] = SCRATCH;

afterAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true }).catch(() => {});
});

// ── The jail ──────────────────────────────────────────────────────────────────

describe("the storage root", () => {
  it("resolves to the configured root, absolutely", () => {
    expect(storageRoot()).toBe(resolve(SCRATCH));
  });

  it("accepts the root itself and anything beneath it", () => {
    expect(isInsideStorageRoot(SCRATCH)).toBe(true);
    expect(isInsideStorageRoot(`${SCRATCH}/app/public`)).toBe(true);
  });

  it("rejects a sibling whose name merely starts the same", () => {
    // `storage-backup` must not pass because it shares a prefix with `storage`.
    expect(isInsideStorageRoot(`${SCRATCH}-backup`)).toBe(false);
  });

  it("rejects paths outside it, including ones that climb out", () => {
    expect(isInsideStorageRoot("/etc")).toBe(false);
    expect(isInsideStorageRoot(`${SCRATCH}/../..`)).toBe(false);
  });

  it("names both paths when it throws, so the fix is obvious", () => {
    expect(() => assertInsideStorageRoot("/etc", "disk")).toThrow(StorageRootEscapeError);
    expect(() => assertInsideStorageRoot("/etc", "disk")).toThrow(resolve(SCRATCH));
  });
});

describe("LocalDriver — rooted inside storage", () => {
  it("constructs for a root inside the storage root", () => {
    expect(() => new LocalDriver(`${SCRATCH}/app`)).not.toThrow();
  });

  it("refuses a root outside it, at construction rather than on first write", () => {
    // A disk pointed at the filesystem is a config bug; it should surface on
    // boot, not on the first upload.
    expect(() => new LocalDriver("/etc")).toThrow(StorageRootEscapeError);
    expect(() => new LocalDriver(`${SCRATCH}/../elsewhere`)).toThrow(StorageRootEscapeError);
  });

  it("still confines paths within its own root", async () => {
    const driver = new LocalDriver(`${SCRATCH}/app`);
    await expect(driver.put("../escaped.txt", "no")).rejects.toThrow();
  });
});

// ── Mount resolution ──────────────────────────────────────────────────────────

describe("mountsFrom", () => {
  it("mounts only disks that declare `serve`", () => {
    const mounts = mountsFrom(StorageConfig());

    // The default `local` disk holds private uploads and has no URL, and the
    // one public mount mirrors its directory: storage/public → /storage/public.
    expect(mounts.map((m) => m.disk)).toEqual(["public"]);
    expect(mounts[0]!.prefix).toBe("/storage/public");
  });

  it("normalises the prefix", () => {
    const mounts = mountsFrom(
      StorageConfig({
        disks: { a: { driver: "local", root: `${SCRATCH}/public/a`, serve: { path: "files/" } } },
      }),
    );
    expect(mounts.find((m) => m.disk === "a")!.prefix).toBe("/files");
  });

  it("orders longest prefix first so a nested mount is not shadowed", () => {
    // Built directly: `StorageConfig` would merge in the built-in `/storage`
    // mount and obscure the ordering under test.
    const mounts = mountsFrom({
      default: "outer",
      disks: {
        outer: { driver: "local", root: `${SCRATCH}/public/o`, serve: { path: "/files" } },
        inner: { driver: "local", root: `${SCRATCH}/public/i`, serve: { path: "/files/private" } },
      },
    });
    expect(mounts.map((m) => m.prefix)).toEqual(["/files/private", "/files"]);
  });

  it("refuses to serve a disk outside the public directory without signing", () => {
    // The whole point of the storage root: everything in it is private except
    // `storage/public`. An unsigned mount elsewhere would make private files
    // world-readable through a URL prefix.
    expect(() =>
      mountsFrom({
        default: "leaky",
        disks: { leaky: { driver: "local", root: `${SCRATCH}/private`, serve: { path: "/oops" } } },
      }),
    ).toThrow(UnsafePublicMountError);
  });

  it("allows a disk outside the public directory when it is signed", () => {
    // Signed is the sanctioned way to expose something private: every request
    // has to carry a signature the app issued.
    expect(() =>
      mountsFrom({
        default: "invoices",
        disks: {
          invoices: {
            driver: "local",
            root: `${SCRATCH}/private`,
            serve: { path: "/invoices", signed: true },
          },
        },
      }),
    ).not.toThrow();
  });

  it("leaves S3 disks alone — the bucket's exposure is the bucket's policy", () => {
    expect(() =>
      mountsFrom({
        default: "s3",
        disks: {
          s3: {
            driver: "s3",
            key: "k",
            secret: "s",
            region: "r",
            bucket: "b",
            serve: { path: "/cdn" },
          },
        },
      }),
    ).not.toThrow();
  });

  it("returns nothing when no disk is served", () => {
    // Built directly rather than through `StorageConfig`, which deep-merges and
    // would keep the built-in served `public`.
    expect(
      mountsFrom({
        default: "local",
        disks: { local: { driver: "local", root: `${SCRATCH}/p` } },
      }),
    ).toEqual([]);
  });
});

// ── Serving ───────────────────────────────────────────────────────────────────

/** A manager whose named disks are in-memory fakes, signing as the real one does. */
function fakeManager(disks: Record<string, FakeDisk>): StorageManager {
  return {
    disk: (name?: string) => disks[name ?? "public"]!,
    verifyTemporaryUrl: (path: string, expiresAt: number, signature: string) =>
      LocalDriver.verifyTemporaryUrl(path, expiresAt, signature),
  } as unknown as StorageManager;
}

async function serve(
  middleware: StorageFilesMiddleware,
  url: string,
  method = "GET",
): Promise<Response | undefined> {
  const http = HttpContext.fake(url, { method });
  const result = await middleware.handle(http as never, async () => undefined);
  return result instanceof Response ? result : undefined;
}

/** Build the middleware around one served disk. */
function mount(
  disk: FakeDisk,
  serveCfg: { path: string; signed?: boolean; headers?: Record<string, string> },
): StorageFilesMiddleware {
  // An unsigned mount has to live in the public directory; a signed one may
  // live anywhere under the storage root, since access is controlled.
  const root = serveCfg.signed ? `${SCRATCH}/private` : `${SCRATCH}/public`;
  const Mw = StorageFilesMiddleware.with({
    mounts: mountsFrom(
      StorageConfig({
        disks: { public: { driver: "local", root, serve: serveCfg } },
      }),
    ),
    storage: fakeManager({ public: disk }),
  }) as unknown as new () => StorageFilesMiddleware;
  return new Mw();
}

let disk: FakeDisk;
beforeEach(() => {
  disk = new FakeDisk();
});

describe("StorageFilesMiddleware", () => {
  it("serves a file from the mounted disk", async () => {
    await disk.put("logo.png", "PNG-BYTES", { contentType: "image/png" });

    const res = await serve(mount(disk, { path: "/storage" }), "http://x/storage/logo.png");

    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe("PNG-BYTES");
  });

  it("serves a file in a nested directory", async () => {
    await disk.put("avatars/42/me.png", "AVATAR");

    const res = await serve(
      mount(disk, { path: "/storage" }),
      "http://x/storage/avatars/42/me.png",
    );

    expect(await res!.text()).toBe("AVATAR");
  });

  it("404s a file that is not there", async () => {
    const res = await serve(mount(disk, { path: "/storage" }), "http://x/storage/missing.png");

    expect(res?.status).toBe(404);
  });

  it("passes non-matching paths to the application", async () => {
    const res = await serve(mount(disk, { path: "/storage" }), "http://x/posts/1");

    expect(res).toBeUndefined();
  });

  it("passes the bare prefix through — a mount is not an index", async () => {
    const res = await serve(mount(disk, { path: "/storage" }), "http://x/storage");

    expect(res).toBeUndefined();
  });

  it("leaves writes to the application", async () => {
    await disk.put("logo.png", "PNG");

    expect(
      await serve(mount(disk, { path: "/storage" }), "http://x/storage/logo.png", "POST"),
    ).toBeUndefined();
    expect(
      await serve(mount(disk, { path: "/storage" }), "http://x/storage/logo.png", "DELETE"),
    ).toBeUndefined();
  });

  it("answers HEAD with headers and no body", async () => {
    await disk.put("logo.png", "PNG-BYTES");

    const res = await serve(mount(disk, { path: "/storage" }), "http://x/storage/logo.png", "HEAD");

    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe("");
  });

  it("decodes a percent-encoded path", async () => {
    await disk.put("my file.txt", "SPACED");

    const res = await serve(mount(disk, { path: "/storage" }), "http://x/storage/my%20file.txt");

    expect(await res!.text()).toBe("SPACED");
  });

  it("applies configured headers and a cache default", async () => {
    await disk.put("a.txt", "x");

    const res = await serve(
      mount(disk, { path: "/storage", headers: { "X-Served-By": "zerotal" } }),
      "http://x/storage/a.txt",
    );

    expect(res!.headers.get("X-Served-By")).toBe("zerotal");
    expect(res!.headers.get("Cache-Control")).toContain("public");
    expect(res!.headers.get("Last-Modified")).toBeTruthy();
  });
});

describe("StorageFilesMiddleware — signed disks", () => {
  it("refuses an unsigned request", async () => {
    await disk.put("report.pdf", "SECRET");

    const res = await serve(
      mount(disk, { path: "/files", signed: true }),
      "http://x/files/report.pdf",
    );

    // 404, not 403: a rejection must not confirm the file exists to someone
    // guessing paths.
    expect(res?.status).toBe(404);
  });

  it("refuses a forged signature", async () => {
    await disk.put("report.pdf", "SECRET");

    const res = await serve(
      mount(disk, { path: "/files", signed: true }),
      "http://x/files/report.pdf?expires=99999999999&signature=forged",
    );

    expect(res?.status).toBe(404);
  });

  it("serves a validly signed request", async () => {
    Bun.env["APP_KEY"] ??= "serving-test-key";
    await disk.put("report.pdf", "SECRET");

    const real = new LocalDriver(`${SCRATCH}/signed`);
    const signed = await real.temporaryUrl("report.pdf", 600);
    const query = signed.slice(signed.indexOf("?"));

    const res = await serve(
      mount(disk, { path: "/files", signed: true }),
      `http://x/files/report.pdf${query}`,
    );

    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe("SECRET");
    expect(res!.headers.get("Cache-Control")).toContain("no-store");
  });

  it("refuses a signature that has expired", async () => {
    Bun.env["APP_KEY"] ??= "serving-test-key";
    await disk.put("report.pdf", "SECRET");

    const real = new LocalDriver(`${SCRATCH}/signed`);
    const signed = await real.temporaryUrl("report.pdf", -60); // already past
    const query = signed.slice(signed.indexOf("?"));

    const res = await serve(
      mount(disk, { path: "/files", signed: true }),
      `http://x/files/report.pdf${query}`,
    );

    expect(res?.status).toBe(404);
  });

  it("refuses a signature borrowed from another file", async () => {
    Bun.env["APP_KEY"] ??= "serving-test-key";
    await disk.put("public.txt", "PUBLIC");
    await disk.put("private.txt", "PRIVATE");

    const real = new LocalDriver(`${SCRATCH}/signed`);
    const signed = await real.temporaryUrl("public.txt", 600);
    const query = signed.slice(signed.indexOf("?"));

    const res = await serve(
      mount(disk, { path: "/files", signed: true }),
      `http://x/files/private.txt${query}`,
    );

    expect(res?.status).toBe(404);
  });
});

// ── Public URLs ───────────────────────────────────────────────────────────────

describe("Storage.publicUrl", () => {
  /** A manager over a config where each disk is exposed differently. */
  function manager(): StorageManager {
    return new StorageManager({
      default: "private",
      disks: {
        private: { driver: "local", root: `${SCRATCH}/private` },
        public: { driver: "local", root: `${SCRATCH}/public`, serve: { path: "/storage" } },
        signed: {
          driver: "local",
          root: `${SCRATCH}/signed`,
          serve: { path: "/invoices", signed: true, expiresIn: 60 },
        },
        cdn: { driver: "local", root: `${SCRATCH}/cdn`, url: "https://cdn.example.com" },
      },
    });
  }

  it("gives a permanent URL under the mount for a served disk", async () => {
    expect(await manager().publicUrl("a/b.png", { disk: "public" })).toBe("/storage/a/b.png");
  });

  it("derives the URL base from `serve.path`, so the two cannot drift", async () => {
    // The disk declares no `url` — the mount is the base.
    expect(await manager().publicUrl("x.png", { disk: "public" })).toStartWith("/storage/");
  });

  it("prefers an explicit `url` — that is how a CDN goes in front", async () => {
    expect(await manager().publicUrl("a.png", { disk: "cdn" })).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("gives a signed, expiring URL for a signed disk", async () => {
    Bun.env["APP_KEY"] ??= "serving-test-key";

    const url = await manager().publicUrl("q1.pdf", { disk: "signed" });

    expect(url).toStartWith("/invoices/q1.pdf?");
    expect(url).toContain("signature=");
    expect(url).toContain("expires=");
  });

  it("refuses a disk with no public URL, rather than returning a broken one", async () => {
    // Returning the path here is what produced a *relative* src that the
    // browser resolved against the page it was embedded in.
    await expect(manager().publicUrl("secret.pdf", { disk: "private" })).rejects.toThrow(
      DiskNotServedError,
    );
  });

  it("uses the default disk when none is named", async () => {
    await expect(manager().publicUrl("secret.pdf")).rejects.toThrow(DiskNotServedError);
  });

  it("refuses a disk that does not exist", async () => {
    await expect(manager().publicUrl("a.png", { disk: "nope" })).rejects.toThrow(
      DiskNotConfiguredError,
    );
  });

  it("isServed reports which disks have a URL, so a template can branch", () => {
    const m = manager();

    expect(m.isServed("public")).toBe(true);
    expect(m.isServed("signed")).toBe(true);
    expect(m.isServed("cdn")).toBe(true);
    expect(m.isServed("private")).toBe(false);
    expect(m.isServed()).toBe(false); // the default disk is private
    expect(m.isServed("nope")).toBe(false);
  });

  it("round-trips: a signed URL it produced is one the middleware accepts", async () => {
    Bun.env["APP_KEY"] ??= "serving-test-key";
    const disk = new FakeDisk();
    await disk.put("q1.pdf", "INVOICE");

    const url = await manager().publicUrl("q1.pdf", { disk: "signed" });
    const query = url.slice(url.indexOf("?"));

    const res = await serve(
      mount(disk, { path: "/invoices", signed: true }),
      `http://x/invoices/q1.pdf${query}`,
    );

    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe("INVOICE");
  });
});
