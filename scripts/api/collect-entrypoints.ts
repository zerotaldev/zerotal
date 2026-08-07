/**
 * Generate TypeDoc entry points from each package's `exports` map, so the
 * API reference documents exactly the public surface consumers can import —
 * and stays in lock-step automatically when a subpath is added or removed.
 *
 * For every workspace package it writes `packages/<pkg>/typedoc.json` whose
 * `entryPoints` are the `.ts`/`.tsx` targets of that package's `exports` map
 * (runtime shims and non-source assets filtered out). It then writes the root
 * `typedoc.json` (extending `typedoc.base.json`) listing every documentable
 * package directory for TypeDoc's "packages" strategy.
 *
 * Run via `bun run scripts/api/collect-entrypoints.ts` (or the `docs:api`
 * pipeline). Idempotent — safe to re-run; the generated files are build
 * artifacts.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = "packages";

/** Export subpaths that are runtime shims / assets, not documentable API. */
const SKIP_SUBPATHS = new Set(["./jsx-runtime", "./jsx-dev-runtime"]);

/** Packages that are not importable libraries (CLIs, scaffolders). */
const SKIP_PACKAGES = new Set(["create-zerotal"]);

interface PackageJson {
  name?: string;
  private?: boolean;
  exports?: string | Record<string, unknown>;
}

/** Resolve an `exports` map to the list of documentable source files. */
function exportsToEntryPoints(exports: PackageJson["exports"]): string[] {
  if (!exports) return [];
  const entries: Array<[string, unknown]> =
    typeof exports === "string" ? [[".", exports]] : Object.entries(exports);

  const files: string[] = [];
  for (const [subpath, target] of entries) {
    if (SKIP_SUBPATHS.has(subpath)) continue;
    // Conditional export objects ({ import, types, default }) — take a source path.
    const value =
      typeof target === "string"
        ? target
        : ((target as Record<string, string> | null)?.["types"] ??
          (target as Record<string, string> | null)?.["import"] ??
          (target as Record<string, string> | null)?.["default"]);
    if (typeof value !== "string") continue;
    if (!/\.(ts|tsx)$/.test(value)) continue; // skip .css and other assets
    files.push(value.startsWith("./") ? value : `./${value}`);
  }
  // De-dupe while preserving order (a file may back several subpaths).
  return [...new Set(files)];
}

function main(): void {
  const documentable: string[] = [];

  for (const dir of readdirSync(PACKAGES_DIR)) {
    if (SKIP_PACKAGES.has(dir)) continue;
    const pkgPath = join(PACKAGES_DIR, dir, "package.json");
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    const entryPoints = exportsToEntryPoints(pkg.exports);
    if (entryPoints.length === 0) {
      console.warn(`[api] ${pkg.name ?? dir}: no documentable exports, skipping`);
      continue;
    }

    const tsconfig = existsSync(join(PACKAGES_DIR, dir, "tsconfig.json"))
      ? "./tsconfig.json"
      : undefined;

    const config: Record<string, unknown> = {
      // Each package resolves its own entry files under its own tsconfig; this
      // is what keeps a per-package tsconfig from being ignored (the warning
      // seen when a shared tsconfig didn't `include` another package's files).
      entryPointStrategy: "resolve",
      entryPoints,
      ...(tsconfig ? { tsconfig } : {}),
    };

    writeFileSync(join(PACKAGES_DIR, dir, "typedoc.json"), JSON.stringify(config, null, 2) + "\n");
    documentable.push(`${PACKAGES_DIR}/${dir}`);
    console.log(`[api] ${pkg.name ?? dir}: ${entryPoints.length} entry point(s)`);
  }

  documentable.sort();

  const root = {
    extends: "./typedoc.base.json",
    entryPointStrategy: "packages",
    entryPoints: documentable,
  };
  writeFileSync("typedoc.json", JSON.stringify(root, null, 2) + "\n");
  console.log(`[api] wrote typedoc.json with ${documentable.length} packages`);
}

main();
