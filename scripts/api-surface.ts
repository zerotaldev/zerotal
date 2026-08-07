#!/usr/bin/env bun
/**
 * Per-package public-API surface snapshots — the cheap insurance policy for a
 * source-distributed framework.
 *
 * Because Zerotal ships `src/*.ts` (no `.d.ts` shield), the *entire* source is the
 * type-level API: a renamed internal type or a narrowed generic silently breaks
 * a downstream `tsc` even when runtime behaviour is identical. This script
 * extracts every package's public export — names, kinds, and full type
 * signatures (including class members) — into a committed
 * `packages/<pkg>/api-surface.md`. CI runs it with `--check`, so any change to
 * the type surface becomes a reviewed diff, not an accident.
 *
 *   bun run scripts/api-surface.ts            # regenerate snapshots (write)
 *   bun run scripts/api-surface.ts --check    # fail if any snapshot is stale
 *
 * The report is generalised from the `index.barrel.test.ts` idea (which freezes
 * only the runtime names of core's lean kernel) to the full typed surface of
 * every package.
 */
import ts from "typescript";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGES_DIR = "packages";
const SNAPSHOT_FILE = "api-surface.md";

/** Export subpaths that are runtime shims / assets, not part of the typed API. */
const SKIP_SUBPATHS = new Set(["./jsx-runtime", "./jsx-dev-runtime"]);
/** Packages that are not importable libraries (CLIs, scaffolders). */
const SKIP_PACKAGES = new Set(["create-zerotal"]);
/** Static members inherited from `Function` that appear on every class constructor — noise. */
const FUNCTION_STATICS = new Set([
  "length",
  "name",
  "prototype",
  "apply",
  "call",
  "bind",
  "arguments",
  "caller",
  "toString",
]);

const TYPE_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType |
  ts.TypeFormatFlags.MultilineObjectLiterals;

interface PackageJson {
  name?: string;
  private?: boolean;
  exports?: string | Record<string, unknown>;
}

/** Resolve an `exports` map to `[subpath, sourceFile]` pairs for the typed API. */
function exportEntries(exports: PackageJson["exports"]): Array<[string, string]> {
  if (!exports) return [];
  const raw: Array<[string, unknown]> =
    typeof exports === "string" ? [[".", exports]] : Object.entries(exports);

  const out: Array<[string, string]> = [];
  for (const [subpath, target] of raw) {
    if (SKIP_SUBPATHS.has(subpath)) continue;
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

/** Every documentable package, its entry subpaths, and the resolved source files. */
interface PackageEntry {
  dir: string;
  name: string;
  entries: Array<{ subpath: string; file: string; abs: string }>;
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
    packages.push({ dir, name: pkg.name ?? dir, entries });
  }
  return packages;
}

/** Compiler options for analysis — mirror the repo's, but analyse-only (no emit). */
function analysisOptions(): ts.CompilerOptions {
  const configPath = resolve("tsconfig.json");
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config ?? {}, ts.sys, resolve("."));
  return {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    composite: false,
    incremental: false,
    skipLibCheck: true,
  };
}

/** The declaration kind of an export, as printed in the report. */
function kindOf(symbol: ts.Symbol): string {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.Class) return "class";
  if (f & ts.SymbolFlags.Interface) return "interface";
  if (f & ts.SymbolFlags.TypeAlias) return "type";
  if (f & (ts.SymbolFlags.RegularEnum | ts.SymbolFlags.ConstEnum)) return "enum";
  if (f & ts.SymbolFlags.Function) return "function";
  if (f & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)) return "namespace";
  if (f & ts.SymbolFlags.Variable) return "const";
  return "value";
}

/** True when every declaration of a member lives in `node_modules` (a lib/@types member — inherited noise). */
function isLibDeclared(prop: ts.Symbol): boolean {
  const decls = prop.declarations;
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => /[\\/]node_modules[\\/]/.test(d.getSourceFile().fileName));
}

