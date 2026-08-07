import { basePath } from "zerotal";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One symbol link in the API sidebar. */
export interface ApiNavItem {
  name: string;
  slug: string;
}
/** A symbol-kind group within a module (e.g. "Classes"). */
export interface ApiNavSection {
  label: string;
  items: ApiNavItem[];
}
/** An export entry point; `label` is "" for a single-entry package's root. */
export interface ApiNavModule {
  label: string;
  slug: string;
  sections: ApiNavSection[];
}
export interface ApiNavPackage {
  name: string;
  slug: string;
  modules: ApiNavModule[];
}
export interface ApiNav {
  packages: ApiNavPackage[];
}

const NAV_PATH = join(basePath("/"), "../../docs/api/nav.json");

let _cache: ApiNav | null | undefined;

/**
 * Load the generated API sidebar tree (`docs/api/nav.json`), or `null` when it
 * hasn't been built. Read once and cached for the process; `bun run docs:api`
 * regenerates the file, and the dev server is restarted to pick it up.
 */
export function loadApiNav(): ApiNav | null {
  if (_cache !== undefined) return _cache;
  try {
    // Synchronous read: the sidebar renders synchronously and this runs once.
    _cache = JSON.parse(readFileSync(NAV_PATH, "utf8")) as ApiNav;
  } catch {
    _cache = null;
  }
  return _cache;
}
