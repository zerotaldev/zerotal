#!/usr/bin/env bun
/**
 * Every dependency a package has is one it declared, in the right block, loaded
 * the right way.
 *
 * The policy is "as few dependencies as possible, each one justified", and for a
 * long time it was written nowhere but in docblocks. So it drifted: a passkey
 * library installed into every app, optional peers loaded four different ways —
 * some turning a missing package into `null` and carrying on — and packages
 * importing siblings they never declared, which resolve in a hoisted install and
 * fail in an isolated one. Each of those was found by reading, and reading does
 * not happen on every pull request. This does.
 *
 * The rules, and the reason for each, are in `docs/package-development.md` under
 * "Dependencies". In short, it fails on:
 *
 * - an import of a package the manifest does not declare (`undeclared`), or
 *   declares only as a devDependency (`dev-only`);
 * - a third-party `dependencies` entry that is not on the allowlist in
 *   `scripts/deps-policy.json` (`dependency-not-allowed`), or not named in the
 *   support policy's Dependencies table (`undocumented-dependency`);
 * - a `peerDependenciesMeta` key that `peerDependencies` lacks (`peer-meta-orphan`);
 * - a peer range with no upper bound (`unbounded-peer`);
 * - an optional peer with no devDependency (`peer-without-dev`), or whose
 *   devDependency resolves, in `bun.lock`, to a version outside the peer range
 *   (`peer-dev-mismatch`);
 * - an optional peer imported statically (`optional-peer-static`), imported for its
 *   types (`optional-peer-type-import`), or loaded any way but
 *   `import("x" as string).catch(optionalPeer("x", …))` (`optional-peer-shape`);
 * - a package loaded through a variable specifier, which `bun build --compile`
 *   cannot see and so does not embed (`variable-specifier`).
 *
 * Source is read as it ships: a file the manifest's `files` leaves out of the
 * tarball never runs in an app, so its imports are not checked. That is what lets
 * a browser library be a devDependency of the entry it is bundled from.
 *
 * It landed with a baseline of the violations that already existed, so it fails
 * only on new ones. Fixing one moves it out of the baseline with `--update`.
 *
 *   bun run scripts/deps-check.ts            # fail on a violation the baseline lacks
 *   bun run scripts/deps-check.ts --update   # rewrite the baseline to what is found
 *
 * @module
 */
import { builtinModules } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Glob } from "bun";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..");
const POLICY_FILE = "scripts/deps-policy.json";
const BASELINE_FILE = "deps-baseline.json";
const SUPPORT_POLICY = "docs/support-policy.md";

// ── Import scanning ─────────────────────────────────────────────────────────

/** How a file reaches another module. */
export type ImportKind =
  /** `import x from "p"`, `import "p"`, `export … from "p"`: loaded with the file. */
  | "static"
  /** `import type`, `export type … from`, `typeof import("p")`: types only. */
  | "type"
  /** `import("p")`: loaded when the expression runs. */
  | "dynamic"
  /** `require("p")`: loaded when the call runs. */
  | "require";

/** One place a source file names a package. */
export interface ImportSite {
  spec: string;
  kind: ImportKind;
  /** Whether the specifier is written in the call itself rather than held in a variable. */
  literal: boolean;
  /** Whether it is the optional-peer shape: `import("p" as string).catch(optionalPeer("p", …))`. */
  peerShape: boolean;
  line: number;
}

const BUILTINS = new Set(builtinModules);

/**
 * Whether a specifier names a package, as opposed to a file, a URL or a builtin.
 *
 * Only packages are this gate's business. Roughly thirty imports across the
 * packages take a path the app supplies — route files, migrations, config — and
 * those are non-literal by necessity.
 */
export function isPackageSpecifier(spec: string): boolean {
  if (spec === "bun" || spec.startsWith("bun:") || spec.startsWith("node:")) return false;
  if (BUILTINS.has(spec) || BUILTINS.has(spec.split("/")[0] ?? "")) return false;
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/.*)?$/i.test(spec) && !/^[a-z]:/i.test(spec);
}

/** The package a specifier names: `@scope/name` or `name`, without any subpath. */
export function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
}

