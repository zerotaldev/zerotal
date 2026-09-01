/**
 * Every package that changed is a package the release notes have to mention.
 *
 * The failure this exists for: 1.13.4 shipped a user-facing change to
 * `@zerotal/inertia` — server rendering, wired up for the first time — and its
 * release notes did not mention Inertia at all. Nobody had a reason to try the
 * feature, and the one team that would have wanted it was told, by me, that it
 * was still unreleased.
 *
 * The cause is mechanical and worth naming: release notes get written from what
 * the author *intended* to ship, not from `git log <last-tag>..HEAD`. Anything
 * that landed on `main` in between — a fix from earlier in the day, someone
 * else's merge — ships silently. The author is the last person who can notice,
 * because they are recalling rather than reading.
 *
 * So this reads the diff instead.
 *
 *   bun run scripts/release-notes-check.ts                 # against [Unreleased]
 *   bun run scripts/release-notes-check.ts --tag v1.14.0   # against [1.14.0]
 *
 * @module
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(proc.stdout).trim();
}

/**
 * The release being checked, and the tag to diff against.
 *
 * With `--tag v1.14.0` the base is the newest tag *below* it, because the tag
 * being released points at `HEAD` and diffing a commit against itself finds
 * nothing — which is exactly how a check like this passes while proving nothing.
 */
function range(tag: string | undefined): { base: string; heading: string } {
  const tags = git("tag", "--list", "v*", "--merged", "HEAD", "--sort=-v:refname")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tag) {
    const base = tags.find((t) => t !== tag);
    return { base: base ?? tags[tags.length - 1] ?? "", heading: tag.replace(/^v/, "") };
  }
  return { base: tags[0] ?? "", heading: "Unreleased" };
}

/**
 * Whether a file's whole diff is the release's own version bookkeeping.
 *
 * `create-zerotal`'s `ZT_VERSION` moves on every single release and never means
 * anything a reader wants told. Flagging it would make this gate fire every time,
 * and a gate that always fires is one people learn to scroll past — the failure it
 * exists to prevent, arrived at from the other side.
 *
 * Matched on the *content* of the hunks rather than on the path, so it stays true
 * if the constant moves and does not quietly excuse a real change to that file.
 */
function isVersionBookkeeping(base: string, file: string): boolean {
  const diff = git("diff", "-U0", `${base}..HEAD`, "--", file);
  const changed = diff
    .split(/\r?\n/)
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return changed.length > 0 && changed.every((line) => /ZT_VERSION/.test(line));
}

/** Source files in a package that count as a shipped change. */
function shippedFiles(base: string, pkg: string): string[] {
  return git("diff", "--name-only", `${base}..HEAD`, "--", `packages/${pkg}/src`)
    .split(/\r?\n/)
    .filter(
      // A test is not a shipped change, and requiring a changelog line for one
      // would train people to write "internal" and stop reading the gate.
      (file) => file && !/\.test\.tsx?$/.test(file) && !isVersionBookkeeping(base, file),
    );
}

/** Packages whose shipped source changed in the range. */
function changedPackages(base: string): string[] {
  if (!base) return [];
  const packages = new Set<string>();

  for (const file of git("diff", "--name-only", `${base}..HEAD`).split(/\r?\n/)) {
    const match = /^packages\/([^/]+)\/src\//.exec(file);
    if (match) packages.add(match[1]!);
  }
  return [...packages].filter((pkg) => shippedFiles(base, pkg).length > 0).sort();
}

/** Whether a package's changelog carries a section for this release. */
function hasEntry(pkg: string, heading: string): boolean {
  const file = join(ROOT, "packages", pkg, "CHANGELOG.md");
  if (!existsSync(file)) return false;

  const body = readFileSync(file, "utf8");
  const index = body.indexOf(`## [${heading}]`);
  if (index === -1) return false;

  // Present but empty is the same as absent: `changelog:release` moves the
  // heading whether or not anything was written under it, so a bare heading is
  // what an unwritten note looks like.
  const next = body.indexOf("\n## ", index + 1);
  const section = body.slice(index, next === -1 ? undefined : next);
  return section.replace(`## [${heading}]`, "").trim().length > 0;
}

const flagIndex = Bun.argv.indexOf("--tag");
const tag = flagIndex === -1 ? undefined : Bun.argv[flagIndex + 1];
const { base, heading } = range(tag);

if (!base) {
  console.log("✓ no previous tag to compare against — nothing to check.");
  process.exit(0);
}

const changed = changedPackages(base);
const missing = changed.filter((pkg) => !hasEntry(pkg, heading));

console.log(`\n── Release notes vs. ${base}..HEAD ──\n`);
console.log(`  ${changed.length} package(s) changed: ${changed.join(", ") || "(none)"}`);
console.log(`  checking for a \`## [${heading}]\` entry in each\n`);

if (missing.length === 0) {
  console.log("\x1b[32m✓\x1b[0m every changed package says what changed.");
  process.exit(0);
}

console.error(`\x1b[31m✖ ${missing.length} package(s) changed with nothing in the notes:\x1b[0m\n`);
for (const pkg of missing) {
  const files = shippedFiles(base, pkg);
  console.error(`  @zerotal/${pkg} — ${files.length} source file(s)`);
  for (const file of files.slice(0, 3)) console.error(`    ${file}`);
  if (files.length > 3) console.error(`    … and ${files.length - 3} more`);
}
console.error(
  `\n  Add a \`## [${heading}]\` section to each package's CHANGELOG.md saying what` +
    `\n  changed and why. If a change genuinely needs no note — a rename with no` +
    `\n  behavioural effect — say that in one line; the point is that somebody read` +
    `\n  the diff, not that every line earns a paragraph.\n`,
);
process.exit(1);
