#!/usr/bin/env bun
/**
 * Documentation coverage per package, gated on a recorded baseline — the fourth
 * ratchet alongside `lint:ci`, `cast:check` and `typecheck:tests`.
 *
 * A package's `maturity` is a promise about its exports: `stable` means every
 * one of them keeps its shape for the rest of the 1.x line. A promise over a
 * surface nobody has written down is not a promise anyone can use, and nothing
 * failed when an export was added without a word of documentation — so the gap
 * only ever grew, one merge at a time.
 *
 * This fails CI when a *promised* export appears in no `docs/` page.
 *
 *   bun run scripts/docs-coverage.ts            # check against the baseline
 *   bun run scripts/docs-coverage.ts --list     # also print every gap
 *   bun run scripts/docs-coverage.ts --update   # (re)write the baseline
 *
 * ## What counts as promised
 *
 * The export set comes from each package's `exports` map, resolved through the
 * TypeScript checker — the same way `api-surface.ts` does it. But `api-surface.md`
 * is a mechanical record of *every* export and does not filter `@internal`, so it
 * is the wrong input here: it would count plumbing that leaked out of a module
 * because something else needed it. The promise is computed from the source
 * instead, and an `@internal` marker on the declaration removes an export from it.
 *
 * ## Three ways to get this number wrong
 *
 * Each of these produced a plausible figure that was simply false, so each is
 * handled deliberately rather than left to chance:
 *
 * 1. **Search doc content, not paths.** `flow-ui` looked undocumented because its
 *    page is `docs/components.md`, not `docs/flow-ui/`. The corpus here is every
 *    markdown file's *text*.
 * 2. **Don't count the generated reference.** `docs/api/**` is typedoc output
 *    built from the very docblocks being measured, so including it would mark
 *    every export documented and the gate would be permanently green. Excluded.
 * 3. **Don't miss the return types of documented factories.** `Section`, `Stat`
 *    and `Tab` are never named in prose because the documented `section()`,
 *    `stat()` and `tab()` return them — a name-only check overstated admin's gap
 *    by 15. A type that is the return type of a documented callable is covered.
 */
import ts from "typescript";
import { Glob } from "bun";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGES_DIR = "packages";
const BASELINE_FILE = "docs-coverage-baseline.json";

/** Export subpaths that are runtime shims / assets, not part of the typed API. */
const SKIP_SUBPATHS = new Set(["./jsx-runtime", "./jsx-dev-runtime"]);
/**
 * Not measured here.
 *
 * `create-zerotal` is a scaffolder, not an importable library, so it promises
 * nothing to document. `zerotal` is the meta-package: every symbol it exposes is
 * re-exported from a package that is measured on its own, so counting it again
 * would double the total and let one package's gap be reported twice — as a
 * regression in two places, and as an improvement in two places.
 */
const SKIP_PACKAGES = new Set(["create-zerotal", "zerotal"]);
/**
 * Subpaths whose whole purpose is to sit outside the stability guarantee.
 * `@zerotal/media/testing` says so in its own module docblock; the same applies
 * to every package's test seam.
 */
const UNPROMISED_SUBPATHS = new Set(["./testing"]);

const shouldUpdate = process.argv.includes("--update");
const shouldList = process.argv.includes("--list");

interface Baseline {
  /** Package name → permitted count of undocumented exports (the ratchet). */
  packages: Record<string, number>;
  total: number;
  updatedAt: string;
}

interface PackageJson {
  name?: string;
  maturity?: string;
  exports?: string | Record<string, unknown>;
}

// ── The documentation corpus ────────────────────────────────────────────────────

/**
 * Every hand-written docs page, as one blob of text.
 *
 * `docs/api/**` is deliberately absent — see trap 2 in the header. It is typedoc
 * output generated from the docblocks this script measures, so counting it would
 * mean every export documents itself.
 */
function docsCorpus(): string {
  const parts: string[] = [];
  for (const file of new Glob("docs/**/*.md").scanSync(process.cwd())) {
    const path = file.replace(/\\/g, "/");
    if (path.startsWith("docs/api/")) continue;
    parts.push(readFileSync(file, "utf8"));
  }
  return parts.join("\n");
}

