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

/**
 * The concrete name of the default disk, e.g. `"local"`.
 *
 * Media rows record the disk they were written to by name rather than storing
 * `""` and re-resolving on read. An app that later flips `storage.default` from
 * `local` to `s3` would otherwise find every existing media row suddenly
 * claiming to live on S3, where none of the files are.
 *
 * Falls back to `""` when there is no app or no storage config to ask — the read
 * path treats that as "the default", which is the best answer available.
 */
export function defaultDiskName(): string {
  if (_defaultName !== null) return _defaultName;
  try {
    const config = tryCurrentApp()?.container.tryMake("config") as
      { get<T>(path: string, fallback?: T): T | undefined } | null | undefined;
    return config?.get<string>("storage.default", "") ?? "";
  } catch {
    return "";
  }
}
