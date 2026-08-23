/**
 * The upgrade runner: read the tree once, apply the codemods a version gap
 * calls for, and report before writing anything.
 *
 * `scripts/codemod-mixin-composition.ts` proved the shape on a real 1.3.0 break
 * — walk the tree, rewrite call sites, fix the imports a find-and-replace would
 * have broken, offer `--dry`. This generalises that one-off into something a
 * release can hand to users, which is what `zt upgrade` has to be if the 2.0
 * ledger is ever going to be payable.
 *
 * Three properties it keeps:
 *
 * **Nothing is written until the whole plan is known.** Codemods return the new
 * contents rather than writing, so a run that fails halfway leaves no
 * half-upgraded tree, and `--dry` is the same code path as the real thing rather
 * than a separate one that can drift from it.
 *
 * **Running twice is safe.** Every codemod is expected to be idempotent, and the
 * second run is the test: it should report no changes. That matters because the
 * first thing anyone does after an upgrade that printed warnings is run it again.
 *
 * **What it could not do is the headline.** See `Manual` in `./types.ts`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import type { Change, Codemod, Manual, SourceFile } from "./types.ts";
import { compareVersions } from "./types.ts";

/** Never walked. Build output and dependencies are not the app's source. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".zerotal",
  ".release-tarballs",
]);

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".md", ".mdx"];

export interface UpgradePlan {
  /** Codemods selected for this version gap, in the order they will run. */
  codemods: Codemod[];
  /** Every rewrite, keyed by file — later codemods see earlier ones' output. */
  changes: Map<string, Change>;
  manual: Manual[];
  /** Files read, for the "scanned N files" line. */
  scanned: number;
}

/** Every source file under `root`, relative-pathed and forward-slashed. */
export async function collectFiles(root: string, extensions: string[]): Promise<SourceFile[]> {
  const wanted = new Set(extensions);
  const out: SourceFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not a reason to abandon an upgrade
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!wanted.has(extname(entry.name))) continue;
      out.push({
        file: relative(root, full).replace(/\\/g, "/"),
        contents: await readFile(full, "utf8"),
      });
    }
  }

  await walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The codemods that apply to a move from `from` to `to`.
 *
 * Exclusive of `from`, inclusive of `to`: an app already on 1.8.0 has paid
 * 1.8.0's codemods, and an app moving *to* 2.0.0 owes 2.0.0's.
 */
export function selectCodemods(all: Codemod[], from: string, to: string): Codemod[] {
  return all
    .filter((c) => compareVersions(c.version, from) > 0 && compareVersions(c.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version) || a.name.localeCompare(b.name));
}

/**
 * Build the plan without touching disk.
 *
 * Codemods run in sequence over the *accumulated* contents, so a later one sees
 * what an earlier one produced. Two codemods rewriting the same line is a real
 * possibility across a version range, and the alternative — each reading the
 * original — silently drops one of them.
 */
export async function planUpgrade(
  root: string,
  codemods: Codemod[],
  from: string,
  to: string,
): Promise<UpgradePlan> {
  const selected = selectCodemods(codemods, from, to);
  const extensions = [...new Set(selected.flatMap((c) => c.extensions ?? DEFAULT_EXTENSIONS))];
  const files = await collectFiles(root, extensions.length ? extensions : DEFAULT_EXTENSIONS);

  const current = new Map(files.map((f) => [f.file, f.contents]));
  const changes = new Map<string, Change>();
  const manual: Manual[] = [];

  for (const codemod of selected) {
    const wanted = new Set(codemod.extensions ?? DEFAULT_EXTENSIONS);
    const input: SourceFile[] = [...current]
      .filter(([file]) => wanted.has(extname(file)))
      .map(([file, contents]) => ({ file, contents }));

    const result = codemod.run(input);
    for (const change of result.changes) {
      current.set(change.file, change.contents);
      const existing = changes.get(change.file);
      changes.set(change.file, {
        file: change.file,
        // One line per file in the report, so a file touched by two codemods
        // reads as one entry naming both rather than appearing twice.
        summary: existing ? `${existing.summary}; ${change.summary}` : change.summary,
        contents: change.contents,
      });
    }
    manual.push(...result.manual);
  }

  return { codemods: selected, changes, manual, scanned: files.length };
}

/** Write the plan. Separate from building it, so `--dry` shares every other step. */
export async function applyPlan(root: string, plan: UpgradePlan): Promise<number> {
  for (const change of plan.changes.values()) {
    await writeFile(join(root, change.file), change.contents, "utf8");
  }
  return plan.changes.size;
}