/** Names the corpus mentions, as whole words. Built once; membership is O(1). */
function mentionedNames(corpus: string): Set<string> {
  return new Set(corpus.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []);
}

// ── Package discovery (same resolution as scripts/api-surface.ts) ───────────────

interface Entry {
  subpath: string;
  file: string;
  abs: string;
}
interface PackageEntry {
  dir: string;
  name: string;
  maturity: string;
  entries: Entry[];
}

function exportEntries(exports: PackageJson["exports"]): Array<[string, string]> {
  if (!exports) return [];
  const raw: Array<[string, unknown]> =
    typeof exports === "string" ? [[".", exports]] : Object.entries(exports);

  const out: Array<[string, string]> = [];
  for (const [subpath, target] of raw) {
    if (SKIP_SUBPATHS.has(subpath) || UNPROMISED_SUBPATHS.has(subpath)) continue;
    const value =
      typeof target === "string"
        ? target
        : ((target as Record<string, string> | null)?.["types"] ??
          (target as Record<string, string> | null)?.["import"] ??
          (target as Record<string, string> | null)?.["default"]);
    if (typeof value !== "string" || !/\.(ts|tsx)$/.test(value)) continue;
    out.push([subpath, value]);
  }
  return out;
}

function collectPackages(): PackageEntry[] {
  const packages: PackageEntry[] = [];
  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    if (SKIP_PACKAGES.has(dir)) continue;
    const pkgPath = join(PACKAGES_DIR, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    const entries = exportEntries(pkg.exports)
      .map(([subpath, file]) => ({ subpath, file, abs: resolve(PACKAGES_DIR, dir, file) }))
      .filter((e) => existsSync(e.abs))
      .sort((a, b) => a.subpath.localeCompare(b.subpath));
    if (entries.length === 0) continue;
    packages.push({
      dir,
      name: pkg.name ?? dir,
      maturity: pkg.maturity ?? "unknown",
      entries,
    });
  }
  return packages;
}

function analysisOptions(): ts.CompilerOptions {
  const { config } = ts.readConfigFile(resolve("tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config ?? {}, ts.sys, resolve("."));
  return {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    composite: false,
    incremental: false,
    skipLibCheck: true,
  };
}

// ── The promise ─────────────────────────────────────────────────────────────────

/** True when the declaration (or the alias that re-exports it) is marked `@internal`. */
function isInternal(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  const seen = new Set<ts.Symbol>();
  let current: ts.Symbol | undefined = symbol;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.getJsDocTags(checker).some((t) => t.name === "internal")) return true;
    for (const decl of current.getDeclarations() ?? []) {
      if (ts.getJSDocTags(decl).some((t) => t.tagName.text === "internal")) return true;
    }
    current = current.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(current) : undefined;
  }
  return false;
}

/**
 * Type names a callable hands back, including through `Promise<T>`, `T[]` and
 * unions — trap 3. A documented factory documents what it returns.
 */
function returnedTypeNames(type: ts.Type, checker: ts.TypeChecker): Set<string> {
  const names = new Set<string>();
  const walk = (t: ts.Type, depth: number): void => {
    if (depth > 4) return;
    const name = t.aliasSymbol?.name ?? t.getSymbol()?.name;
    if (name && name !== "__type") names.add(name);
    for (const arg of checker.getTypeArguments(t as ts.TypeReference) ?? []) walk(arg, depth + 1);
    if (t.isUnionOrIntersection()) for (const part of t.types) walk(part, depth + 1);
  };
  for (const signature of type.getCallSignatures()) {
    walk(signature.getReturnType(), 0);
  }
  for (const signature of type.getConstructSignatures()) {
    walk(signature.getReturnType(), 0);
  }
  return names;
}

interface Gap {
  pkg: string;
  subpath: string;
  name: string;
}

