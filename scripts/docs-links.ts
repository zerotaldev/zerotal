/**
 * Every link in the documentation must arrive.
 *
 * On 29 Oct 2026 the hand-written docs carried 22 links that went nowhere on
 * zerotal.dev, and nothing had noticed. Nineteen pointed at a heading by an id
 * the site never generates: `#1-10-to-1-11` where `## 1.10 to 1.11` renders as
 * `110-to-111`, or `#presence--whos-here` where the renderer collapses the
 * hyphens an em-dash leaves behind. Three were relative `cache.md` links, which
 * work on GitHub and 404 on the site, because the site serves `/docs/cache`.
 * Each one was correct to whoever wrote it: they guessed an id, or previewed
 * the file somewhere other than where it is read.
 *
 * So this renders every page the way the site does, with `Bun.markdown` and the
 * same options, collects the ids that rendering produces, and checks every link
 * against them: the page must exist and the anchor must be one of its ids.
 * Links in fenced code are never checked, because they are not rendered as links.
 *
 *   bun run scripts/docs-links.ts
 *
 * @module
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { Glob } from "bun";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const DOCS = join(ROOT, "docs");

/** The options `apps/docs/routes/index.ts` renders a page with. */
const MARKDOWN_OPTIONS = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
};

/** Generated API reference — TypeDoc owns its links, and is not hand-written prose. */
const GENERATED = /^docs\/api\//;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

function render(file: string): string {
  const source = readFileSync(file, "utf8").replace(FRONTMATTER, "");
  return Bun.markdown.html(source, MARKDOWN_OPTIONS);
}

const idCache = new Map<string, Set<string>>();

/** The heading ids a page renders with, which are the anchors it can be linked at. */
function idsOf(file: string): Set<string> {
  let ids = idCache.get(file);
  if (!ids) {
    ids = new Set([...render(file).matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]!)));
    idCache.set(file, ids);
  }
  return ids;
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The file the site serves for a `/docs/...` path, the way `resolveDocument` finds it. */
function sitePage(path: string): string | null {
  const slug = path.replace(/^\/docs\/?/, "").replace(/\/$/, "") || "index";
  for (const candidate of [join(DOCS, `${slug}.md`), join(DOCS, slug, "index.md")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface Broken {
  file: string;
  href: string;
  reason: string;
}

/**
 * Check one link from `source`. `onSite` is whether the page is read at
 * zerotal.dev (everything under `docs/`) rather than on GitHub or npm, where a
 * relative `.md` path is how one file links another.
 */
function check(source: string, href: string, onSite: boolean): string | null {
  const hash = href.indexOf("#");
  const path = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? null : decodeURIComponent(href.slice(hash + 1));

  let target: string | null;
  if (path === "") {
    target = source;
  } else if (path.startsWith("https://zerotal.dev/docs") || path.startsWith("/docs")) {
    const sitePath = path.replace(/^https:\/\/zerotal\.dev/, "");
    if (/^\/docs\/api(\/|$)/.test(sitePath)) return null;
    target = sitePage(sitePath);
    if (!target) return "no such page";
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/")) {
    return null; // another site, mail, or a non-docs route of this one
  } else {
    if (onSite) return "a relative path 404s on the site; link `/docs/<page>`";
    target = normalize(join(dirname(source), path));
    if (!existsSync(target)) return "no such file";
    if (!target.endsWith(".md")) return null;
  }

  if (anchor !== null && anchor !== "" && !idsOf(target).has(anchor)) {
    return `no heading renders as #${anchor}`;
  }
  return null;
}

const broken: Broken[] = [];
let links = 0;

for (const pattern of ["docs/**/*.md", "README.md", "packages/*/README.md"]) {
  for (const rel of new Glob(pattern).scanSync({ cwd: ROOT, onlyFiles: true })) {
    const key = rel.replace(/\\/g, "/");
    if (GENERATED.test(key)) continue;
    const file = join(ROOT, key);
    const onSite = key.startsWith("docs/");
    for (const match of render(file).matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
      const href = decode(match[1]!);
      links++;
      const reason = check(file, href, onSite);
      if (reason) broken.push({ file: key, href, reason });
    }
  }
}

if (broken.length > 0) {
  console.error(`✗ ${broken.length} of ${links} documentation links go nowhere:\n`);
  for (const { file, href, reason } of broken) {
    console.error(`  ${file}  ${href}\n    ${reason}`);
  }
  console.error(
    "\nAn anchor is the id the site renders, not one written by hand: lowercase, punctuation" +
      "\ndropped, runs of hyphens collapsed. Open the page on the site and copy the heading's link.",
  );
  process.exit(1);
}

console.log(`✓ all ${links} documentation links arrive (${relative(ROOT, DOCS)}/, READMEs)`);
