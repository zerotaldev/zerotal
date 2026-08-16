#!/usr/bin/env bun
/**
 * Vendor the hand-written documentation into `@zerotal/arch`, so an installed
 * app can search the docs for the version it is actually running.
 *
 * `docs/` lives at the repo root and is in no package, which means it reaches
 * npm not at all. That is fine for a contributor reading the checkout and fatal
 * for the audience `search_docs` is built for — an app builder whose only copy
 * of Zerotal is `node_modules`. Copying the corpus into the package solves the
 * version-matching problem by construction: the pages an app searches are the
 * pages released with the `@zerotal/arch` it installed, and there is no index,
 * no embedding service, and nothing to keep in sync with a release.
 *
 *   bun run scripts/arch-docs.ts            # sync (write)
 *   bun run scripts/arch-docs.ts --check    # fail if the copy is stale
 *
 * `--check` runs in CI beside `api:surface:check`, for the same reason: a
 * generated artefact nobody verifies drifts, and a docs corpus that silently
 * describes last month's API is worse than none.
 *
 * ## What is excluded, and why it matters
 *
 * `docs/api/**` is typedoc output — 3,000+ files built from the very docblocks
 * being searched. Including it would multiply the corpus by twenty-five and bury
 * every hand-written page under generated reference stubs, which is the same
 * mistake `docs-coverage.ts` documents making.
 */
import { Glob } from "bun";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SOURCE_DIR = "docs";
const TARGET_DIR = "packages/arch/docs";
/** Generated reference output — see the module docblock. */
const EXCLUDED = ["api/"];

const check = process.argv.includes("--check");

/** Every hand-written page, as repo-relative POSIX paths. */
async function sourcePages(): Promise<string[]> {
  const pages: string[] = [];
  for await (const file of new Glob("**/*.md").scan({ cwd: SOURCE_DIR, onlyFiles: true })) {
    const relativePath = file.replace(/\\/g, "/");
    if (EXCLUDED.some((prefix) => relativePath.startsWith(prefix))) continue;
    pages.push(relativePath);
  }
  return pages.sort();
}

/** Every page currently vendored, so removals are noticed too. */
function vendoredPages(): string[] {
  if (!existsSync(TARGET_DIR)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".md")) out.push(relative(TARGET_DIR, path).replace(/\\/g, "/"));
    }
  };
  walk(TARGET_DIR);
  return out.sort();
}

const pages = await sourcePages();
const vendored = new Set(vendoredPages());

const added: string[] = [];
const changed: string[] = [];
const removed: string[] = [];

for (const page of pages) {
  const source = Bun.file(join(SOURCE_DIR, page));
  const target = Bun.file(join(TARGET_DIR, page));

  const text = await source.text();
  const existing = (await target.exists()) ? await target.text() : undefined;

  if (existing === undefined) added.push(page);
  else if (existing !== text) changed.push(page);

  vendored.delete(page);

  if (!check && existing !== text) {
    mkdirSync(dirname(resolve(TARGET_DIR, page)), { recursive: true });
    await Bun.write(join(TARGET_DIR, page), text);
  }
}

// Anything left in `vendored` is a page that was deleted or renamed upstream.
// Leaving it would let a removed page keep answering searches forever.
for (const orphan of vendored) {
  removed.push(orphan);
  if (!check) rmSync(resolve(TARGET_DIR, orphan), { force: true });
}

const drift = added.length + changed.length + removed.length;

if (check) {
  if (drift > 0) {
    console.error(
      `\x1b[31m✖ The vendored docs corpus is stale (${drift} file(s)):\x1b[0m\n` +
        [
          ...added.map((page) => `    + ${page}`),
          ...changed.map((page) => `    ~ ${page}`),
          ...removed.map((page) => `    - ${page}`),
        ]
          .slice(0, 40)
          .join("\n") +
        (drift > 40 ? `\n    … and ${drift - 40} more` : "") +
        `\n\nRun \`bun run arch:docs\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`\x1b[32m✓\x1b[0m Vendored docs match ${SOURCE_DIR}/ (${pages.length} pages).`);
} else {
  console.log(
    `\x1b[32m✓\x1b[0m Vendored ${pages.length} page(s) into ${TARGET_DIR}` +
      (drift > 0
        ? ` — ${added.length} added, ${changed.length} updated, ${removed.length} removed.`
        : " — already up to date."),
  );
}
