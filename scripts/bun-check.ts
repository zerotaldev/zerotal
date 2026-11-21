#!/usr/bin/env bun
/**
 * `bun check` in every workspace: Bun 1.4's type checker, run beside `tsc`.
 *
 * `bun check` reports TypeScript 7's errors and uses every core, about ten times faster than
 * `tsc --noEmit` on this repo. The plan is to make it the `typecheck`, and the condition for that
 * is that the two agree. On 21 Nov 2026 they agreed in 26 of 28 workspaces, and the other two
 * differed only on settings TypeScript 7 enforces and 5.8 did not (a `rootDir`, and declaration
 * output in an app that emits none). Both are fixed, so this keeps them agreeing: CI runs it on
 * the Bun-latest leg, since Bun 1.3 has no `bun check`.
 *
 *   bun run scripts/bun-check.ts
 *
 * @module
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Every workspace with a `tsconfig.json`, relative to the repository root. */
export function workspacesToCheck(root: string): string[] {
  const found: string[] = [];
  for (const pattern of ["packages/*/tsconfig.json", "apps/*/tsconfig.json"]) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      found.push(file.slice(0, -"/tsconfig.json".length));
    }
  }
  return found.sort();
}

if (import.meta.main) {
  const root = process.cwd();
  if (!existsSync(join(root, "packages"))) {
    console.error("Run from the repository root.");
    process.exit(2);
  }
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  if (major < 1 || (major === 1 && minor < 4)) {
    console.error(`bun check needs Bun 1.4 or later; this is Bun ${Bun.version}.`);
    process.exit(2);
  }

  const failed: string[] = [];
  for (const workspace of workspacesToCheck(root)) {
    const run = Bun.spawnSync([process.execPath, "check"], {
      cwd: join(root, workspace),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (run.exitCode === 0) continue;
    failed.push(workspace);
    console.error(`\n── ${workspace} ──\n${run.stdout.toString()}${run.stderr.toString()}`);
  }

  if (failed.length > 0) {
    console.error(
      `\n✖ bun check found type errors in ${failed.length} workspace(s): ${failed.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`✓ bun check: no type errors in ${workspacesToCheck(root).length} workspaces.`);
}
