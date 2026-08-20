#!/usr/bin/env bun
/**
 * Move every package's `[Unreleased]` entries under the version being released.
 *
 *   bun run scripts/changelog-release.ts 1.7.4
 *
 * Run it as part of cutting a release, with the version bump and before the tag.
 *
 * ## Why this exists
 *
 * A release bumps 28 manifests and adds a section to `docs/changelog.md`, and until
 * now touched each package CHANGELOG not at all. So `[Unreleased]` accumulated
 * across releases: by 1.7.3, `@zerotal/flow` and `@zerotal/core` still had `[1.7.1]`
 * as their newest heading, `@zerotal/orm` `[1.7.0]`, `@zerotal/flow-ui` `[1.5.0]` —
 * four releases of shipped work filed under a heading that says it has not shipped.
 *
 * That is worse than no changelog. Someone taking 1.7.3 reads "Unreleased" and
 * reasonably concludes none of it is in the version they are installing, when all
 * of it is.
 *
 * There is deliberately no `--check` companion. Entries under `[Unreleased]` are
 * exactly where in-flight work belongs, so their presence proves nothing on its
 * own — a gate here would either fire on every ordinary commit or assert nothing.
 * What keeps this honest is running it, which the release checklist now says to do.
 */
import { readdirSync } from "node:fs";

const version = process.argv.slice(2).find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!version) {
  console.error("usage: bun run scripts/changelog-release.ts <version>");
  process.exit(1);
}

/** Entries sitting under `[Unreleased]`, as raw text. */
function unreleasedBody(md: string): string {
  const start = md.indexOf("## [Unreleased]");
  if (start === -1) return "";
  const after = start + "## [Unreleased]".length;
  const next = md.indexOf("\n## ", after);
  return md.slice(after, next === -1 ? undefined : next).trim();
}

const today = new Date().toISOString().slice(0, 10);
let moved = 0;

for (const dir of readdirSync("packages").sort()) {
  const path = `packages/${dir}/CHANGELOG.md`;
  if (!(await Bun.file(path).exists())) continue;

  const md = await Bun.file(path).text();
  const body = unreleasedBody(md);
  if (!body) continue;

  await Bun.write(
    path,
    md.replace(
      /## \[Unreleased\][\s\S]*?(?=\n## |$)/,
      `## [Unreleased]\n\n## [${version}] — ${today}\n\n${body}\n`,
    ),
  );
  moved++;
  console.log(`  ${dir} → [${version}]`);
}

console.log(
  moved
    ? `\n✓ Moved ${moved} package changelog(s) to [${version}].`
    : "\n✓ No package had entries under [Unreleased].",
);
