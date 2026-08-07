#!/usr/bin/env bun
/**
 * Casting-debt guardrail.
 *
 * `as unknown as` and `as never` are the framework's escape hatches — sometimes
 * irreducible (Active Record's static-side typing, generic-heavy borders), but
 * mostly noise that hides a missing contract. This audit contains them: it counts
 * every such cast in non-test source and gates the count against a committed
 * per-file baseline, so a change may **remove** casts freely but may not **add**
 * one to a file (or introduce a newly-cast file) without the baseline moving as a
 * deliberate, reviewed step.
 *
 * A package may nominate a **cast-boundary module** — the one file where casts
 * are permitted without limit (each documenting the invariant it relies on).
 * List those paths under `boundaries` in the baseline; they are exempt from the
 * ratchet.
 *
 *   bun run scripts/cast-audit.ts            # fail if any file exceeds its baseline
 *   bun run scripts/cast-audit.ts --update   # rewrite the baseline to current counts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";

const BASELINE_FILE = "cast-baseline.json";
const ROOT = resolve(".");

/** The cast operators we contain. Ordered so the two-token form is counted whole. */
const CAST_PATTERNS = [/\bas\s+unknown\s+as\b/g, /\bas\s+never\b/g];

interface Baseline {
  /** Files whose casts are unlimited (a package's designated cast border). */
  boundaries: string[];
  /** Non-boundary source files → their permitted cast count (the ratchet). */
  files: Record<string, number>;
  updatedAt: string;
}

/** Count the cast operators in a file's text. */
function countCasts(text: string): number {
  let n = 0;
  for (const pattern of CAST_PATTERNS) n += text.match(pattern)?.length ?? 0;
  return n;
}

/** Enumerate non-test framework source files (mirrors the eslint ignore set). */
function sourceFiles(): string[] {
  const glob = new Glob("packages/*/src/**/*.{ts,tsx}");
  const out: string[] = [];
  for (const file of glob.scanSync(ROOT)) {
    const rel = file.replace(/\\/g, "/");
    if (/\.(test|spec)\.tsx?$/.test(rel)) continue;
    if (/(^|\/)(__fixtures__|__test_migrations__|\.zerotal)\//.test(rel)) continue;
    if (/\.generated\./.test(rel)) continue;
    out.push(rel);
  }
  return out.sort();
}

/** Current cast count per source file (files with zero casts are omitted). */
function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rel of sourceFiles()) {
    const n = countCasts(readFileSync(resolve(ROOT, rel), "utf8"));
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

const update = process.argv.includes("--update");
const counts = currentCounts();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

const baseline: Baseline = existsSync(BASELINE_FILE)
  ? (JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline)
  : { boundaries: [], files: {}, updatedAt: "" };
const boundaries = new Set(baseline.boundaries);

if (update) {
  const files: Record<string, number> = {};
  for (const [rel, n] of Object.entries(counts)) {
    if (!boundaries.has(rel)) files[rel] = n;
  }
  const next: Baseline = {
    boundaries: [...boundaries].sort(),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n");
  const guarded = Object.keys(files).length;
  console.log(
    `\x1b[32m✓\x1b[0m cast baseline written: ${total} cast(s) across ${guarded} guarded file(s), ` +
      `${boundaries.size} boundary module(s).`,
  );
  process.exit(0);
}

// ── Check mode ────────────────────────────────────────────────────────────────
const regressions: string[] = [];
const improvements: string[] = [];

for (const [rel, now] of Object.entries(counts)) {
  if (boundaries.has(rel)) continue;
  const allowed = baseline.files[rel] ?? 0;
  if (now > allowed) {
    regressions.push(
      `  ${rel}: ${now} cast(s), baseline allows ${allowed}` +
        (allowed === 0 ? " (new cast in a previously-clean file)" : ` (+${now - allowed})`),
    );
  } else if (now < allowed) {
    improvements.push(`  ${rel}: ${now} < ${allowed}`);
  }
}
// A file that dropped to zero disappears from `counts`; surface it as an improvement.
for (const [rel, allowed] of Object.entries(baseline.files)) {
  if (allowed > 0 && !(rel in counts) && !boundaries.has(rel)) {
    improvements.push(`  ${rel}: 0 < ${allowed}`);
  }
}

if (regressions.length > 0) {
  console.error(
    `\x1b[31m✖ ${regressions.length} file(s) added casts above the baseline:\x1b[0m\n` +
      regressions.join("\n") +
      `\n\nRemove the cast (prefer a typed path or a contract), move it into the package's ` +
      `cast-boundary module, or — if it is genuinely irreducible — run \`bun run cast:check --update\` ` +
      `to move the baseline as a reviewed step.`,
  );
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m casting debt within baseline: ${total} cast(s), no regressions.`);
if (improvements.length > 0) {
  console.log(
    `\x1b[33m↓\x1b[0m ${improvements.length} file(s) below baseline — run ` +
      `\`bun run cast:check --update\` to lock in the reduction:\n` +
      improvements.slice(0, 20).join("\n"),
  );
}
