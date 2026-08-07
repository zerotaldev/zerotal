/**
 * The media library — one place to see, upload, reuse and remove files.
 *
 * A file upload field puts a file somewhere and stores a path. That is enough
 * until the same logo is needed on twenty products, or somebody asks which
 * records are still pointing at a file before deleting it. A library answers
 * both, by keeping a catalogue alongside the bytes.
 *
 * The split matters: `@zerotal/core/storage` holds the file, and a
 * {@link MediaProvider} holds the record of it. Listing a bucket is not a
 * substitute — it cannot tell you alt text, who uploaded something, or what it
 * is used for, and on a large disk it is slow besides. So the provider is the
 * app's, exactly as the notification centre's and the saved views' are:
 *
 *   Panel.media(databaseMedia());       // the ordinary case, over a table
 *   Panel.media({ list, save, remove }); // or your own
 *
 * With no provider configured the library page and the picker do not appear, and
 * file fields keep working as plain uploads.
 *
 * Which disk the library writes to is the panel's to say — `Panel.media(provider,
 * { disk })`. It matters more than it looks: the default disk is private and
 * declares no `serve`, so a library left on it stores every upload successfully
 * and has no URL for any of them.
 */
import { frameworkLog } from "@zerotal/core/logger";
import { Storage } from "@zerotal/core/storage";

/** One catalogued file. */
export interface MediaItem {
  id: string;
  /** Path on the disk — what a record stores, and what `Storage.url()` resolves. */
  path: string;
  /** Original file name, for display and for the download attribute. */
  name: string;
  /** MIME type as uploaded. */
  mime: string;
  /** Size in bytes. */
  size: number;
  /** Alternative text, for images. Empty is a valid answer for a decorative one. */
  alt?: string;
  /** Free-form grouping — "products", "avatars" — for filtering the library. */
  folder?: string;
  /** ISO timestamp. */
  uploadedAt?: string;
}

/** What the app supplies so the library can be listed and maintained. */
export interface MediaProvider {
  /** Catalogued files, newest first, optionally narrowed by folder or search. */
  list(query: {
    folder?: string;
    search?: string;
    limit: number;
  }): Promise<MediaItem[]> | MediaItem[];
  /** Record a newly stored file. The panel supplies everything but the id. */
  save(item: Omit<MediaItem, "id">): Promise<MediaItem> | MediaItem;
  /** Forget a file, and delete its bytes. */
  remove(id: string): Promise<void> | void;
  /** Update the editable metadata on one item. */
  update?(id: string, changes: Pick<MediaItem, "alt" | "folder">): Promise<void> | void;
}

/** Image types the picker shows a thumbnail for rather than an icon. */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i;

export function isImage(item: MediaItem): boolean {
  return IMAGE_TYPES.test(item.mime);
}

/** `1.4 MB` — sizes are read at a glance, not audited. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A storage path for an upload that will not collide with another.
 *
 * The random prefix is the point: two people uploading `logo.png` on the same
 * day must not overwrite each other, and a guessable path is a small
 * information leak on a private disk. The original name is kept on the end so
 * the file is still recognisable in a bucket listing.
 *
 * The sanitising here is about producing a tidy, predictable key — it is not
 * the defence against escaping the disk. The driver owns that, and rejects a
 * traversing path with `PathTraversalError` whatever this produces.
 */
