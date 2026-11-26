import { tryCurrentApp } from "@zerotal/core";
import { Storage } from "@zerotal/core/storage";
import type { StorageDriver } from "@zerotal/core/storage";

/**
 * How this package gets hold of a disk.
 *
 * `undefined` means "the default disk", matching `StorageManager.disk()`.
 */
export type DiskResolver = (name?: string) => StorageDriver;

let _resolver: DiskResolver | null = null;

/**
 * Override how disks are resolved.
 *
 * The default path goes through the `Storage` facade, which needs an ambient
 * application. That is right in an app and awkward in a unit test, which has a
 * `StorageManager` in hand and no reason to build a container around it — so
 * this is the seam. Pass `null` to restore facade resolution.
 *
 * `Storage.fake()` still works either way: it swaps the driver inside the
 * manager, so whichever manager is resolved is the one that was faked.
 */
export function setDiskResolver(resolver: DiskResolver | null): void {
  _resolver = resolver;
}

/**
 * Resolve a disk by name, treating empty/absent as "the configured default".
 *
 * `StorageManager.disk()` falls back to the default only for `undefined` — an
 * empty string is looked up literally and throws `DiskNotConfiguredError`. Media
 * config uses `""` to mean "inherit the default", so every lookup goes through
 * here rather than reaching for `Storage.disk()` directly.
 *
 * @internal — disk resolution.
 */
export function diskFor(name?: string | null): StorageDriver {
  const trimmed = name?.trim();
  const resolved = trimmed !== undefined && trimmed !== "" ? trimmed : undefined;

  if (_resolver !== null) return _resolver(resolved);
  return resolved === undefined ? Storage.disk() : Storage.disk(resolved);
}

/** The name a disk reference resolves to, for storing in the `disk` column. */
export function diskNameFor(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : fallback;
}

let _defaultName: string | null = null;

/** Override the recorded default disk name. Pass `null` to read it from config. */
export function setDefaultDiskName(name: string | null): void {
  _defaultName = name;
}

/** The part of `StorageManager` this module asks about. */
interface ServedDisks {
  isServed(disk?: string): boolean;
}

/**
 * The concrete name of the disk media is written to when neither the collection
 * nor `config/media.ts` names one, e.g. `"public"`.
 *
 * Media rows record the disk they were written to by name rather than storing
 * `""` and re-resolving on read. An app that later flips `storage.default` from
 * `local` to `s3` would otherwise find every existing media row suddenly
 * claiming to live on S3, where none of the files are.
 *
 * That is `storage.default` when that disk has a URL. When it has none — the
 * built-in default, `local`, is private and unserved — it is the `public` disk
 * instead, because a media item's `getUrl()` on an unserved disk is a path
 * nothing answers: every link 404s. A disk named in config always wins.
 *
 * Falls back to `""` when there is no app or no storage to ask — the read path
 * treats that as "the default", which is the best answer available.
 *
 * @internal — disk resolution.
 */
export function defaultDiskName(): string {
  if (_defaultName !== null) return _defaultName;
  try {
    const container = tryCurrentApp()?.container;
    const config = container?.tryMake("config") as
      { get<T>(path: string, fallback?: T): T | undefined } | null | undefined;
    const storage = container?.tryMake("storage") as ServedDisks | null | undefined;
    // `StorageProvider` falls back to `StorageConfig()` when the app has no
    // config/storage.ts, and that names `local` as the default.
    const configured = config?.get<string>("storage.default", "") ?? "";
    if (!storage) return configured;
    const name = configured === "" ? "local" : configured;
    return !storage.isServed(name) && storage.isServed(PUBLIC_DISK) ? PUBLIC_DISK : name;
  } catch {
    return "";
  }
}

/** The built-in served disk, mounted at `/storage/public`. */
const PUBLIC_DISK = "public";