/** The string a specifier argument is, looking through `as string` and a same-file `const`. */
function specifierOf(
  node: ts.Expression,
  constants: Map<string, string | null>,
): { spec: string; literal: boolean; asString: boolean } | null {
  let expr = node;
  let asString = false;
  if (ts.isAsExpression(expr) && expr.type.kind === ts.SyntaxKind.StringKeyword) {
    expr = expr.expression;
    asString = true;
  }
  if (ts.isStringLiteralLike(expr)) return { spec: expr.text, literal: true, asString };
  if (ts.isIdentifier(expr)) {
    const value = constants.get(expr.text);
    return value ? { spec: value, literal: false, asString } : null;
  }
  return null;
}

/** Every `const name = "string"` in a file; a name bound to two values maps to `null`. */
function stringConstants(file: ts.SourceFile): Map<string, string | null> {
  const found = new Map<string, string | null>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const name = node.name.text;
      const value = node.initializer.text;
      found.set(name, found.has(name) && found.get(name) !== value ? null : value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Whether a call is `optionalPeer("<spec>", …)`. */
function isOptionalPeerCall(node: ts.Node, spec: string): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "optionalPeer" &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === spec
  );
}

/** Whether `import(…)` is immediately `.catch(optionalPeer("<spec>", …))`. */
function hasPeerCatch(call: ts.CallExpression, spec: string): boolean {
  const access = call.parent;
  if (!access || !ts.isPropertyAccessExpression(access) || access.name.text !== "catch")
    return false;
  const outer = access.parent;
  return (
    outer !== undefined &&
    ts.isCallExpression(outer) &&
    outer.expression === access &&
    outer.arguments[0] !== undefined &&
    isOptionalPeerCall(outer.arguments[0], spec)
  );
}

/** Whether `require(…)` sits in a `try` whose `catch` hands the error to `optionalPeer("<spec>", …)`. */
function hasPeerTry(call: ts.Node, spec: string): boolean {
  for (let node: ts.Node = call; node.parent; node = node.parent) {
    const parent = node.parent;
    if (ts.isTryStatement(parent) && parent.tryBlock === node && parent.catchClause) {
      let found = false;
      const visit = (n: ts.Node): void => {
        if (isOptionalPeerCall(n, spec)) found = true;
        else ts.forEachChild(n, visit);
      };
      visit(parent.catchClause.block);
      if (found) return true;
    }
  }
  return false;
}

/** Whether an import declaration brings in types only. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

/**
 * Every package a source file names, and how.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it parses as TSX.
 */
