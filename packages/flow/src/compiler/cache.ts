/**
 * .zerotal/compiled/ disk cache for compiled render functions.
 *
 * Cache key: Bun.hash(sourceContent).toString(16)
 * Cache entry: .zerotal/compiled/<hash>.js
 *
 * On a cache hit the compiled file is imported directly.
 * On a miss the caller compiles, calls setCached, then imports the returned path.
 *
 * Beside the compiled files sits one small manifest per page (`<key>.json`, see
 * {@link lookupManifest}). It records how the page's last compile came out and what it was
 * computed from, so that a boot where nothing changed can be served without parsing a single page,
 * which is to say without loading the TypeScript parser at all.
 */

import { join } from "node:path";
import { mkdir, unlink, readdir } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { staticImportsUnchanged, type StaticImport } from "./static-imports.ts";

const COMPILED_DIR_NAME = join(".zerotal", "compiled");

/**
 * Cache version — a fingerprint of the COMPILER'S OWN SOURCE, computed once per process.
 *
 * This used to be a hand-bumped constant, which was a silent-staleness footgun: change the
 * emit logic (or upgrade the package) without bumping it, and every page whose own source
 * hadn't changed kept serving a compile from the OLD compiler — surviving server restarts,
 * because the cache lives on disk. Deriving it from the compiler sources means any emit
 * change invalidates every entry automatically, with nothing to remember.
 *
 * Falls back to a constant if the sources can't be read (e.g. an exotic bundled deploy).
 */
const COMPILER_VERSION: string = (() => {
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const parts = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "cache.ts")
      .sort()
      .map((f) => String(Bun.hash(readFileSync(join(dir, f), "utf8"))));
    return parts.length > 0 ? `s${Bun.hash(parts.join("|"))}` : "4";
  } catch {
    return "4";
  }
})();

function _cacheDir(appRoot: string): string {
  return join(appRoot, COMPILED_DIR_NAME);
}

function _hashSource(source: string, cspSafe = false, variant = ""): string {
  // Bun.hash returns a number or bigint depending on input type.
  // Using String() avoids any ambiguity. The cspSafe marker keeps CSP and
  // default builds in separate cache entries (their emitted output differs).
  // `variant` is the digest of whatever else the output was built from (constants read out of
  // other files); empty for a page that used none, which keeps the key it always had.
  return String(
    Bun.hash(
      COMPILER_VERSION + (cspSafe ? "csp:" : "") + (variant ? `with:${variant}:` : "") + source,
    ),
  );
}

/** Returns the cached compiled file path if up-to-date, otherwise null. */
export function getCachedPath(
  source: string,
  appRoot: string,
  cspSafe = false,
  ext = "ts",
  variant = "",
): string | null {
  const hash = _hashSource(source, cspSafe, variant);
  const path = join(_cacheDir(appRoot), `${hash}.${ext}`);
  return existsSync(path) ? path : null;
}

/**
 * Write a compiled render function to the cache and return its absolute path.
 * Creates the cache directory if it doesn't exist.
 */
export async function writeCache(
  source: string,
  compiledCode: string,
  sourceFile: string,
  appRoot: string,
  cspSafe = false,
  ext = "ts",
  variant = "",
): Promise<string> {
  const dir = _cacheDir(appRoot);
  await mkdir(dir, { recursive: true });

  const hash = _hashSource(source, cspSafe, variant);
  const outPath = join(dir, `${hash}.${ext}`);
  const header = `// @flow-compiled\n// Source: ${sourceFile}\n// Hash: ${hash}\n\n`;

  await Bun.write(outPath, header + compiledCode);
  return outPath;
}

// ── Manifest ─────────────────────────────────────────────────────────────────

/**
 * How a page's compile came out:
 * - `compiled`: an AOT render, in `<key>.ts`;
 * - `injected`: the runtime render with its bindings named, in `<key>.tsx`;
 * - `runtime`: neither, the page renders through the runtime untouched.
 */
export type CompileOutcome = "compiled" | "injected" | "runtime";

