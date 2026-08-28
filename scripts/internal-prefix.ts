#!/usr/bin/env bun
/**
 * The `_` prefix on internal exports — a habit, ratcheted into a convention.
 *
 * `reserved-members.test.ts` asserts that `Component`'s internals are
 * underscore-prefixed. Nothing checked anywhere else, and it showed: `admin` alone
 * exports a dozen `@internal` helpers with no prefix — `flattenActions`,
 * `makeResourceForm`, `parseRuleTree` — and they are not alone. So "internals are
 * `_`-prefixed" was true of one class and roughly half-true of the tree, which is
 * the state a rule reaches just before nobody believes it.
 *
 * The prefix earns its keep twice. It tells a reader of the *call site* that they
 * are looking at framework plumbing, with no doc page and no stability promise,
 * without making them find the declaration. And it keeps the docs-coverage gate
 * honest: `@internal` removes an export from the promised set, so an unprefixed
 * `@internal` export is a name that looks public in every listing and is not.
 *
 * ## Why a ratchet rather than a rule
 *
 * These names are **exported**. Renaming the 80-odd that exist today is a breaking
 * change to anything reaching for them, and a large one to review in a single step
 * — exactly the kind of change the 2.0 ledger exists to hold. So this counts them
 * per package and gates the count: a package may drop its number freely and may
 * not raise it. New internals get the prefix because the gate says so; the
 * existing ones move when someone chooses to move them.
 *
 * That is the same shape as `cast-baseline.json` and `lint-baseline.json`, for the
 * same reason: debt you can see and cannot grow stops being debt that surprises
 * you.
 *
 *   bun run scripts/internal-prefix.ts            # fail if a package exceeds its baseline
 *   bun run scripts/internal-prefix.ts --update   # rewrite the baseline to current counts
 *   bun run scripts/internal-prefix.ts --list     # name every unprefixed internal export
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";

const BASELINE_FILE = "internal-prefix-baseline.json";
const ROOT = resolve(".");

interface Baseline {
  /** Package name → permitted count of unprefixed `@internal` exports. */
  packages: Record<string, number>;
  updatedAt: string;
  /**
   * Why the number last moved.
   *
   * A ratchet that only ever goes down needs no note. This one can legitimately go
   * *up*: marking a plumbing export `@internal` — which is the right thing to do,
   * and what the docs-coverage gate asks for — reveals debt that was already there
   * and merely undeclared. That is the measurement getting more honest, not the
   * tree getting worse, and the distinction is invisible in a bare number.
   */
  note?: string;
}

/** One export marked `@internal` whose name does not start with `_`. */
export interface Finding {
  pkg: string;
  file: string;
  name: string;
}

/**
 * Names exported with an `@internal` docblock and no `_` prefix.
 *
 * The marker has to be in the docblock immediately above the export — a file-level
 * `@internal` in a `@module` block marks the whole module, and the exports under it
 * are not individually at fault. Looking only at the preceding comment keeps this
 * from indicting an entire internal module for existing.
 */
export function unprefixedInternalExports(source: string): string[] {
  const found: string[] = [];
  // Each docblock plus whatever export statement follows it.
  // The docblock body must not itself contain `*/`. Without that guard the lazy
  // quantifier backtracks across intervening code, letting an `@internal` block
  // five declarations earlier claim whichever export happens to follow the next
  // `*/` — which reported public helpers as unprefixed internals.
  const pattern =
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?(function|const|let|class)\s+(\w+)/g;
  for (const match of source.matchAll(pattern)) {
    const doc = match[1] ?? "";
    const name = match[3] ?? "";
    if (!/@internal\b/.test(doc)) continue;
    // A `@module`/`@packageDocumentation` block describes the file, not the symbol
    // that happens to follow it.
    if (/@(module|packageDocumentation)\b/.test(doc)) continue;
    if (name.startsWith("_")) continue;
    found.push(name);
  }
  return found;
}

/** Walk the packages and collect every finding. */
async function scan(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const glob = new Glob("packages/*/src/**/*.ts");
  for await (const file of glob.scan({ cwd: ROOT })) {
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;
    if (file.includes("__fixtures__")) continue;
    const pkg = file.split(/[\\/]/)[1] ?? "";
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const name of unprefixedInternalExports(text)) {
      findings.push({ pkg, file: file.replaceAll("\\", "/"), name });
    }
  }
  return findings;
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const update = process.argv.includes("--update");
  const list = process.argv.includes("--list");

  const findings = await scan();
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.pkg] = (counts[f.pkg] ?? 0) + 1;
  const total = findings.length;

  if (list) {
    for (const f of findings.sort((a, b) => a.file.localeCompare(b.file))) {
      console.log(`  ${f.file}  ${f.name}`);
    }
  }

  if (update) {
    const noteFlag = process.argv.indexOf("--note");
    const note = noteFlag >= 0 ? process.argv[noteFlag + 1] : undefined;
    const previous = existsSync(resolve(ROOT, BASELINE_FILE))
      ? (JSON.parse(readFileSync(resolve(ROOT, BASELINE_FILE), "utf8")) as Baseline)
      : undefined;
    const next: Baseline = {
      packages: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
      updatedAt: new Date().toISOString().slice(0, 10),
      ...((note ?? previous?.note) ? { note: note ?? previous?.note } : {}),
    };
    writeFileSync(resolve(ROOT, BASELINE_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\x1b[32m✓\x1b[0m wrote ${BASELINE_FILE}: ${total} unprefixed internal export(s).`);
    process.exit(0);
  }

  if (!existsSync(resolve(ROOT, BASELINE_FILE))) {
    console.error(`✖ ${BASELINE_FILE} is missing. Run with --update to create it.`);
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(resolve(ROOT, BASELINE_FILE), "utf8")) as Baseline;
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const [pkg, now] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = baseline.packages[pkg] ?? 0;
    if (now > allowed) regressions.push(`  ${pkg}: ${now} > ${allowed}`);
    else if (now < allowed) improvements.push(`  ${pkg}: ${now} < ${allowed}`);
  }
  // A package that reached zero drops out of `counts` entirely.
  for (const [pkg, allowed] of Object.entries(baseline.packages)) {
    if (allowed > 0 && !(pkg in counts)) improvements.push(`  ${pkg}: 0 < ${allowed}`);
  }

  if (regressions.length > 0) {
    console.error(
      `\x1b[31m✖ ${regressions.length} package(s) added an unprefixed \`@internal\` export:\x1b[0m\n` +
        regressions.join("\n") +
        `\n\nPrefix the new one with \`_\` — that is what marks it as plumbing at every call ` +
        `site, and \`@internal\` alone does not. Run with --list to see the names. If a name ` +
        `genuinely cannot take the prefix, move the baseline with --update as a reviewed step.`,
    );
    process.exit(1);
  }

  console.log(
    `\x1b[32m✓\x1b[0m internal-prefix debt within baseline: ${total} unprefixed export(s), no regressions.`,
  );
  if (improvements.length > 0) {
    console.log(
      `\x1b[33m↓\x1b[0m ${improvements.length} package(s) below baseline — run ` +
        `\`bun run internal:prefix --update\` to lock in the reduction:\n` +
        improvements.join("\n"),
    );
  }
}
