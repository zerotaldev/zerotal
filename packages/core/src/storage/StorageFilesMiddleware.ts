import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware } from "../middleware/BaseMiddleware.ts";
import type { StorageManager } from "./StorageManager.ts";
import type { DiskServeConfig, StorageConfigShape, StorageDriver } from "./types.ts";
import { isInsidePublicRoot, publicRoot } from "./root.ts";
import { UnsafePublicMountError } from "./errors.ts";
import { resolve } from "node:path";

/** One disk mounted at a URL prefix. */
interface Mount {
  disk: string;
  prefix: string;
  serve: DiskServeConfig;
}

export interface StorageFilesOptions {
  /** Disks to serve, in match order. Built from config by {@link StorageProvider}. */
  mounts?: Mount[];
  /** The manager the files are read through. */
  storage?: StorageManager;
}

/**
 * Serves files from a storage disk over HTTP.
 *
 * Only disks that declare `serve` in `config/storage.ts` are reachable; the rest
 * have no URL at all. That is the safe default for a disk holding private
 * uploads — exposure is something you ask for, one disk at a time, rather than
 * something you remember to switch off.
 *
 * `Router.static()` cannot do this job: it registers the files it finds at boot,
 * so anything uploaded afterwards is invisible until a restart. This resolves
 * per request, through the driver, so an S3-backed disk can be proxied the same
 * way a local one is served.
 *
 * @example
 * ```ts
 * // config/storage.ts — public assets, and private files behind signed links
 * disks: {
 *   public:  { driver: "local", root: "./storage/public",
 *              serve: { path: "/storage/public" } },
 *   private: { driver: "local", root: "./storage/invoices",
 *              serve: { path: "/files", signed: true } },
 * }
 * ```
 */
export class StorageFilesMiddleware extends BaseMiddleware<StorageFilesOptions> {
  protected options: StorageFilesOptions = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const { mounts, storage } = this.options;
    if (!mounts?.length || !storage) return next();

    // Only GET and HEAD read files; anything else belongs to the application.
    const method = http.request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return next();

    const pathname = decodeURIComponent(http.url.pathname);
    const mount = mounts.find((m) => pathname === m.prefix || pathname.startsWith(m.prefix + "/"));
    if (!mount) return next();

    const relative = pathname.slice(mount.prefix.length).replace(/^\/+/, "");
    if (!relative) return next();

    if (mount.serve.signed && !this._verifySignature(http, storage, relative)) {
      // Deliberately 404, not 403: a bad signature should not confirm that the
      // file exists to someone guessing paths.
      return this._notFound();
    }

    let driver: StorageDriver;
    try {
      driver = storage.disk(mount.disk);
    } catch {
      return next(); // the disk vanished from config — not this middleware's file
    }

    const body = await this._read(driver, relative);
    if (body === null) return this._notFound();

    const headers = new Headers(mount.serve.headers ?? {});
    // A traversal attempt never reaches here — the driver rejects it — so any
    // path that resolved is one the disk owns.
    const modified = await driver.lastModified(relative).catch(() => null);
    if (modified !== null) headers.set("Last-Modified", new Date(modified).toUTCString());
    if (!headers.has("Cache-Control")) {
      headers.set(
        "Cache-Control",
        mount.serve.signed ? "private, no-store" : "public, max-age=300",
      );
    }

    return new Response(method === "HEAD" ? null : body, { headers });
  }

  /** Prefer a streamable handle; fall back to bytes for drivers without one. */
  private async _read(driver: StorageDriver, path: string): Promise<Blob | null> {
    try {
      if (driver.stream) return await driver.stream(path);
      const bytes = await driver.getBuffer(path);
      return bytes === null ? null : new Blob([bytes as BlobPart]);
    } catch {
      // A traversal rejection or an unreadable file both mean "no file here".
      return null;
    }
  }

  private _verifySignature(http: HttpContext, storage: StorageManager, path: string): boolean {
    const expires = Number(http.url.searchParams.get("expires"));
    const signature = http.url.searchParams.get("signature");
    if (!Number.isFinite(expires) || !signature) return false;
    try {
      return storage.verifyTemporaryUrl(path, expires, signature);
    } catch {
      // Signing needs APP_KEY; without it no signature can be valid.
      return false;
    }
  }

  private _notFound(): Response {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}

/**
 * Build the mount list from a storage config, in longest-prefix-first order.
 *
 * Also enforces the one rule that keeps the storage root private: a local disk
 * served *without* `signed` has to live inside the public directory. Checked
 * here because this runs at boot, so an unsafe config fails before the server
 * accepts a request rather than the first time someone guesses a path.
 *
 * @throws {@link UnsafePublicMountError}
 */
export function mountsFrom(config: StorageConfigShape): Mount[] {
  const mounts: Mount[] = [];
  for (const [disk, cfg] of Object.entries(config.disks)) {
    if (!cfg.serve) continue;
    // Only local disks have a filesystem root to police. An S3 bucket is
    // outside the storage root by nature, and its exposure is the bucket's own
    // policy to decide.
    if (cfg.driver === "local" && !cfg.serve.signed && !isInsidePublicRoot(cfg.root)) {
      throw new UnsafePublicMountError(disk, resolve(cfg.root), publicRoot());
    }
    mounts.push({ disk, prefix: `/${cfg.serve.path.replace(/^\/+|\/+$/g, "")}`, serve: cfg.serve });
  }
  // Longest prefix first, so `/storage/private` is matched before `/storage`.
  return mounts.sort((a, b) => b.prefix.length - a.prefix.length);
}
