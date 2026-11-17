/**
 * The parts of reading constants out of other files that need no syntax tree: finding the file a
 * relative import names, and digesting what was read. `constants.ts` does the parsing; the compile
 * cache uses these on their own, to check a cached page without loading the TypeScript parser.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Names mapped to the string they are known to hold. */
export type StaticStrings = ReadonlyMap<string, string>;

/**
 * A relative import a page's compile read constants through: the specifier as written, the file
 * it resolved to (`null` when none did), and a digest of that file's text (`null` when it could
 * not be read). Together they are everything the constants a page sees are computed from.
 */
export interface StaticImport {
  specifier: string;
  file: string | null;
  digest: string | null;
}

/** Resolve a relative import specifier to the TypeScript file it names, if there is one. */
export function resolveRelativeModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    // `import … from "../ui.js"` is how ESM TypeScript spells a .ts file.
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
  ];
  return candidates.find((candidate) => {
    if (!/\.(ts|tsx)$/.test(candidate) || !existsSync(candidate)) return false;
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** The text of `file` as the constants reader sees it, or `null` when it cannot be read. */
export function readModuleText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** A digest of a module's text, for {@link StaticImport.digest}. */
export function moduleDigest(text: string | null): string | null {
  return text === null ? null : String(Bun.hash(text));
}

/**
 * Whether every import in `imports` still resolves to the same file, holding the same text, as
 * when it was recorded. When it does, the constants read through them are the same as well.
 */
export function staticImportsUnchanged(
  fromFile: string,
  imports: readonly StaticImport[],
): boolean {
  for (const recorded of imports) {
    const file = resolveRelativeModule(fromFile, recorded.specifier) ?? null;
    if (file !== recorded.file) return false;
    if (file !== null && moduleDigest(readModuleText(file)) !== recorded.digest) return false;
  }
  return true;
}

/**
 * A short digest of the values a page's compile depended on, for the cache key. Empty when the
 * page uses none, so such a page keeps the key it always had.
 */
export function staticStringsFingerprint(strings: StaticStrings): string {
  if (strings.size === 0) return "";
  const entries = [...strings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return String(Bun.hash(JSON.stringify(entries)));
}