/** Bumped whenever the shape below changes; an entry of another version is a miss. */
const MANIFEST_VERSION = 1;

interface ManifestEntry {
  v: number;
  sourceFile: string;
  outcome: CompileOutcome;
  /** The `variant` the compiled file was keyed with ({@link getCachedPath}). */
  variant: string;
  imports: StaticImport[];
}

/**
 * One manifest per page, keyed on everything the page's compile reads from the page itself: the
 * compiler's own source, the CSP mode, the page's path (the output resolves the page's relative
 * imports against it) and its text. What the compile reads from other files is in the entry.
 */
function _manifestPath(
  source: string,
  sourceFile: string,
  appRoot: string,
  cspSafe: boolean,
): string {
  const key = String(
    Bun.hash(`${COMPILER_VERSION}${cspSafe ? "csp:" : ""}page:${sourceFile}\0${source}`),
  );
  return join(_cacheDir(appRoot), `${key}.json`);
}

/**
 * The outcome of this page's last compile, when it is still exactly what compiling it now would
 * give, or `null` when it has to be compiled (or validated) again.
 *
 * An entry is only ever written after the page passed validation and compiled without error, and
 * both depend on nothing but the page's text and the constants it imports. The key covers the
 * first; for the second, every relative import the page read constants through must still resolve
 * to the same file, holding the same text. Anything else (no entry, an unreadable one, a compiled
 * file that has gone) is a miss, and the caller does what it did before this existed.
 *
 * Returns the compiled file to import, or `null` for a page that renders through the runtime.
 */
export function lookupManifest(
  source: string,
  sourceFile: string,
  appRoot: string,
  cspSafe: boolean,
): { outcome: CompileOutcome; path: string | null } | null {
  let entry: ManifestEntry;
  try {
    entry = JSON.parse(readFileSync(_manifestPath(source, sourceFile, appRoot, cspSafe), "utf8"));
  } catch {
    return null;
  }
  if (
    entry?.v !== MANIFEST_VERSION ||
    entry.sourceFile !== sourceFile ||
    !Array.isArray(entry.imports) ||
    typeof entry.variant !== "string"
  ) {
    return null;
  }
  if (!staticImportsUnchanged(sourceFile, entry.imports)) return null;

  switch (entry.outcome) {
    case "compiled": {
      const path = getCachedPath(source, appRoot, cspSafe, "ts", entry.variant);
      return path ? { outcome: "compiled", path } : null;
    }
    case "injected": {
      const path = getCachedPath(source, appRoot, cspSafe, "tsx");
      return path ? { outcome: "injected", path } : null;
    }
    case "runtime":
      return { outcome: "runtime", path: null };
    default:
      return null;
  }
}

/**
 * Record how a page compiled, for {@link lookupManifest}. Never throws: a manifest that cannot be
 * written costs the next boot a parse, and nothing else.
 */
export async function writeManifest(
  source: string,
  sourceFile: string,
  appRoot: string,
  cspSafe: boolean,
  outcome: CompileOutcome,
  variant: string,
  imports: StaticImport[],
): Promise<void> {
  const entry: ManifestEntry = { v: MANIFEST_VERSION, sourceFile, outcome, variant, imports };
  try {
    await mkdir(_cacheDir(appRoot), { recursive: true });
    await Bun.write(_manifestPath(source, sourceFile, appRoot, cspSafe), JSON.stringify(entry));
  } catch {
    // The cache directory is not writable (a read-only deploy); every boot compiles, as before.
  }
}

/**
 * Clear all compiled cache entries.
 * Called by the dev server on full restart or when flow itself is updated.
 */
export async function clearCache(appRoot: string): Promise<void> {
  const dir = _cacheDir(appRoot);
  if (!existsSync(dir)) return;
  const files = await readdir(dir);
  await Promise.all(
    files
      .filter((f) => /\.(js|ts|tsx|json)$/.test(f))
      .map((f) => unlink(join(dir, f)).catch(() => undefined)),
  );
}
