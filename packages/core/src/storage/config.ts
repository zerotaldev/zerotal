import { join } from "node:path";
import { deepMerge } from "../support/deepMerge.ts";
import type { StorageConfigShape } from "./types.ts";
import { storageRoot, publicRoot } from "./root.ts";

/**
 * The built-in disks, derived from the storage root rather than hardcoding
 * `./storage`.
 *
 * Computed per call because the root is read from the environment: a literal
 * `"./storage/app"` here would sit outside a `ZT_STORAGE_ROOT` pointed at a
 * mounted volume, and the default config would fail its own boundary check.
 */
function defaults(): StorageConfigShape {
  return {
    default: "local",
    disks: {
      // The default disk holds private uploads and has no `serve` block, so it
      // is not reachable over HTTP. Hand out links to a file here with
      // `temporaryUrl()`, or move the file to `public`.
      local: { driver: "local", root: join(storageRoot(), "app") },
      // The one public directory. Its filesystem path and its URL are the same
      // shape on purpose — `storage/public/a.png` is `/storage/public/a.png` —
      // so "is this file public?" is answered by where the file lives rather
      // than by which config block someone edited last. No `url` is needed: a
      // served disk's URL base defaults to where it is mounted.
      public: {
        driver: "local",
        root: publicRoot(),
        serve: { path: "/storage/public" },
      },
    },
  };
}

export function StorageConfig(options: Partial<StorageConfigShape> = {}): StorageConfigShape {
  // `disks` is a name-keyed object, so deepMerge MERGES custom disks with the
  // built-in `local`/`public` defaults rather than replacing them.
  return deepMerge(defaults(), options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    storage: StorageConfigShape;
  }
}
