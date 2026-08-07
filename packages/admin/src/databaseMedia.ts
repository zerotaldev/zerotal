/**
 * A media catalogue kept in a database table.
 *
 * {@link MediaProvider} is deliberately open, because where a file catalogue
 * belongs is the app's decision. When the answer is the ordinary one — a table
 * with a row per file — this builds the provider for you:
 *
 *   import { databaseMedia } from "@zerotal/admin";
 *
 *   Panel.media(databaseMedia());
 *
 * The table it expects:
 *
 *   id, path, name, mime, size, alt, folder, uploaded_at
 *
 * Column names are adjustable, so an existing table usually needs no migration.
 * `@zerotal/orm` is resolved lazily, keeping it an optional peer.
 */
import { frameworkLog } from "@zerotal/core/logger";
import type { MediaItem, MediaProvider } from "./media.ts";

export interface DatabaseMediaOptions {
  /** Table holding the catalogue. Defaults to `"media"`. */
  table?: string;
  /** Map the panel's fields onto your column names. */
  columns?: Partial<Record<keyof MediaItem, string>>;
}

const DEFAULT_COLUMNS: Record<keyof MediaItem, string> = {
  id: "id",
  path: "path",
  name: "name",
  mime: "mime",
  size: "size",
  alt: "alt",
  folder: "folder",
  uploadedAt: "uploaded_at",
};

/** The minimum query surface this needs, kept structural so `orm` stays optional. */
interface QueryLike {
  where(column: string, value: unknown): QueryLike;
  whereLike?(column: string, value: string): QueryLike;
  orderBy(column: string, direction: string): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<Record<string, unknown>[]>;
  insert(values: Record<string, unknown>): Promise<unknown>;
  update(values: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

async function table(name: string): Promise<QueryLike | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "@zerotal/orm" as string)) as {
      DB?: { table(name: string): QueryLike };
    };
    return mod.DB?.table(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a {@link MediaProvider} over a table.
 *
 * Listing fails soft — an unconfigured database or a missing table yields an
 * empty library rather than a broken page — but saving and removing report
 * their failures, because silently losing an upload is not a kindness.
 */
export function databaseMedia(options: DatabaseMediaOptions = {}): MediaProvider {
  const name = options.table ?? "media";
  const col = { ...DEFAULT_COLUMNS, ...(options.columns ?? {}) };

  /** Turn a row into a catalogue item, tolerating nulls in the optional fields. */
  const toItem = (row: Record<string, unknown>): MediaItem => {
    const str = (key: keyof MediaItem): string | undefined => {
      const value = row[col[key]];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    return {
      id: String(row[col.id] ?? ""),
      path: str("path") ?? "",
      name: str("name") ?? "",
      mime: str("mime") ?? "application/octet-stream",
      size: Number(row[col.size] ?? 0),
      ...(str("alt") ? { alt: str("alt")! } : {}),
      ...(str("folder") ? { folder: str("folder")! } : {}),
      ...(str("uploadedAt") ? { uploadedAt: str("uploadedAt")! } : {}),
    };
  };

  return {
    async list(query): Promise<MediaItem[]> {
      try {
        const t = await table(name);
        if (!t) return [];
        let q = t;
        if (query.folder) q = q.where(col.folder, query.folder);
        // Searching by name is what a library search means; falling back to an
        // exact match keeps this working on a driver without `whereLike`.
        if (query.search) {
          q = q.whereLike
            ? q.whereLike(col.name, `%${query.search}%`)
            : q.where(col.name, query.search);
        }
        const rows = await q.orderBy(col.uploadedAt, "desc").limit(query.limit).get();
        return rows.map(toItem);
      } catch (error) {
        frameworkLog("admin").warn("Media library unavailable", { table: name }, error);
        return [];
      }
    },

    async save(item): Promise<MediaItem> {
      const t = await table(name);
      if (!t) throw new Error("The media library needs a configured database.");
      const values: Record<string, unknown> = {
        [col.path]: item.path,
        [col.name]: item.name,
        [col.mime]: item.mime,
        [col.size]: item.size,
        [col.alt]: item.alt ?? "",
        [col.folder]: item.folder ?? "",
        [col.uploadedAt]: item.uploadedAt ?? new Date().toISOString(),
      };
      const inserted = (await t.insert(values)) as Record<string, unknown> | undefined;
      // Drivers differ on what an insert returns; the path is unique enough to
      // identify the row when an id does not come back.
      const id = inserted?.[col.id] ?? inserted;
      return { ...item, id: id == null ? item.path : String(id) } as MediaItem;
    },

    async remove(id): Promise<void> {
      const t = await table(name);
      if (!t) throw new Error("The media library needs a configured database.");
      await t.where(col.id, id).delete();
    },

    async update(id, changes): Promise<void> {
      const t = await table(name);
      if (!t) throw new Error("The media library needs a configured database.");
      await t.where(col.id, id).update({
        [col.alt]: changes.alt ?? "",
        [col.folder]: changes.folder ?? "",
      });
    },
  };
}
