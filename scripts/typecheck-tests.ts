#!/usr/bin/env bun
/**
 * Type-check each package INCLUDING its `*.test.ts` files, gated on a recorded
 * per-package baseline — the third ratchet alongside `lint:ci` and `cast:check`.
 *
 * The normal `bun run typecheck` excludes tests (via each tsconfig's "exclude"),
 * so test files get no type coverage at all: a test can assert against a shape
 * the API never returns and still pass. This re-includes them per package by
 * writing a throwaway `tsconfig.spec.json` that extends the package config but
 * drops the test excludes, runs `tsc --noEmit` against it, then deletes it.
 *
 * Per-package (not one big program) so each package's own ambient `global.d.ts`
 * applies. Sibling packages' `global.d.ts` files are included too: a test may
 * import a workspace package that the package's own source never reaches, and
 * tsc then type-checks that package's source *without* its ambient declarations
 * — which reported `Cannot find name 'ServerWebSocket'` against
 * `@zerotal/broadcasting`'s own source rather than against any test. The
 * ambients are all `interface` declarations, so they merge rather than clash.
 *
 * The existing failures are grandfathered per package: new errors fail, and the
 * count can only be ratcheted down. Same rule as the other two baselines —
 * see CONTRIBUTING.md.
 *
 *   bun run typecheck:tests            # check against typecheck-tests-baseline.json
 *   bun run typecheck:tests --update   # (re)write the baseline to current counts
 */
import { Glob } from "bun";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASELINE_FILE = "typecheck-tests-baseline.json";

interface Baseline {
  /** Package name → permitted error count in its test files (the ratchet). */
  packages: Record<string, number>;
  total: number;
  updatedAt: string;
}

const shouldUpdate = process.argv.includes("--update");

// Sibling ambient declarations, so a package pulled in only by another
// package's *test* still type-checks with its own globals in scope.
const ambients = [...new Glob("packages/*/src/global.d.ts").scanSync(process.cwd())]
  .map((p) => `../${p.replace(/\\/g, "/").replace(/^packages\//, "")}`)
  .sort();

const SPEC = {
  extends: "./tsconfig.json",
  compilerOptions: { noEmit: true, composite: false, incremental: false },
  // `extends` does not inherit include/exclude — restate include, drop the test excludes.
  include: ["src/**/*", ...ambients],
  exclude: ["node_modules", "dist"],
};

const results: { pkg: string; errors: number }[] = [];

for await (const tsconfig of new Glob("packages/*/tsconfig.json").scan({ cwd: process.cwd() })) {
  const dir = dirname(tsconfig);
  const pkg = dir.replace(/\\/g, "/").split("/").pop()!;
  const specPath = `${dir}/tsconfig.spec.json`;
  await Bun.write(specPath, JSON.stringify(SPEC, null, 2));
  try {
    const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "-p", "tsconfig.spec.json"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    await proc.exited;
    const errors = (out.match(/error TS\d+/g) ?? []).length;
    if (errors > 0) {
      results.push({ pkg, errors });
      process.stdout.write(out);
    }
  } finally {
    await rm(specPath, { force: true });
  }
}

const current: Record<string, number> = {};
for (const r of results) current[r.pkg] = r.errors;
const total = results.reduce((n, r) => n + r.errors, 0);

console.log("\n── Test typecheck summary ──");
for (const r of results.sort((a, b) => b.errors - a.errors)) {
  console.log(`  ${String(r.errors).padStart(4)}  ${r.pkg}`);
}
console.log(`\n${total} error(s) in test files across ${results.length} package(s).`);

if (shouldUpdate || !existsSync(BASELINE_FILE)) {
  const baseline: Baseline = { packages: current, total, updatedAt: new Date().toISOString() };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`\x1b[32m✓\x1b[0m Baseline written to ${BASELINE_FILE}: ${total}.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
console.log(`Baseline: ${baseline.total}.`);

// Ratcheted per package, not on the total: a fix in one package must not fund a
// regression in another. This is the same reason lint:ci gates errors and
// warnings separately.
const regressions: string[] = [];
for (const [pkg, count] of Object.entries(current)) {
  const allowed = baseline.packages[pkg] ?? 0;
  if (count > allowed) regressions.push(`${pkg} ${count} > ${allowed}`);
}

if (regressions.length > 0) {
  console.error(
    `\x1b[31m✖ Test typecheck regressed: ${regressions.join("; ")}.\x1b[0m\n` +
      `Fix the new errors, or rerun with --update if the baseline should genuinely move.`,
  );
  process.exit(1);
}

const improved = Object.entries(baseline.packages).filter(
  ([pkg, allowed]) => (current[pkg] ?? 0) < allowed,
);
if (improved.length > 0) {
  console.log(
    `\x1b[33m↓\x1b[0m Below baseline in ${improved.map(([p]) => p).join(", ")}. ` +
      `Run \`bun run typecheck:tests --update\` to lock in the improvement.`,
  );
}
console.log("\x1b[32m✓\x1b[0m within baseline.");