export function mediaPath(name: string, folder = "media"): string {
  const safeName =
    name
      .replace(/[^\w.-]+/g, "-")
      .replace(/^[.-]+/, "")
      .slice(-80) || "file";
  // Sanitised a segment at a time, so `../secrets` becomes `secrets` rather than
  // a stray `-` directory beside it — and traversal is gone either way.
  const safeFolder =
    folder
      .split("/")
      .map((segment) => segment.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, ""))
      .filter(Boolean)
      .join("/") || "media";
  return `${safeFolder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

/**
 * Whether storage is usable at all.
 *
 * Distinct from "this disk has no URL", which {@link StorageManager.isServed}
 * answers. This one catches the earlier failure: an app that wired up a media
 * provider but never registered `StorageProvider`, so the facade has nothing to
 * resolve. That is a misconfiguration rather than a state to render, but it
 * should degrade to a placeholder instead of taking the page down.
 */
function storageReady(disk?: string): boolean {
  try {
    return Storage.isServed(disk);
  } catch {
    return false;
  }
}

/**
 * A URL the browser can fetch for a catalogued file, or `null` when the disk
 * has none.
 *
 * `null`, not the stored path. Returning the path produced a *relative* `src`
 * that the browser resolved against whatever admin page was open — a media
 * library at `/admin/shop/media` asking for `media/photo.jpg` fetched
 * `/admin/shop/media/media/photo.jpg` and got the panel's own 404. A caller
 * that knows there is no URL can render a placeholder; one handed a broken
 * string cannot.
 */
export async function mediaUrl(item: MediaItem, disk?: string): Promise<string | null> {
  // Asked, not caught. `isServed` exists precisely so "this disk has no public
  // URL" is a branch rather than an exception, which leaves the catch below for
  // things that are genuinely wrong — a signing key missing, a driver failing —
  // and those get logged instead of quietly becoming a missing image.
  if (!storageReady(disk)) return null;

  try {
    return await Storage.publicUrl(item.path, disk ? { disk } : {});
  } catch (error) {
    frameworkLog("admin").warn("Could not resolve a media URL", { path: item.path, disk }, error);
    return null;
  }
}

/**
 * Turn a stored value into something an `<img src>` can fetch.
 *
 * Image columns and entries hold whatever the record holds, and that is one of
 * three things: a full URL from an external service, a root-relative path the
 * app already serves, or a *disk-relative* storage path like `media/photo.jpg`.
 * Only the last needs resolving — and rendering it unresolved is the bug this
 * exists to prevent, because a browser reads `media/photo.jpg` relative to the
 * page and fetches `/admin/shop/media/photo.jpg`, which is the panel's own 404.
 *
 * Synchronous, because cells and entries render synchronously. That is possible
 * for a plain public disk, where a URL is a prefix and a path. It is not for a
 * signed disk, whose URL has to be minted per request — those return `null` and
 * the caller shows a placeholder. Put images meant for a table on a public disk.
 *
 * @returns The URL, or `null` when there is none to give.
 */
export function resolveMediaSrc(value: unknown, disk?: string): string | null {
  if (typeof value !== "string" || value === "") return null;

  // Already fetchable: an absolute URL, a protocol-relative one, a data URI, or
  // a root-relative path the app serves itself.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)) return value;

  try {
    if (!Storage.isServed(disk)) return null;
    // A signed disk cannot be resolved without minting a signature, which is
    // async; say so rather than hand back an unsigned URL that will 403.
    return Storage.disk(disk).url(value);
  } catch {
    // No storage configured at all.
    return null;
  }
}

/**
 * A file as it arrives from a bound file input.
 *
 * This is the shape of the temporary upload the framework hands a component
 * once the browser has POSTed the bytes: the file is already on the temp disk,
 * and `store()` moves it where it belongs.
 */
export interface UploadedFileLike {
  originalName: string;
  mime: string;
  size: number;
  store(directory: string, disk?: string, filename?: string): Promise<string>;
}

/** Whether a bound value is an upload rather than an already-stored path. */
export function isUpload(value: unknown): value is UploadedFileLike {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as UploadedFileLike).store === "function" &&
    typeof (value as UploadedFileLike).originalName === "string"
  );
}

export interface StoreMediaOptions {
  provider: MediaProvider;
  /** Disk to write to; the default disk when omitted. */
  disk?: string;
  folder?: string;
  /** Refuse anything larger, in bytes. */
  maxBytes?: number;
  /** Accepted MIME types; anything goes when omitted. */
  accept?: string[];
}

/**
 * Move an uploaded file onto its permanent disk and catalogue it.
 *
 * Order matters: the bytes land first, and only a successful move is
 * catalogued. A catalogue entry pointing at a file that isn't there is worse
 * than a file nobody catalogued, because the panel would keep offering it.
 */
export async function storeMedia(
  file: UploadedFileLike,
  options: StoreMediaOptions,
): Promise<[true, MediaItem] | [false, string]> {
  if (options.accept?.length && !options.accept.includes(file.mime)) {
    return [false, `${file.originalName} is not an accepted file type.`];
  }
  if (options.maxBytes && file.size > options.maxBytes) {
    return [false, `${file.originalName} is larger than ${formatSize(options.maxBytes)}.`];
  }

  const folder = options.folder ?? "media";
  const path = mediaPath(file.originalName, folder);
  // Split only to satisfy the directory/filename shape `store()` takes; the
  // path was built as one string because that is what gets catalogued.
  const slash = path.lastIndexOf("/");
  let stored: string;
  try {
    stored = await file.store(path.slice(0, slash), options.disk, path.slice(slash + 1));
  } catch (error) {
    frameworkLog("admin").warn("Could not store an upload", { path }, error);
    return [false, `Could not store ${file.originalName}.`];
  }

  const item = await options.provider.save({
    path: stored || path,
    name: file.originalName,
    mime: file.mime,
    size: file.size,
    ...(options.folder ? { folder: options.folder } : {}),
    uploadedAt: new Date().toISOString(),
  });
  return [true, item];
}

/**
 * Remove a file from both the catalogue and the disk.
 *
 * The catalogue entry goes first. If the disk delete then fails the result is an
 * orphaned file — wasted space, but nothing broken — whereas the other order can
 * leave the library offering a file that no longer exists.
 */
export async function deleteMedia(
  item: MediaItem,
  options: { provider: MediaProvider; disk?: string },
): Promise<[true] | [false, string]> {
  try {
    await options.provider.remove(item.id);
  } catch (error) {
    frameworkLog("admin").warn("Could not remove a media record", { id: item.id }, error);
    return [false, `Could not remove ${item.name}.`];
  }

  try {
    await Storage.disk(options.disk).delete(item.path);
  } catch (error) {
    frameworkLog("admin").warn(
      "Media record removed but its file remains",
      { path: item.path },
      error,
    );
  }
  return [true];
}