function main(): void {
  const corpus = docsCorpus();
  const mentioned = mentionedNames(corpus);
  const packages = collectPackages();

  const rootFiles = packages.flatMap((p) => p.entries.map((e) => e.abs));
  const program = ts.createProgram(rootFiles, analysisOptions());
  const checker = program.getTypeChecker();

  const results: Array<{ pkg: PackageEntry; promised: number; gaps: Gap[] }> = [];

  for (const pkg of packages) {
    const promisedNames: Array<{ subpath: string; name: string; symbol: ts.Symbol }> = [];
    for (const entry of pkg.entries) {
      const source = program.getSourceFile(entry.abs);
      const moduleSymbol = source && checker.getSymbolAtLocation(source);
      for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
        if (isInternal(symbol, checker)) continue;
        promisedNames.push({ subpath: entry.subpath, name: symbol.name, symbol });
      }
    }

    // Pass 1 — named in a docs page.
    const documented = new Set(
      promisedNames.filter((e) => mentioned.has(e.name)).map((e) => e.name),
    );

    // Pass 2 — trap 3: returned by something already documented.
    for (const entry of promisedNames) {
      if (!documented.has(entry.name)) continue;
      const decl = entry.symbol.getDeclarations()?.[0];
      if (!decl) continue;
      const resolved =
        entry.symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(entry.symbol)
          : entry.symbol;
      const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
      for (const name of returnedTypeNames(type, checker)) documented.add(name);
    }

    const gaps = promisedNames
      .filter((e) => !documented.has(e.name))
      .map((e) => ({ pkg: pkg.name, subpath: e.subpath, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    results.push({ pkg, promised: promisedNames.length, gaps });
  }

  results.sort((a, b) => b.gaps.length - a.gaps.length || a.pkg.name.localeCompare(b.pkg.name));

  const totalPromised = results.reduce((n, r) => n + r.promised, 0);
  const totalGaps = results.reduce((n, r) => n + r.gaps.length, 0);

  for (const { pkg, promised, gaps } of results) {
    if (gaps.length === 0) continue;
    const pct = promised === 0 ? 100 : Math.round(((promised - gaps.length) / promised) * 100);
    console.log(
      `${String(gaps.length).padStart(4)}  ${pkg.name.padEnd(24)} ${pct}% of ${promised}`,
    );
    if (shouldList) {
      for (const gap of gaps) console.log(`        ${gap.subpath} ${gap.name}`);
    }
  }

  const covered = totalPromised - totalGaps;
  const pct = totalPromised === 0 ? 100 : Math.round((covered / totalPromised) * 100);
  console.log(
    `\nDocs coverage: ${covered}/${totalPromised} promised exports documented (${pct}%), ` +
      `${totalGaps} gap(s) across ${results.filter((r) => r.gaps.length > 0).length} package(s).`,
  );
  if (!shouldList && totalGaps > 0) console.log("Run with --list to see every gap.");

  const current: Record<string, number> = {};
  for (const { pkg, gaps } of results) if (gaps.length > 0) current[pkg.name] = gaps.length;

  if (shouldUpdate || !existsSync(BASELINE_FILE)) {
    const baseline: Baseline = {
      packages: Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))),
      total: totalGaps,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\x1b[32m✓\x1b[0m Baseline written to ${BASELINE_FILE}: ${totalGaps}.`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
  console.log(`Baseline: ${baseline.total}.`);

  // Per package, not just on the total: a package that documents ten exports
  // does not buy another package the right to add ten undocumented ones.
  const regressions: string[] = [];
  for (const [name, count] of Object.entries(current)) {
    const allowed = baseline.packages[name] ?? 0;
    if (count > allowed) regressions.push(`${name} ${count} > ${allowed}`);
  }

  if (regressions.length > 0) {
    console.error(
      `\x1b[31m✖\x1b[0m Docs coverage regressed: ${regressions.join("; ")}.\n` +
        `Document the new exports, mark them \`@internal\` if they are plumbing, or ` +
        `rerun with --update if the baseline should genuinely move.`,
    );
    process.exit(1);
  }

  if (totalGaps < baseline.total) {
    console.log(
      `\x1b[33m↓\x1b[0m Below baseline (${totalGaps} ≤ ${baseline.total}). ` +
        `Run \`bun run docs:coverage --update\` to lock in the improvement.`,
    );
  }
  console.log(`\x1b[32m✓\x1b[0m within baseline.`);
}

main();
