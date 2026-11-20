#!/usr/bin/env bun
/**
 * `bun.lock` stays in a format the oldest supported Bun can read.
 *
 * Bun 1.4 writes `"lockfileVersion": 2` (3 when overrides nest), and Bun 1.3.14
 * cannot read either. CI's floor leg, the release workflow and the docs server all
 * run 1.3.14, and every one of them installs with `--frozen-lockfile` — so one
 * `bun install` on a newer Bun rewrites the file into something none of them can
 * install from, and the diff looks like a routine dependency bump.
 *
 * This fails when the version is anything but the one 1.3.14 reads, and says how
 * to put it back.
 *
 *   bun run scripts/lockfile-check.ts
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The `lockfileVersion` every supported Bun can read. */
export const SUPPORTED_LOCKFILE_VERSION = 1;

/** The Bun that is the floor, and so the one a lockfile must be written by. */
export const FLOOR_BUN = "1.3.14";

/**
 * The `lockfileVersion` a `bun.lock` declares, or `null` when it declares none.
 *
 * Read with a pattern rather than a parse: a lockfile from a newer Bun may not be
 * something this Bun's parser accepts, and that is the case this has to report.
 */
export function lockfileVersion(text: string): number | null {
  const match = /"lockfileVersion"\s*:\s*(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/** What is wrong with a lockfile's version, or `null` when nothing is. */
export function lockfileProblem(text: string): string | null {
  const version = lockfileVersion(text);
  if (version === SUPPORTED_LOCKFILE_VERSION) return null;
  const found = version === null ? "declares no lockfileVersion" : `is lockfileVersion ${version}`;
  return (
    `bun.lock ${found}; it must be ${SUPPORTED_LOCKFILE_VERSION}, the format Bun ${FLOOR_BUN} reads.\n` +
    `  A newer Bun rewrote it, and CI, the release workflow and the docs server install with ` +
    `Bun ${FLOOR_BUN}, which cannot read the result.\n` +
    `  Put back the committed bun.lock (git checkout -- bun.lock), then regenerate it with ` +
    `Bun 1.3.x:\n` +
    `    bunx bun@${FLOOR_BUN} install`
  );
}

function main(): void {
  const path = join(import.meta.dir, "..", "bun.lock");
  const problem = lockfileProblem(readFileSync(path, "utf8"));
  console.log(`\n── Lockfile format ──\n`);
  if (problem) {
    console.error(`\x1b[31m✖\x1b[0m ${problem}\n`);
    process.exit(1);
  }
  console.log(
    `\x1b[32m✓\x1b[0m bun.lock is lockfileVersion ${SUPPORTED_LOCKFILE_VERSION}, readable by Bun ${FLOOR_BUN}.`,
  );
}

if (import.meta.main) main();
