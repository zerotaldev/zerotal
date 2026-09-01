/**
 * The documentation must not teach a command the framework refuses.
 *
 * `serve --dev` was retired in 1.13.0. That release updated the runner, the
 * `zt upgrade` codemod, `docs/commands.md` and `docs/upgrade.md` — and left the
 * form in **twenty other places**: the getting-started guide, the assets guide,
 * two Flow pages, the logger page, the root README and the scaffolder's own. For
 * three weeks the front-door documentation told newcomers to run a command that
 * exits 1.
 *
 * Retiring something means finding every place that teaches it, and "every place"
 * is not a thing anyone recalls accurately. So this reads the codemod's own list
 * of retired forms — the same source `zt upgrade` migrates apps with — and scans
 * the prose against it.
 *
 *   bun run scripts/retired-commands-check.ts
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { CODEMODS } from "../packages/core/src/upgrade/codemods/index.ts";
import { compareVersions } from "../packages/core/src/upgrade/types.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

/**
 * Pages that name a retired form because their subject *is* the retirement.
 *
 * Deliberately short and deliberately explicit. A page earns a place here by
 * explaining what to migrate away from, which is the one job that requires
 * writing the old spelling down.
 */
const DESCRIBES_RETIREMENT = new Set([
  "docs/upgrade.md", // the migration guide, per version
  "docs/changelog.md", // the release notes that announced each retirement
  "docs/commands.md", // names the old spelling once, to say it now fails
]);

/** Generated API reference — mirrors docblocks, and is not hand-written prose. */
const GENERATED = /^docs\/api\//;

function prose(): { file: string; contents: string }[] {
  const files: { file: string; contents: string }[] = [];

  for (const pattern of ["docs/**/*.md", "README.md", "packages/*/README.md"]) {
    for (const rel of new Glob(pattern).scanSync({ cwd: ROOT, onlyFiles: true })) {
      const key = rel.replace(/\\/g, "/");
      if (DESCRIBES_RETIREMENT.has(key) || GENERATED.test(key)) continue;
      files.push({ file: key, contents: readFileSync(`${ROOT}/${key}`, "utf8") });
    }
  }
  return files;
}

/**
 * Only retirements that have actually shipped.
 *
 * A codemod for 2.0 describes a rename the framework has not made, so prose using
 * the current spelling is correct and flagging it would be noise — and noise is
 * how a gate becomes something people add exclusions to rather than read.
 */
const current = (await Bun.file(new URL("../package.json", import.meta.url)).json())
  .version as string;
const shipped = CODEMODS.filter((c) => compareVersions(c.version, current) <= 0);

const files = prose();
if (files.length < 20) {
  // A scan that silently covers nothing passes forever.
  console.error(`✖ Only ${files.length} file(s) scanned — the glob is wrong.`);
  process.exit(1);
}

// Every codemod's rewrite is, by definition, a form nobody should be taught.
const findings = shipped.flatMap((codemod) =>
  codemod.run(files).changes.map((change) => ({ codemod: codemod.name, ...change })),
);

console.log(`\n── Retired commands in prose ──\n`);
console.log(`  ${files.length} page(s) scanned against ${shipped.length} shipped retirement(s)\n`);

if (findings.length === 0) {
  console.log("\x1b[32m✓\x1b[0m nothing documented that the framework would refuse.");
  process.exit(0);
}

console.error(`\x1b[31m✖ ${findings.length} page(s) teach a retired command:\x1b[0m\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}`);
  console.error(`    ${finding.summary}  (${finding.codemod})`);
}
console.error(
  `\n  Rewrite them to the current spelling. A page whose subject *is* the` +
    `\n  retirement — a migration note, a changelog entry — belongs in` +
    `\n  DESCRIBES_RETIREMENT in this script, with a reason.\n`,
);
process.exit(1);
