#!/usr/bin/env bun
/**
 * An export cannot leave a stable package without a release note saying so.
 *
 * `api:surface:check` already refuses to let a signature change silently: when an
 * export vanishes, the snapshot no longer matches and the build fails until
 * somebody regenerates it. But regenerating is the whole of what it asks. Once
 * the snapshot is updated the removal is *recorded* and no longer *reported* —
 * and the changelog, which is the only thing a user reads before upgrading, is
 * defended by remembering.
 *
 * It failed exactly that way. `this.title(…)` was removed from `@zerotal/flow`
 * in 1e313d9 — a commit whose own subject is `flow!:` and whose body opens
 * `BREAKING:` — and shipped in v1.7.3 with no BREAKING entry in either changelog.
 * The support policy written the following morning said two breaks had shipped.
 * Three had.
 *
 * So this reads what `api:surface:check` cannot: the *diff* of the snapshots.
 * A line removed from a stable package's surface is a break, and a break needs a
 * note in the same change.
 *
 * ## What counts
 *
 * Removals only. An addition is not a break, and a modified line shows in a diff
 * as a removal plus an addition — so a rename or a signature change is caught by
 * its removal half, which is the half that breaks a caller.
 *
 * Stable packages only. `beta` and `experimental` say in their own README that
 * their surface may move; holding them to this would teach people to write
 * BREAKING notes that mean nothing, which is how a gate becomes noise.
 *
 * ## Usage
 *
 *     bun run scripts/breaking-check.ts            # against origin/main
 *     bun run scripts/breaking-check.ts --base <ref>
 */
import { Glob } from "bun";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Lines in a surface snapshot that carry no API — headings, prose, blanks. */
const NOT_AN_EXPORT = /^\s*$|^#|^<!--|^\s*\/\/|^\s*\*|^```/;

/** The marker a release note uses for a break. Bold, because the changelog says so. */
const BREAKING = "**BREAKING";

function run(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(proc.stdout);
}

/** The ref to compare against: `--base`, else origin/main, else the previous commit. */
function baseRef(): string {
  const flag = Bun.argv.indexOf("--base");
  if (flag !== -1 && Bun.argv[flag + 1]) return Bun.argv[flag + 1]!;

  const branch = Bun.env["GITHUB_BASE_REF"];
  if (branch) return `origin/${branch}`;

  // On a push to main the interesting comparison is the commit before it; on a
  // local run it is whatever the branch forked from.
  const merged = run("merge-base", "HEAD", "origin/main").trim();
  return merged && merged !== run("rev-parse", "HEAD").trim() ? merged : "HEAD~1";
}

/** Every package's maturity, by name of its directory. */
async function maturities(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for await (const rel of new Glob("*/package.json").scan({ cwd: join(ROOT, "packages") })) {
    const dir = rel.replace(/\\/g, "/").split("/")[0]!;
    const pkg = (await Bun.file(join(ROOT, "packages", rel)).json()) as {
      name?: string;
      maturity?: string;
    };
    out.set(dir, pkg.maturity ?? "stable");
  }
  return out;
}

interface Removal {
  dir: string;
  line: string;
}

/** Exports deleted from a stable package's snapshot, between `base` and HEAD. */
function removals(base: string, stable: Set<string>): Removal[] {
  const diff = run("diff", "--unified=0", base, "HEAD", "--", "packages/*/api-surface.md");
  const found: Removal[] = [];
  let dir = "";

  for (const line of diff.split(/\r?\n/)) {
    const file = line.match(/^\+\+\+ b\/packages\/([^/]+)\/api-surface\.md/);
    if (file) {
      dir = file[1]!;
      continue;
    }
    if (!line.startsWith("-") || line.startsWith("---")) continue;

    const body = line.slice(1);
    if (NOT_AN_EXPORT.test(body)) continue;
    if (!stable.has(dir)) continue;
    found.push({ dir, line: body.trim() });
  }
  return found;
}

/** Whether the change also writes a BREAKING note, in any changelog it touches. */
function notesABreak(base: string): boolean {
  const diff = run("diff", base, "HEAD", "--", "docs/changelog.md", "packages/*/CHANGELOG.md");
  return diff
    .split(/\r?\n/)
    .some((line) => line.startsWith("+") && !line.startsWith("+++") && line.includes(BREAKING));
}

// ── Entry point ───────────────────────────────────────────────────────────────

const base = baseRef();
const maturity = await maturities();
const stable = new Set([...maturity].filter(([, m]) => m === "stable").map(([dir]) => dir));

const gone = removals(base, stable);

if (gone.length === 0) {
  console.log(`✓ No exports removed from a stable package (against ${base}).`);
  process.exit(0);
}

if (notesABreak(base)) {
  console.log(
    `✓ ${gone.length} export(s) removed from a stable package, and the change notes a BREAKING entry.`,
  );
  process.exit(0);
}

const byPackage = new Map<string, string[]>();
for (const { dir, line } of gone) byPackage.set(dir, [...(byPackage.get(dir) ?? []), line]);

console.error(`\n✖ ${gone.length} export(s) left a stable package with no BREAKING note:\n`);
for (const [dir, lines] of byPackage) {
  console.error(`  @zerotal/${dir}`);
  for (const line of lines.slice(0, 8)) console.error(`    − ${line}`);
  if (lines.length > 8) console.error(`    … and ${lines.length - 8} more`);
}
console.error(
  `\n  A caller of any of these breaks on upgrade, and the changelog is the only place` +
    `\n  they would find out. Add a **BREAKING** entry — to docs/changelog.md and to the` +
    `\n  package's own CHANGELOG.md — naming the replacement and the migration.` +
    `\n` +
    `\n  If the export was never public, mark it \`@internal\` and regenerate the snapshot` +
    `\n  instead: an internal export leaving is not a break, and should not read as one.\n`,
);
process.exit(1);
