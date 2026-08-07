#!/usr/bin/env bun
// Imported from source rather than the package entry: PackageLinter is repo tooling that
// checks *this* monorepo's package.json files, not something apps consume, so it does not
// belong in core's public surface. The barrel import it used to have simply did not resolve,
// which is why this script crashed rather than reporting anything.
import { lintPackages, countViolations } from "../packages/core/src/build/PackageLinter.ts";

const args = process.argv.slice(2);
const maxIdx = args.indexOf("--max");
const max = maxIdx >= 0 ? Number(args[maxIdx + 1] ?? 0) : 0;
const dir = args.find((a, i) => !a.startsWith("--") && i !== maxIdx + 1) ?? "./packages";

const SEV = { high: "\x1b[31m", medium: "\x1b[33m", low: "\x1b[2m" } as const;
const RESET = "\x1b[0m";

const reports = await lintPackages(dir);
const total = countViolations(reports);
const clean = reports.filter((r) => r.violations.length === 0).length;
for (const r of reports) {
  if (r.violations.length === 0) {
    console.log(`  \x1b[32m✓\x1b[0m ${r.package}`);
    continue;
  }
  console.log(`  \x1b[31m✗\x1b[0m ${r.package}`);
  for (const v of r.violations)
    console.log(
      `      ${SEV[v.severity]}${v.severity.padEnd(6)}${RESET} ${v.rule.padEnd(22)} ${v.message}`,
    );
}
console.log("");
console.log(
  `${reports.length} packages · ${clean} clean · ${total} violation(s) · baseline ${max}`,
);
if (total > max) {
  console.error(`\x1b[31m✖ ${total} violations exceed the allowed baseline of ${max}.\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m✓ within baseline.\x1b[0m`);
