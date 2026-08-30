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

/**
 * What to compare against: `--base`, else the last release, else the fork point.
 *
 * **The last release, not the previous commit.** A user's experience of this
 * package is the difference between published versions; a signature that appears
 * in one commit and is reverted in the next never reaches anyone, and asking for
 * a release note about it teaches people that the gate cries wolf.
 *
 * That is not hypothetical — it fired on exactly that. Render modes briefly
 * widened `child()`'s parameter to name a static, then put it back when the
 * widening turned out to risk worse generic inference at every call site. Net
 * effect on the surface: nothing. Commit-to-commit: two removals and a demand
 * for a BREAKING note about a change no release ever carried.
 *
 * On a pull request the branch point is still right — that is the cumulative
 * effect the PR proposes for the next release, which is the question a reviewer
 * is asking.
 */
function baseRef(): string {
  const flag = Bun.argv.indexOf("--base");
  if (flag !== -1 && Bun.argv[flag + 1]) return Bun.argv[flag + 1]!;

  const branch = Bun.env["GITHUB_BASE_REF"];
  if (branch) return `origin/${branch}`;

  // `--merged` so a tag on some other branch cannot be picked; sorted by version
  // rather than by date, because a patch can be tagged after a later minor.
  const tag = run("tag", "--list", "v*", "--merged", "HEAD", "--sort=-v:refname")
    .split(SPLIT_LINES)
    .map((line) => line.trim())
    .find(Boolean);
  if (tag) return tag;

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

/**
 * Widening an optional property is not a removal.
 *
 * `image?: string` becoming `image?: string | undefined` reads as one line gone and
 * one line added, and the gone one is not a break: a caller reading the property
 * already got `string | undefined`, and one *writing* it can now do more, not less.
 * Under `exactOptionalPropertyTypes` that is the difference between an options bag
 * you can spread into and one you cannot, so it is a change worth making in bulk —
 * and 438 false removals in a release would bury the one real one.
 *
 * Matched by pairing rather than by shape alone: the removed line plus
 * ` | undefined` has to be a line the same package added. Anything else stays a
 * removal.
 */
export function isWidening(removed: string, added: Set<string>): boolean {
  // A shape that gained an optional member. Checked first, because the removed line
  // in that case has no `?:` of its own — it is the *added* one that grew.
  for (const candidate of added) {
    if (isOptionalMemberAddition(removed, candidate)) return true;
  }

  // Nothing here is optional, so nothing here can have been widened.
  if (!removed.includes("?:")) return false;

  // One property on its own line — the common case. Exact, so the parentheses a
  // function type needs are matched literally rather than unwrapped by pattern.
  const property = /^(\s*[\w$]+\?:\s*)(.+)$/.exec(removed.trimEnd());
  if (property) {
    const [, prefix, type] = property as unknown as [string, string, string];
    if (added.has(`${prefix}${type} | undefined`)) return true;
    if (added.has(`${prefix}(${type}) | undefined`)) return true;
  }

  // A whole type alias flattened onto one line, where several members moved at
  // once. Compared with every `| undefined` normalised away.
  const beforeCount = _optionalCount(removed);
  const normalised = _withoutOptional(removed);
  for (const candidate of added) {
    // Strictly more `| undefined` than it had: the same line with fewer would be a
    // *narrowing*, which does break a caller and must stay reported.
    if (_optionalCount(candidate) <= beforeCount) continue;
    if (_withoutOptional(candidate) === normalised) return true;
  }

  return false;
}

/**
 * Whether the only difference is that `added` gained optional members.
 *
 * Adding `foreignKeys?: boolean` to a recorded `sqlite: { path: string }` reads as a
 * removal plus an addition, and breaks nobody: the old shape is still constructible,
 * still assignable, and still implementable. Reporting it as a removal spends the
 * gate's credibility on a change that is purely additive.
 *
 * Deliberately strict about *which* members may appear: every one the added line has
 * and the removed line does not must be optional, and every member the removed line
 * had must survive. A required member appearing is a break (existing object literals
 * stop type-checking) and a member disappearing obviously is.
 */
function isOptionalMemberAddition(removed: string, added: string): boolean {
  if (!added.includes("?:")) return false;

  const before = _members(removed);
  const after = _members(added);
  if (before === null || after === null) return false;

  // Nothing may leave, and nothing required may arrive.
  for (const [name, type] of before) {
    if (after.get(name) !== type) return false;
  }
  for (const [name] of after) {
    if (!before.has(name) && !name.endsWith("?")) return false;
  }
  if (after.size === before.size) return false;

  // The frame around the members has to be the same declaration.
  return _withoutMembers(removed) === _withoutMembers(added);
}

/** Members of an inline object type, as `name` (with a trailing `?` when optional) → type. */
function _members(line: string): Map<string, string> | null {
  if (!line.includes("{")) return null;
  const out = new Map<string, string>();
  for (const match of line.matchAll(/([\w$]+)(\??):\s*([^;{}]+);/g)) {
    out.set(`${match[1]}${match[2]}`, match[3]!.trim());
  }
  return out.size === 0 ? null : out;
}

/** The declaration with its inline members removed, whitespace collapsed. */
function _withoutMembers(line: string): string {
  return line
    .replace(/([\w$]+)\??:\s*([^;{}]+);/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many properties on this line admit `undefined`. */
function _optionalCount(line: string): number {
  return line.split(" | undefined").length - 1;
}

/**
 * The line with every `| undefined` removed, so two sides can be compared for what
 * else changed.
 *
 * The parenthesis pass comes first and matters: a function or constructor type has
 * to be wrapped before the union, because `() => void | undefined` parses as a
 * function *returning* `void | undefined`. Undoing the wrap is what lets
 * `x?: () => void` and `x?: (() => void) | undefined` compare equal.
 */
function _withoutOptional(line: string): string {
  return line
    .replace(/\(([^()]*)\) \| undefined/g, "$1")
    .split(" | undefined")
    .join("");
}

/** Exports deleted from a stable package's snapshot, between `base` and HEAD. */
function removals(base: string, stable: Set<string>): Removal[] {
  const diff = run("diff", "--unified=0", base, "HEAD", "--", "packages/*/api-surface.md");
  const lines = diff.split(/\r?\n/);
  const header = /^\+\+\+ b\/packages\/([^/]+)\/api-surface\.md/;

  // What each package added, so a removal can be checked against its replacement.
  const additions = new Map<string, Set<string>>();
  let scanning = "";
  for (const line of lines) {
    const file = line.match(header);
    if (file) {
      scanning = file[1]!;
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    let set = additions.get(scanning);
    if (!set) additions.set(scanning, (set = new Set()));
    set.add(line.slice(1).trim());
  }

  const found: Removal[] = [];
  let dir = "";

  for (const line of lines) {
    const file = line.match(header);
    if (file) {
      dir = file[1]!;
      continue;
    }
    if (!line.startsWith("-") || line.startsWith("---")) continue;

    const body = line.slice(1);
    if (NOT_AN_EXPORT.test(body)) continue;
    if (!stable.has(dir)) continue;
    if (isWidening(body.trim(), additions.get(dir) ?? new Set())) continue;
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

// Guarded so `isWidening` can be unit-tested without the whole gate — including its
// `process.exit` — running on import.
if (import.meta.main) await _main();

async function _main(): Promise<void> {
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
}
