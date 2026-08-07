#!/usr/bin/env bun
/**
 * Runs ESLint across the workspace and gates on a recorded violation baseline,
 * mirroring `scripts/lint-packages.ts`. New problems (above the baseline) fail CI;
 * pre-existing ones are grandfathered so the count can be ratcheted down over time.
 *
 *   bun run scripts/lint.ts            # check against lint-baseline.json
 *   bun run scripts/lint.ts --update   # (re)write the baseline to the current count
 */

import { ESLint } from "eslint";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = "lint-baseline.json";
const LINT_GLOBS = ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "scripts/**/*.ts"];

interface Baseline {
  total: number;
  errors: number;
  warnings: number;
  updatedAt: string;
}

const shouldUpdate = process.argv.includes("--update");

const eslint = new ESLint({ errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(LINT_GLOBS);

let errors = 0;
let warnings = 0;
for (const result of results) {
  errors += result.errorCount;
  warnings += result.warningCount;
}
const total = errors + warnings;

// Show the actual problems (stylish formatter) when there are any.
const formatter = await eslint.loadFormatter("stylish");
const formatted = await formatter.format(results);
if (formatted.trim()) console.log(formatted);

console.log(`\nESLint: ${errors} error(s), ${warnings} warning(s) — ${total} total.`);

if (shouldUpdate || !existsSync(BASELINE_FILE)) {
  const baseline: Baseline = { total, errors, warnings, updatedAt: new Date().toISOString() };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\x1b[32m✓\x1b[0m Baseline written to ${BASELINE_FILE}: ${total}.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
console.log(
  `Baseline: ${baseline.total} (errors ${baseline.errors}, warnings ${baseline.warnings}).`,
);

// Errors and warnings are ratcheted separately.
//
// Gating on the total alone made them fungible: the 2026-07 audit found six *new* errors
// introduced while the total fell, because warnings had dropped further — and the gate
// printed "within baseline". An error is a thing the project decided is not acceptable;
// trading one away for a warning is not an improvement.
const failures: string[] = [];
if (errors > baseline.errors) {
  failures.push(`errors ${errors} > baseline ${baseline.errors}`);
}
if (total > baseline.total) {
  failures.push(`total ${total} > baseline ${baseline.total}`);
}

if (failures.length > 0) {
  console.error(
    `\x1b[31m✖ Lint regressed: ${failures.join("; ")}.\x1b[0m\n` +
      `Fix the new problems, or rerun with --update if the baseline should genuinely move.`,
  );
  process.exit(1);
}

if (total < baseline.total || errors < baseline.errors) {
  console.log(
    `\x1b[33m↓\x1b[0m Below baseline (errors ${errors} ≤ ${baseline.errors}, ` +
      `total ${total} ≤ ${baseline.total}). ` +
      `Run \`bun run lint:ci --update\` to lock in the improvement.`,
  );
}
console.log("\x1b[32m✓\x1b[0m within baseline.");