export function scanImports(source: string, fileName = "file.ts"): ImportSite[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const constants = stringConstants(file);
  const sites: ImportSite[] = [];

  const add = (node: ts.Node, site: Omit<ImportSite, "line">): void => {
    if (!isPackageSpecifier(site.spec)) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    sites.push({ ...site, line });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add(node, {
        spec: node.moduleSpecifier.text,
        kind: isTypeOnlyImport(node) ? "type" : "static",
        literal: true,
        peerShape: false,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      add(node, {
        spec: node.moduleSpecifier.text,
        kind: node.isTypeOnly ? "type" : "static",
        literal: true,
        peerShape: false,
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      add(node, {
        spec: node.argument.literal.text,
        kind: "type",
        literal: true,
        peerShape: false,
      });
    } else if (ts.isCallExpression(node) && node.arguments[0]) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) {
        const found = specifierOf(node.arguments[0], constants);
        if (found) {
          add(node, {
            spec: found.spec,
            kind: isImport ? "dynamic" : "require",
            literal: found.literal,
            peerShape:
              found.literal &&
              (isImport
                ? found.asString && hasPeerCatch(node, found.spec)
                : hasPeerTry(node, found.spec)),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

// ── Manifests and the lockfile ──────────────────────────────────────────────

/** The parts of a package.json this gate reads. */
export interface Manifest {
  name: string;
  version?: string;
  private?: boolean;
  /** What the tarball carries; absent means everything. */
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** The allowlist and its reasons. */
export interface Policy {
  /** Package name → third-party dependency → why every app installing it needs it. */
  allowedDependencies: Record<string, Record<string, string>>;
}

/** One rule broken, keyed so a baseline can name it without line numbers. */
export interface Violation {
  rule: string;
  /** Package directory under `packages/`. */
  pkg: string;
  /** The dependency concerned. */
  subject: string;
  /** Repo-relative file, or `package.json`. */
  file: string;
  line?: number;
  message: string;
}

/** The stable key a baseline records: rule, package, dependency and file — never a line. */
export function violationKey(v: Violation): string {
  return `${v.rule} ${v.pkg}: ${v.subject} (${v.file})`;
}

/**
 * Whether a range admits every future major — `>=0.70.0`, `*`, `latest`.
 *
 * Asked of the range rather than parsed from it: a range that accepts version
 * 99999 has no ceiling, whatever its spelling.
 */
export function isUnbounded(range: string): boolean {
  const trimmed = range.trim();
  if (/^(\*|x|latest|next|)$/i.test(trimmed)) return true;
  try {
    return Bun.semver.satisfies("99999.0.0", trimmed);
  } catch {
    return false;
  }
}

/** The installed version a lockfile records for one workspace's dependency. */
export type LockResolver = (workspaceName: string, dep: string) => string | null;

/**
 * Read `bun.lock` into a resolver.
 *
 * Asking `Bun.semver.satisfies` whether two *ranges* agree does not work — it
 * takes a version, and `satisfies("^0.35.5", "^0.33 || ^0.34")` is false for
 * reasons unrelated to the question. The lockfile says what was actually
 * installed, so that is what gets compared. A package nested under a workspace
 * (`@zerotal/media/sharp`) wins over the hoisted one, as it does on disk.
 *
 * @param lock - The parsed lockfile.
 * @param workspaceVersions - Workspace package name → its version, for `workspace:` entries.
 */
export function lockResolver(
  lock: { packages?: Record<string, unknown[]> },
  workspaceVersions: Map<string, string>,
): LockResolver {
  const packages = lock.packages ?? {};
  return (workspaceName, dep) => {
    const entry = packages[`${workspaceName}/${dep}`] ?? packages[dep];
    const id = entry?.[0];
    if (typeof id !== "string") return null;
    const at = id.lastIndexOf("@");
    const version = id.slice(at + 1);
    if (version.startsWith("workspace:")) return workspaceVersions.get(dep) ?? null;
    return version;
  };
}

/** The checks on one manifest that need no source. */
export function checkManifest(
  pkg: string,
  manifest: Manifest,
  policy: Policy,
  resolve: LockResolver,
  supportPolicyText: string,
): Violation[] {
  const out: Violation[] = [];
  const file = "package.json";
  const peers = manifest.peerDependencies ?? {};
  const meta = manifest.peerDependenciesMeta ?? {};
  const dev = manifest.devDependencies ?? {};
  const allowed = policy.allowedDependencies[manifest.name] ?? {};

  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (isFirstParty(dep)) continue;
    if (!(dep in allowed)) {
      out.push({
        rule: "dependency-not-allowed",
        pkg,
        subject: dep,
        file,
        message:
          `"${dep}" is a dependency, so every app installing ${manifest.name} gets it, and it is ` +
          `not on the allowlist in ${POLICY_FILE}. Make it an optional peer, write it in-house, ` +
          `or add it to the allowlist with the reason every app needs it.`,
      });
    }
    if (!mentions(supportPolicyText, dep)) {
      out.push({
        rule: "undocumented-dependency",
        pkg,
        subject: dep,
        file,
        message: `"${dep}" is installed into apps but missing from the Dependencies table in ${SUPPORT_POLICY}.`,
      });
    }
  }

  for (const dep of Object.keys(meta)) {
    if (!(dep in peers)) {
      out.push({
        rule: "peer-meta-orphan",
        pkg,
        subject: dep,
        file,
        message: `peerDependenciesMeta names "${dep}", which peerDependencies does not declare.`,
      });
    }
  }

  for (const [dep, range] of Object.entries(peers)) {
    if (range.startsWith("workspace:")) continue;
    if (isUnbounded(range)) {
      out.push({
        rule: "unbounded-peer",
        pkg,
        subject: dep,
        file,
        message: `peer "${dep}" accepts "${range}", which has no upper bound: a major nobody has tested installs without a warning.`,
      });
    }
    if (meta[dep]?.optional !== true) continue;
    if (!(dep in dev)) {
      out.push({
        rule: "peer-without-dev",
        pkg,
        subject: dep,
        file,
        message: `optional peer "${dep}" has no devDependency, so this repo never installs it and nothing tests the code that loads it.`,
      });
      continue;
    }
    const installed = resolve(manifest.name, dep);
    if (installed && !Bun.semver.satisfies(installed, range)) {
      out.push({
        rule: "peer-dev-mismatch",
        pkg,
        subject: dep,
        file,
        message: `the tests run against "${dep}" ${installed} (bun.lock), which the peer range "${range}" does not accept.`,
      });
    }
  }
  return out;
}

/** The checks on one source file against its package's manifest. */
export function checkSource(
  pkg: string,
  file: string,
  sites: ImportSite[],
  manifest: Manifest,
): Violation[] {
  const out: Violation[] = [];
  const deps = manifest.dependencies ?? {};
  const dev = manifest.devDependencies ?? {};
  const peers = manifest.peerDependencies ?? {};
  const meta = manifest.peerDependenciesMeta ?? {};
  const seen = new Set<string>();

  const push = (v: Violation): void => {
    const key = violationKey(v);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  for (const site of sites) {
    const name = packageOf(site.spec);
    if (name === manifest.name) continue;
    const base = { pkg, subject: name, file, line: site.line };

    if (!site.literal) {
      push({
        ...base,
        rule: "variable-specifier",
        message:
          `"${site.spec}" is loaded through a variable. \`bun build --compile\` embeds only the ` +
          `packages it can see by name, so a compiled app will not contain it.`,
      });
    }

    const optional = name in peers && meta[name]?.optional === true;
    if (name in deps || (name in peers && !optional)) continue;

    if (optional) {
      if (site.kind === "type") {
        push({
          ...base,
          rule: "optional-peer-type-import",
          message: `types imported from optional peer "${name}": an app without it fails tsc here. Declare the shape you use.`,
        });
      } else if (site.kind === "static") {
        push({
          ...base,
          rule: "optional-peer-static",
          message: `optional peer "${name}" imported statically: an app without it fails to load this file.`,
        });
      } else if (site.literal && !site.peerShape) {
        push({
          ...base,
          rule: "optional-peer-shape",
          message:
            `optional peer "${name}" must load as import("${site.spec}" as string)` +
            `.catch(optionalPeer("${site.spec}", …)), or as require() in a try whose catch calls optionalPeer.`,
        });
      }
      continue;
    }

    if (name in dev) {
      push({
        ...base,
        rule: "dev-only",
        message: `"${name}" is only a devDependency: apps never install it, so this ${site.kind} import fails there.`,
      });
    } else {
      push({
        ...base,
        rule: "undeclared",
        message: `"${name}" is imported (${site.kind}) but not declared in package.json.`,
      });
    }
  }
  return out;
}

/** Whether a `files` pattern names this path: the path itself, a directory above it, or a glob. */
function filesPatternMatches(pattern: string, rel: string): boolean {
  const trimmed = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  return rel === trimmed || rel.startsWith(`${trimmed}/`) || new Glob(trimmed).match(rel);
}

/**
 * Whether a file reaches the tarball, read from the manifest's `files` the way a
 * pack reads it: included by an entry naming it or a directory above it, and not
 * excluded by a `!` entry.
 *
 * Only a shipped file can import anything in an app. One the tarball leaves out is
 * a build input, and what it imports is the package's own business at pack time.
 * That is how a browser library stays a devDependency: the entry that imports it
 * does not ship, and the bundle built from it does (docs/package-development.md,
 * "Shipping a browser bundle"). If `files` ever started shipping that entry, its
 * imports would be checked again, and fail.
 *
 * @param rel - The file, relative to the package directory.
 * @param files - The manifest's `files`.
 */
export function isShipped(rel: string, files: readonly string[] | undefined): boolean {
  if (!files) return true;
  const included = files.some((p) => !p.startsWith("!") && filesPatternMatches(p, rel));
  const excluded = files.some((p) => p.startsWith("!") && filesPatternMatches(p.slice(1), rel));
  return included && !excluded;
}

/** Whether a package is one of this repository's own. */
function isFirstParty(name: string): boolean {
  return name === "zerotal" || name === "create-zerotal" || name.startsWith("@zerotal/");
}

/** Whether the support policy names a package as code: `` `name` ``. */
function mentions(text: string, name: string): boolean {
  return text.includes(`\`${name}\``);
}

// ── The repository ──────────────────────────────────────────────────────────

/** Non-test shipped source in one package (mirrors the cast audit's filter). */
function sourceFiles(dir: string): string[] {
  const glob = new Glob("src/**/*.{ts,tsx}");
  const out: string[] = [];
  for (const file of glob.scanSync(join(ROOT, "packages", dir))) {
    const rel = file.replace(/\\/g, "/");
    if (/\.(test|spec)\.tsx?$/.test(rel)) continue;
    if (/(^|\/)(__fixtures__|__test_migrations__|\.zerotal)\//.test(rel)) continue;
    if (/\.generated\./.test(rel) || rel.endsWith(".d.ts")) continue;
    out.push(rel);
  }
  return out.sort();
}

/** Every rule against every package in the repository. */
export function collectViolations(): Violation[] {
  const policy = JSON.parse(readFileSync(join(ROOT, POLICY_FILE), "utf8")) as Policy;
  const supportPolicyText = readFileSync(join(ROOT, SUPPORT_POLICY), "utf8");
  const dirs = readdirSync(join(ROOT, "packages")).filter((d) =>
    existsSync(join(ROOT, "packages", d, "package.json")),
  );

  const manifests = new Map<string, Manifest>();
  const versions = new Map<string, string>();
  for (const dir of dirs) {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"),
    ) as Manifest;
    manifests.set(dir, manifest);
    if (manifest.version) versions.set(manifest.name, manifest.version);
  }
  // The text lockfile is JSON with trailing commas, which JSONC accepts.
  const lock = Bun.JSONC.parse(readFileSync(join(ROOT, "bun.lock"), "utf8")) as {
    packages?: Record<string, unknown[]>;
  };
  const resolve = lockResolver(lock, versions);

  const violations: Violation[] = [];
  for (const [dir, manifest] of manifests) {
    if (manifest.private) continue;
    violations.push(...checkManifest(dir, manifest, policy, resolve, supportPolicyText));
    for (const rel of sourceFiles(dir).filter((file) => isShipped(file, manifest.files))) {
      const path = join(ROOT, "packages", dir, rel);
      const sites = scanImports(readFileSync(path, "utf8"), rel);
      const file = relative(ROOT, path).replace(/\\/g, "/");
      violations.push(...checkSource(dir, file, sites, manifest));
    }
  }
  return violations.sort((a, b) => violationKey(a).localeCompare(violationKey(b)));
}

interface Baseline {
  note: string;
  violations: string[];
}

function main(): void {
  const violations = collectViolations();
  const keys = [...new Set(violations.map(violationKey))].sort();

  if (process.argv.includes("--update")) {
    const previous = existsSync(join(ROOT, BASELINE_FILE))
      ? (JSON.parse(readFileSync(join(ROOT, BASELINE_FILE), "utf8")) as Baseline).note
      : "";
    const baseline: Baseline = {
      note:
        previous ||
        "Dependency-policy violations that existed when deps:check landed. The gate fails only on one not listed here. Fix one, then run `bun run deps:check --update` to drop it; never add to this list to make the gate pass.",
      violations: keys,
    };
    writeFileSync(join(ROOT, BASELINE_FILE), JSON.stringify(baseline, null, 2) + "\n");
    console.log(`deps:check baseline rewritten: ${keys.length} known violation(s).`);
    return;
  }

  const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_FILE), "utf8")) as Baseline;
  const known = new Set(baseline.violations);
  const fresh = violations.filter((v) => !known.has(violationKey(v)));
  const current = new Set(keys);
  const fixed = baseline.violations.filter((key) => !current.has(key));

  console.log(`\n── Dependency policy ──\n`);
  if (fresh.length > 0) {
    console.error(`\x1b[31m✖ ${fresh.length} new violation(s):\x1b[0m\n`);
    for (const v of fresh) {
      console.error(`  ${v.rule}  ${v.file}${v.line ? `:${v.line}` : ""}`);
      console.error(`    ${v.message}\n`);
    }
    console.error(
      `  The rules and their reasons: docs/package-development.md#dependencies.\n` +
        `  The baseline (${BASELINE_FILE}) records what existed when the gate landed; it is ` +
        `not where a new violation goes.\n`,
    );
  } else {
    console.log(
      `\x1b[32m✓\x1b[0m no new violations (${keys.length} known, recorded in ${BASELINE_FILE}).`,
    );
  }
  if (fixed.length > 0) {
    console.log(
      `\x1b[33m↓\x1b[0m ${fixed.length} baseline entr${fixed.length === 1 ? "y is" : "ies are"} fixed — ` +
        `run \`bun run deps:check --update\` to drop ${fixed.length === 1 ? "it" : "them"}:`,
    );
    for (const key of fixed) console.log(`    ${key}`);
  }
  process.exit(fresh.length > 0 ? 1 : 0);
}

if (import.meta.main) main();
