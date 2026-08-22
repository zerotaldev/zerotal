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

/**
 * How a release note marks a break.
 *
 * Two forms are in use and both are legitimate: 1.3.0 wrote a section heading,
 * `### Changed — BREAKING`, and everything since has used an inline `**BREAKING`
 * at the head of the entry. Accepting only the second would fail a change that
 * followed the older precedent — a gate that rejects a note which exists teaches
 * people to fight it rather than write it.
 */
const BREAKING = /^(?:#{2,4}.*BREAKING|.*\*\*BREAKING)/;

/**
 * The other truthful answer: an export was reclassified, not removed.
 *
 * A symbol marked `@internal` leaves the recorded surface while remaining
 * exported and working. Nothing breaks — but something did leave a document
 * people read as the contract, and saying so is worth a line.
 *
 * It needs its own marker because the alternative is worse. Faced with a gate
 * that only accepts `**BREAKING`, the path of least resistance is to write
 * `**BREAKING` about a change that breaks nothing — and a changelog where
 * BREAKING sometimes means "your code still works" is a changelog nobody can
 * act on. Keeping the strong word strong is the point of having it.
 */
const RECLASSIFIED = /^(?:#{2,4}.*INTERNAL|.*\*\*INTERNAL)/;

/** Either note satisfies the gate; they answer different questions. */
const ANNOUNCED = (line: string): boolean => BREAKING.test(line) || RECLASSIFIED.test(line);

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

/** Whether the change announces itself — BREAKING or INTERNAL — in any changelog it touches. */
function notesABreak(base: string): boolean {
  const diff = run("diff", base, "HEAD", "--", "docs/changelog.md", "packages/*/CHANGELOG.md");
  return diff
    .split(/\r?\n/)
    .some((line) => line.startsWith("+") && !line.startsWith("+++") && ANNOUNCED(line.slice(1)));
}

/** Line split and paragraph break, named because writing the escapes inline kept eating them. */
const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const SPLIT_LINES = new RegExp(CARRIAGE_RETURN + "?" + NEWLINE);
const BLANK_LINE = NEWLINE + NEWLINE;

// ── The policy's own list ─────────────────────────────────────────────────────

/**
 * Every version whose release notes carry a BREAKING entry.
 *
 * Derived from the changelog rather than maintained anywhere, because a count
 * kept by hand is what went wrong: `docs/upgrade.md` said "two have shipped
 * (1.3.0 and 1.7.2)" for as long as it took someone to notice, on the page whose
 * entire job is telling a reader what to check before crossing a version.
 */
async function versionsWithBreaks(): Promise<string[]> {
  const changelog = await Bun.file(join(ROOT, "docs", "changelog.md")).text();
  const sections = changelog.split(/^## (?=\d+\.\d+\.\d+)/m).slice(1);

  return sections
    .filter((section) => section.split(SPLIT_LINES).some((line) => BREAKING.test(line)))
    .map((section) => section.slice(0, section.search(/[^\d.]/)))
    .sort();
}

/** The versions the support policy names as having shipped a break. */
async function versionsPolicyNames(): Promise<string[]> {
  const policy = await Bun.file(join(ROOT, "docs", "support-policy.md")).text();
  // The carve-out paragraph — from the sentence that counts them to the blank
  // line that ends it.
  const start = policy.search(/\w+ have shipped so far/);
  if (start === -1) return [];
  const end = policy.indexOf(BLANK_LINE, start);
  const paragraph = policy.slice(start, end === -1 ? undefined : end);

  return [...new Set(paragraph.match(/\d+\.\d+\.\d+/g) ?? [])].sort();
}

// ── Entry point ───────────────────────────────────────────────────────────────

const base = baseRef();
const maturity = await maturities();
const stable = new Set([...maturity].filter(([, m]) => m === "stable").map(([dir]) => dir));

// The policy names the breaks that have shipped; the changelog is where they are
// recorded. One of those is derived from the other, so they cannot be allowed to
// disagree — and they did, in the third document nobody thought to update.
const recorded = await versionsWithBreaks();
const named = await versionsPolicyNames();

if (recorded.join() !== named.join()) {
  console.error(
    `
✖ docs/support-policy.md and docs/changelog.md disagree about which versions broke:
` +
      `
    changelog says:      ${recorded.join(", ") || "(none)"}` +
      `
    support policy says: ${named.join(", ") || "(none)"}
` +
      `
  The changelog is the record; the policy summarises it. Update the policy's` +
      `
  carve-out paragraph to name exactly the versions above, and check whether` +
      `
  docs/upgrade.md repeats the list — it is not supposed to.
`,
  );
  process.exit(1);
}

const gone = removals(base, stable);

if (gone.length === 0) {
  console.log(`✓ No exports removed from a stable package (against ${base}).`);
  process.exit(0);
}

if (notesABreak(base)) {
  console.log(
    `✓ ${gone.length} export(s) left a stable package's recorded surface, and the change says so.`,
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
    `\n  instead — then note it with **INTERNAL** rather than **BREAKING**. It leaves the` +
    `\n  recorded surface while staying exported and working, so nothing breaks; the two` +
    `\n  markers exist so the strong word keeps meaning "your code stops compiling".\n`,
);
process.exit(1);
