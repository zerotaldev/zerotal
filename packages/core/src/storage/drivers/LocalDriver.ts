import { unlink, stat, copyFile, rename, appendFile, mkdir } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { safeEqual, hmacHex } from "../../support/crypto.ts";
import type { StorageDriver, PutOptions } from "../types.ts";
import { PathTraversalError, StorageKeyMissingError } from "../errors.ts";
import { assertInsideStorageRoot } from "../root.ts";

/**
 * Local filesystem driver — backed by Bun.file / Bun.write.
 * Suitable for single-server deployments and local development.
 */
export class LocalDriver implements StorageDriver {
  private readonly _rootAbs: string;

  constructor(
    private _root: string,
    private _urlBase: string | undefined = undefined,
  ) {
    // Absolute, normalised root used to confine every resolved path.
    this._rootAbs = resolve(_root);
    // …and the root itself is confined to the storage root, so a disk cannot be
    // pointed at the filesystem at large. Checked here rather than in config so
    // it holds for every LocalDriver, however it was constructed.
    assertInsideStorageRoot(this._rootAbs, "disk");
  }

  /**
   * Resolve `path` against the disk root and reject anything that escapes it.
   * `resolve()` collapses `..`/`.` segments; we then verify the result is the
   * root itself or a descendant of it, defeating `../../etc/passwd`-style
   * traversal on every operation (get/put/delete/copy/move).
   */
  private _fullPath(path: string): string {
    const full = resolve(this._rootAbs, path.replace(/^[/\\]+/, ""));
    if (full !== this._rootAbs && !full.startsWith(this._rootAbs + sep)) {
      throw new PathTraversalError(path);
    }
    return full;
  }

  async put(
    path: string,
    content: string | Uint8Array | Blob,
    _options?: PutOptions,
  ): Promise<void> {
    await Bun.write(this._fullPath(path), content);
  }

  async append(path: string, content: string | Uint8Array): Promise<void> {
    const full = this._fullPath(path);
    // `dirname`, not a regex: a hand-rolled one that only knows `/` silently
    // matches nothing on a Windows path and then creates a *directory* where
    // the file should go.
    await mkdir(dirname(full), { recursive: true });
    await appendFile(full, content);
  }

  async get(path: string): Promise<string | null> {
    const file = Bun.file(this._fullPath(path));
    if (!(await file.exists())) return null;
    return file.text();
  }

  async stream(path: string): Promise<Blob | null> {
    // `Bun.file` is a lazy handle, so returning it hands the file to the
    // response without pulling it through memory first.
    const file = Bun.file(this._fullPath(path));
    return (await file.exists()) ? file : null;
  }

  async getBuffer(path: string): Promise<Uint8Array | null> {
    const file = Bun.file(this._fullPath(path));
    if (!(await file.exists())) return null;
    return new Uint8Array(await file.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    return Bun.file(this._fullPath(path)).exists();
  }

  async delete(path: string): Promise<void> {
    await unlink(this._fullPath(path)).catch(() => {});
  }

  url(path: string): string {
    const base = this._urlBase?.replace(/\/$/, "") ?? "";
    return `${base}/${path.replace(/^\//, "")}`;
  }

  async copy(source: string, destination: string): Promise<void> {
    await copyFile(this._fullPath(source), this._fullPath(destination));
  }

  async move(source: string, destination: string): Promise<void> {
    await rename(this._fullPath(source), this._fullPath(destination));
  }

  async size(path: string): Promise<number | null> {
    return stat(this._fullPath(path))
      .then((s) => s.size)
      .catch(() => null);
  }

  async lastModified(path: string): Promise<number | null> {
    return stat(this._fullPath(path))
      .then((s) => s.mtimeMs)
      .catch(() => null);
  }

  /**
   * Local signed URL — encodes path + expiry in a HMAC-signed query string,
   * keyed off `APP_KEY` (throws when it is unset, so a signed URL is never
   * emitted with a guessable key). The signature is validated server-side by
   * your application's route handler; verify it with {@link verifyTemporaryUrl}.
   */
  async temporaryUrl(path: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = hmacHex(`${path}:${expiresAt}`, _signingKey());
    const base = this._urlBase?.replace(/\/$/, "") ?? "";
    return `${base}/${path.replace(/^\//, "")}?expires=${expiresAt}&signature=${sig}`;
  }

  /**
   * Verify a signature produced by {@link temporaryUrl}. Returns `false` when
   * the link has expired or the signature does not match (constant-time).
   */
  static verifyTemporaryUrl(path: string, expiresAt: number, signature: string): boolean {
    if (Math.floor(Date.now() / 1000) > expiresAt) return false;
    return safeEqual(signature, hmacHex(`${path}:${expiresAt}`, _signingKey()));
  }
}

/** The APP_KEY used to sign temporary URLs. Throws when it is not configured. */
function _signingKey(): string {
  const key = Bun.env["APP_KEY"];
  if (!key) throw new StorageKeyMissingError();
  return key;
}
