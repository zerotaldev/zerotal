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
  const entries: string[] = [];
  try {
    const glob = new Bun.Glob("*.json");
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
      entries.push(rel);
    }
  } catch {
    return out; // no directory — nothing to load
  }
  for (const rel of entries) {
    const locale = rel
      .replace(/\.json$/, "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()!;
    try {
      out[locale] = (await Bun.file(`${dir}/${rel}`).json()) as Messages;
    } catch (err) {
      throw new CatalogLoadError(`${dir}/${rel}`, err);
    }
  }
  return out;
}
