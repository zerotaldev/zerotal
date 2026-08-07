import { resolve, sep } from "node:path";
import { StorageRootEscapeError } from "./errors.ts";

/**
 * The one directory every local disk must live inside.
 *
 * A per-disk root already stops `../../etc/passwd` from escaping *that* disk,
 * but nothing stopped the disk itself from being rooted at `/etc` in the first
 * place — a config typo, a copied snippet, or a path built from user input, and
 * a "storage" disk is reading the filesystem. This is the outer boundary: every
 * local root resolves inside it or the driver refuses to exist.
 *
 * Defaults to `<cwd>/storage`. `ZT_STORAGE_ROOT` moves it — for a deployment
 * whose data volume is mounted elsewhere, or a test that works in a temp
 * directory. It is read on every call rather than cached so that a change takes
 * effect immediately.
 */
export function storageRoot(): string {
  return resolve(Bun.env["ZT_STORAGE_ROOT"] ?? "storage");
}

/**
 * The one directory whose contents are readable without a signature.
 *
 * Everything under {@link storageRoot} is private; this is the single carve-out.
 * Keeping it a real directory rather than a naming convention means "is this
 * file public?" is answered by where it lives, which is checkable, instead of by
 * which config block someone edited last.
 */
export function publicRoot(): string {
  return resolve(storageRoot(), "public");
}

/** Whether `path` resolves to the public directory or something beneath it. */
export function isInsidePublicRoot(path: string): boolean {
  const root = publicRoot();
  const full = resolve(path);
  return full === root || full.startsWith(root + sep);
}

/** Whether `path` resolves to the storage root or something beneath it. */
export function isInsideStorageRoot(path: string): boolean {
  const root = storageRoot();
  const full = resolve(path);
  return full === root || full.startsWith(root + sep);
}

/**
 * Throw unless `path` resolves inside {@link storageRoot}.
 *
 * @param path - The path to check; resolved against the working directory.
 * @param what - What is being rooted there, for the error message.
 * @throws {@link StorageRootEscapeError}
 */
export function assertInsideStorageRoot(path: string, what = "disk"): void {
  if (!isInsideStorageRoot(path)) {
    throw new StorageRootEscapeError(path, storageRoot(), what);
  }
}