function isHiddenMember(prop: ts.Symbol): boolean {
  if (prop.name === "prototype" || prop.name.startsWith("#")) return true;
  if (isLibDeclared(prop)) return true; // Error/Function/Object members etc.
  const decl = prop.valueDeclaration ?? prop.declarations?.[0];
  if (!decl) return false;
  const mod = ts.getCombinedModifierFlags(decl);
  return (mod & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
}

/**
 * The printable name of a member.
 *
 * A member keyed by a unique symbol is named `__@<symbol>@<id>` internally, where
 * `<id>` is TypeScript's per-program symbol counter. That counter shifts whenever
 * anything earlier in the program gains or loses a declaration, so leaving it in
 * makes one package's snapshot churn because an unrelated package changed —
 * enough to fail `--check` on a diff that altered no API at all.
 */
function memberName(prop: ts.Symbol): string {
  return prop.name.replace(/^(__@.+)@\d+$/, "$1");
}

function memberLine(checker: ts.TypeChecker, prop: ts.Symbol, node: ts.Node): string {
  const decl = prop.valueDeclaration ?? prop.declarations?.[0];
  const mod = decl ? ts.getCombinedModifierFlags(decl) : 0;
  const readonly = mod & ts.ModifierFlags.Readonly ? "readonly " : "";
  const optional = prop.flags & ts.SymbolFlags.Optional ? "?" : "";
  const type = checker.getTypeOfSymbolAtLocation(prop, decl ?? node);
  return `${readonly}${memberName(prop)}${optional}: ${checker.typeToString(type, node, TYPE_FLAGS)}`;
}

/** Sorted call/construct/index signatures + own properties of an object-like type, or null when empty. */
function renderObjectBody(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.Node | undefined,
  extraStatics: ts.Type | undefined = undefined,
): string | null {
  const lines: string[] = [];

  for (const sig of type.getCallSignatures()) {
    lines.push(`  ${checker.signatureToString(sig, node, TYPE_FLAGS)}`);
  }
  for (const sig of type.getConstructSignatures()) {
    lines.push(`  new ${checker.signatureToString(sig, node, TYPE_FLAGS)}`);
  }
  const strIndex = type.getStringIndexType();
  if (strIndex) lines.push(`  [key: string]: ${checker.typeToString(strIndex, node, TYPE_FLAGS)}`);
  const numIndex = type.getNumberIndexType();
  if (numIndex)
    lines.push(`  [index: number]: ${checker.typeToString(numIndex, node, TYPE_FLAGS)}`);

  const own = type
    .getProperties()
    .filter((p) => !isHiddenMember(p))
    .map((p) => `  ${node ? memberLine(checker, p, node) : p.name}`);

  // Static side (classes only): construct signatures + static members.
  const statics: string[] = [];
  if (extraStatics) {
    for (const sig of extraStatics.getConstructSignatures()) {
      statics.push(`  new ${checker.signatureToString(sig, node, TYPE_FLAGS)}`);
    }
    for (const p of extraStatics.getProperties()) {
      if (FUNCTION_STATICS.has(p.name) || isHiddenMember(p)) continue;
      statics.push(`  static ${node ? memberLine(checker, p, node) : memberName(p)}`);
    }
  }

  const all = [...statics.sort(), ...lines.sort(), ...own.sort()];
  return all.length ? all.join("\n") : null;
}

/** The rendered signature for one exported symbol. */
function renderExport(checker: ts.TypeChecker, exportName: string, symbol: ts.Symbol): string {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const kind = kindOf(resolved);
  const decl = resolved.declarations?.[0] ?? resolved.valueDeclaration;

  let signature: string;
  if (kind === "class") {
    const staticType = decl ? checker.getTypeOfSymbolAtLocation(resolved, decl) : undefined;
    const body = renderObjectBody(
      checker,
      checker.getDeclaredTypeOfSymbol(resolved),
      decl,
      staticType,
    );
    signature = body ? `{\n${body}\n}` : "{}";
  } else if (kind === "interface") {
    const body = renderObjectBody(checker, checker.getDeclaredTypeOfSymbol(resolved), decl);
    signature = body ? `{\n${body}\n}` : "{}";
  } else if (kind === "type") {
    const type = checker.getDeclaredTypeOfSymbol(resolved);
    signature = checker.typeToString(type, decl, TYPE_FLAGS | ts.TypeFormatFlags.InTypeAlias);
  } else if (decl) {
    const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
    signature = checker.typeToString(type, decl, TYPE_FLAGS);
  } else {
    signature = "unknown";
  }

  return `${kind} ${exportName} = ${signature}`;
}

/**
 * Strip machine-specific noise so the snapshot is byte-identical across checkouts:
 * TypeScript prints out-of-scope types as `import("<abs path>").Name` — drop the
 * wrapper and keep the bare type name.
 */
function normalize(text: string): string {
  return text.replace(/import\((?:"[^"]*"|'[^']*')\)\./g, "");
}

/** Render one package's full snapshot (all subpaths). */
function renderPackage(program: ts.Program, checker: ts.TypeChecker, pkg: PackageEntry): string {
  const sections: string[] = [];
  for (const entry of pkg.entries) {
    const source = program.getSourceFile(entry.abs);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const lines = exports
      .map((sym) => renderExport(checker, sym.name, sym))
      .sort((a, b) => a.localeCompare(b));
    const heading = `## ${entry.subpath}  \`(${entry.file})\``;
    sections.push(`${heading}\n\n${lines.length ? lines.join("\n\n") : "_(no exports)_"}`);
  }

  return normalize(
    `# ${pkg.name} — public API surface\n\n` +
      `<!-- AUTO-GENERATED by scripts/api-surface.ts. Do not edit by hand.\n` +
      `     Run \`bun run api:surface\` to regenerate after an intentional API change. -->\n\n` +
      sections.join("\n\n") +
      "\n",
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

const check = process.argv.includes("--check");
const packages = collectPackages();

const rootFiles = packages.flatMap((p) => p.entries.map((e) => e.abs));
const program = ts.createProgram(rootFiles, analysisOptions());
const checker = program.getTypeChecker();

const stale: string[] = [];
for (const pkg of packages) {
  const rendered = renderPackage(program, checker, pkg);
  const snapshotPath = join(PACKAGES_DIR, pkg.dir, SNAPSHOT_FILE);

  if (check) {
    const existing = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : "";
    if (existing !== rendered) stale.push(pkg.name);
  } else {
    writeFileSync(snapshotPath, rendered);
    console.log(`[api-surface] wrote ${snapshotPath}`);
  }
}

if (check) {
  if (stale.length > 0) {
    console.error(
      `\x1b[31m✖ API surface changed for ${stale.length} package(s):\x1b[0m\n` +
        stale.map((n) => `    ${n}`).join("\n") +
        `\n\nReview the change; if it is intended, run \`bun run api:surface\` and commit the updated snapshot(s).`,
    );
    process.exit(1);
  }
  console.log(`\x1b[32m✓\x1b[0m API surface matches snapshots (${packages.length} packages).`);
} else {
  console.log(`\x1b[32m✓\x1b[0m Wrote ${packages.length} API-surface snapshot(s).`);
}
