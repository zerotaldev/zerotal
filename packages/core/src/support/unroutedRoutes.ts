/**
 * Unrouted `routes/` directory check.
 *
 * A conventional `routes/index.ts` full of `Router.get(...)` calls does nothing
 * until a `routing()` group imports it — the file typechecks, the calls would
 * execute cleanly, and every path in it 404s in a way that is indistinguishable
 * from a typo'd URL. The scaffold wires only `fileBasedRouting()`, so "I made a
 * routes file" and "it needs registering" are otherwise never connected.
 */
import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * A warning message when `<root>/routes` holds route files that no `routing()`
 * group loads, or `null` when the directory is absent, empty, or covered.
 */
export function unroutedRoutesWarning(root: string, routedFiles: string[]): string | null {
  const dir = resolve(root, "routes");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f) && !/\.test\.(ts|js)$/.test(f));
  } catch {
    return null; // no routes/ directory — nothing to warn about
  }
  if (files.length === 0) return null;
  const insideDir = (file: string) => {
    const normalized = resolve(file);
    return normalized === dir || normalized.startsWith(dir + sep);
  };
  if (routedFiles.some(insideDir)) return null;
  const suggestion = files.includes("index.ts") ? "index.ts" : files[0];
  return (
    `routes/ contains ${files.join(", ")} but no routing() group loads it — ` +
    `every route in it will 404. Add .routing("./routes/${suggestion}") to your ` +
    `Application, or remove the directory.`
  );
}
