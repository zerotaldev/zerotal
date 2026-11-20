import { resolve } from "node:path";
import { _appFilesEmbedded, _importAppFile, _scanAppFiles } from "@zerotal/core/runtime";
import type { Catalogs, Messages } from "./types.ts";
import { CatalogLoadError } from "./errors.ts";

/**
 * Load `<locale>.json` files from `dir` into a catalog map. A missing directory
 * yields an empty map; a malformed JSON file throws `CatalogLoadError`.
 *
 * @example
 * const catalogs = await loadCatalogs('resources/lang'); // { en: {...}, fr: {...} }
 */
export async function loadCatalogs(dir: string): Promise<Catalogs> {
  const out: Catalogs = {};
  // A missing directory yields nothing to load. In a binary built by `bun zt compile`, the
  // catalogs are carried in it and come from there.
  const entries = await _scanAppFiles(dir, "*.json");
  for (const rel of entries) {
    const locale = rel
      .replace(/\.json$/, "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()!;
    try {
      out[locale] = _appFilesEmbedded()
        ? (await _importAppFile<{ default: Messages }>(resolve(dir, rel))).default
        : ((await Bun.file(`${dir}/${rel}`).json()) as Messages);
    } catch (err) {
      throw new CatalogLoadError(`${dir}/${rel}`, err);
    }
  }
  return out;
}
