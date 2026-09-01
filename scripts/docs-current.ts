/**
 * Is the documentation site serving the version npm is serving?
 *
 * zerotal.dev is a separate git checkout of this repository, so a tag push
 * updates the registry and leaves the public documentation exactly where it was.
 * That is written down in the deployment notes, and it still drifted three
 * releases behind — because the last step of a release is a habit, and habits
 * lapse precisely when releases come fast and each one feels like a hotfix.
 *
 * The cost is not cosmetic. The upgrade guide is the page somebody reads
 * *because* npm handed them a new version, and under this project's versioning a
 * minor carries breaking changes — so the release whose migration notes matter
 * most is exactly the one a stale site fails to describe.
 *
 *   bun run scripts/docs-current.ts
 *
 * @module
 */
const NPM = "https://registry.npmjs.org/zerotal/latest";
const DOCS = "https://zerotal.dev/docs/changelog";

async function published(): Promise<string> {
  const response = await fetch(`${NPM}?cb=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`npm returned ${response.status}`);
  return ((await response.json()) as { version: string }).version;
}

/** The changelog page's text, or `null` when the site cannot be reached. */
async function live(): Promise<string | null> {
  try {
    const response = await fetch(`${DOCS}?cb=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const version = await published();
const page = await live();

if (page === null) {
  // Unreachable is a different finding from stale, and this check is not an
  // uptime monitor. Saying so and passing keeps it about the one question it asks.
  console.log(`⚠  Could not reach ${DOCS}. Not a staleness finding — check the site.`);
  process.exit(0);
}

if (page.includes(version)) {
  console.log(`\x1b[32m✓\x1b[0m zerotal.dev is serving ${version}, which is what npm has.`);
  process.exit(0);
}

console.error(
  `\n\x1b[31m✖ The documentation site is behind npm.\x1b[0m\n\n` +
    `    npm latest:      ${version}\n` +
    `    zerotal.dev:     does not mention ${version}\n\n` +
    `  Publishing does not deploy the docs — the site is a separate checkout. Redeploy:\n\n` +
    `    ssh root@207.180.223.80 "cd /opt/zerotal && git fetch origin main && \\\n` +
    `      git merge --ff-only origin/main && bun install && cd apps/docs && \\\n` +
    `      bun zt.ts deploy:production && systemctl restart zerotal-docs.service"\n\n` +
    `  The upgrade guide is the page somebody reads because npm handed them a new\n` +
    `  version. A stale one is worst on exactly the release that needed it most.\n`,
);
process.exit(1);
