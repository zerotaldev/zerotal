/**
 * .zerotal/compiled/ disk cache for compiled render functions.
 *
 * Cache key: Bun.hash(sourceContent).toString(16)
 * Cache entry: .zerotal/compiled/<hash>.js
 *
 * On a cache hit the compiled file is imported directly.
 * On a miss the caller compiles, calls setCached, then imports the returned path.
 */

import { join } from "node:path";
import { mkdir, unlink, readdir } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

function _hashSource(source: string, cspSafe = false): string {
  // Bun.hash returns a number or bigint depending on input type.
  // Using String() avoids any ambiguity. The cspSafe marker keeps CSP and
  // default builds in separate cache entries (their emitted output differs).
  return String(Bun.hash(COMPILER_VERSION + (cspSafe ? "csp:" : "") + source));
}

/** Returns the cached compiled file path if up-to-date, otherwise null. */
export function getCachedPath(
  source: string,
  appRoot: string,
  cspSafe = false,
  ext = "ts",
): string | null {
  const hash = _hashSource(source, cspSafe);
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
): Promise<string> {
  const dir = _cacheDir(appRoot);
  await mkdir(dir, { recursive: true });

  const hash = _hashSource(source, cspSafe);
  const outPath = join(dir, `${hash}.${ext}`);
  const header = `// @flow-compiled\n// Source: ${sourceFile}\n// Hash: ${hash}\n\n`;

  await Bun.write(outPath, header + compiledCode);
  return outPath;
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
      .filter((f) => f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => unlink(join(dir, f)).catch(() => undefined)),
  );
}
