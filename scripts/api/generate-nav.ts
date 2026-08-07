/**
 * Build `docs/api/nav.json` — the data that powers the docs app's "API
 * Reference" sidebar tree (package → module → symbol-kind → symbol).
 *
 * It walks the TypeDoc output directory rather than TypeDoc's own model: the
 * emitted layout already encodes everything the sidebar needs. A package dir
 * either holds symbol-kind folders directly (`classes/`, `interfaces/`, …) for
 * single-entry packages, or nests them under one folder per export subpath
 * (`core/index/`, `core/config/`, …) for multi-entry packages. `collectModules`
 * handles both, and arbitrary deeper nesting, by recursion.
 *
 * Slugs are relative to `docs/api`, so the app renders each as `/docs/api/<slug>`.
 *
 * Usage: `bun run scripts/api/generate-nav.ts`
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_DIR = join(import.meta.dir, "../../docs/api");

/** Symbol-kind folder → sidebar heading, in display order. */
const KIND_LABELS: Record<string, string> = {
  classes: "Classes",
  interfaces: "Interfaces",
  "type-aliases": "Type Aliases",
  functions: "Functions",
  variables: "Variables",
  enumerations: "Enumerations",
  facades: "Facades",
};
const KIND_ORDER = Object.keys(KIND_LABELS);

interface NavItem {
  name: string;
  slug: string;
}
interface NavSection {
  label: string;
  items: NavItem[];
}
/** One export entry point (or the package itself, when single-entry). */
interface NavModule {
  /** Subpath label (e.g. `index`, `config`, `command/builtin`); "" for the package root. */
  label: string;
  slug: string;
  sections: NavSection[];
}
interface NavPackage {
  name: string;
  slug: string;
  modules: NavModule[];
}

function sectionsFor(dirAbs: string, dirSlug: string): NavSection[] {
  const sections: NavSection[] = [];
  for (const kind of KIND_ORDER) {
    let files: string[];
    try {
      files = readdirSync(join(dirAbs, kind));
    } catch {
      continue; // kind folder absent
    }
    const items = files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, slug: `${dirSlug}/${kind}/${name}` }));
    if (items.length) sections.push({ label: KIND_LABELS[kind]!, items });
  }
  return sections;
}

/** Collect every module (kind-folder-bearing directory) at or beneath `dirAbs`. */
function collectModules(dirAbs: string, dirSlug: string, label: string): NavModule[] {
  const entries = readdirSync(dirAbs, { withFileTypes: true }).filter((e) => e.isDirectory());
  const modules: NavModule[] = [];

  const sections = sectionsFor(dirAbs, dirSlug);
  if (sections.length) modules.push({ label, slug: dirSlug, sections });

  const subpaths = entries
    .filter((e) => !(e.name in KIND_LABELS))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const sub of subpaths) {
    const childLabel = label ? `${label}/${sub.name}` : sub.name;
    modules.push(...collectModules(join(dirAbs, sub.name), `${dirSlug}/${sub.name}`, childLabel));
  }
  return modules;
}

function main(): void {
  const packages: NavPackage[] = [];

  // Top level holds scope dirs (`@zerotal`) plus `README.md` / `_media`.
  const scopes = readdirSync(API_DIR, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && e.name.startsWith("@"),
  );

  for (const scope of scopes.sort((a, b) => a.name.localeCompare(b.name))) {
    const scopeAbs = join(API_DIR, scope.name);
    const pkgs = readdirSync(scopeAbs, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const pkg of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
      const slug = `${scope.name}/${pkg.name}`;
      const modules = collectModules(join(scopeAbs, pkg.name), slug, "");
      if (modules.length) packages.push({ name: slug, slug, modules });
    }
  }

  writeFileSync(join(API_DIR, "nav.json"), JSON.stringify({ packages }, null, 2) + "\n");
  const symbols = packages.reduce(
    (n, p) =>
      n +
      p.modules.reduce((m, mod) => m + mod.sections.reduce((s, sec) => s + sec.items.length, 0), 0),
    0,
  );
  console.log(`[api] wrote nav.json — ${packages.length} packages, ${symbols} symbols`);
}

main();
