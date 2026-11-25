/**
 * The documentation as text, for readers that are not browsers.
 *
 * A coding agent asked about the framework fetches a page and has to dig the
 * prose out of a sidebar, a header, a search box and a footer — or it reads a
 * Markdown copy that is the page and nothing else. Every docs page now has one,
 * at the page's URL with `.md` added, and the same copy is what a request that
 * asks for `text/markdown` receives at the plain URL.
 *
 * `/llms.txt` is the index: every page by section, each linking to its Markdown
 * copy with the description from its frontmatter. `/llms-full.txt` is the whole
 * guide in one file, for tools that would rather load it once than follow links.
 *
 * The copies are the source files, frontmatter removed. Not rendered and
 * converted back: the source is already the cleanest form of the page, and a
 * round trip through HTML is a way to lose a code fence's language.
 */

import { join } from "node:path";
import { docPath, extractTitle, listDocSlugs, parseFrontmatter } from "./helpers.ts";

/** Pages left out of `/llms-full.txt`: history, not guidance, and the largest page by far. */
export const FULL_TEXT_EXCLUDED: ReadonlySet<string> = new Set(["changelog"]);

/**
 * The HTML path a `.md` request is for, or `null` when it is not one.
 *
 * `/docs.md` is the overview, the one page whose URL has no slug to append to.
 */
export function markdownTarget(pathname: string): string | null {
  if (!pathname.endsWith(".md")) return null;
  const path = pathname.slice(0, -".md".length);
  if (path === "/docs") return "/docs";
  return path.startsWith("/docs/") ? path : null;
}

/** The Markdown copy's URL for a page's canonical path. */
export function markdownPath(htmlPath: string): string {
  return `${htmlPath}.md`;
}

/**
 * Whether a request would rather have Markdown than HTML.
 *
 * Only an explicit `text/markdown` counts, and only when it outranks `text/html`
 * or the header does not mention HTML at all. A browser sends `text/html` first
 * and `*\/*` last, and must keep getting the page.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const ranked = accept
    .split(",")
    .map((part, index) => {
      const [type = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { type: type.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.q > 0);
  const markdown = ranked.find((entry) => entry.type === "text/markdown");
  if (!markdown) return false;
  const html = ranked.find((entry) => entry.type === "text/html");
  if (!html) return true;
  return markdown.q > html.q || (markdown.q === html.q && markdown.index < html.index);
}

/**
 * A Markdown response for one page.
 *
 * The `Link` header names the HTML page as canonical, so a search engine that
 * finds the copy files it under the page rather than as a second one. `Vary`,
 * because the plain URL now answers in two formats depending on `Accept`.
 */
export function markdownResponse(markdown: string, canonicalUrl: string): Response {
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${canonicalUrl}>; rel="canonical"`,
      Vary: "Accept",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** One page as the text indexes describe it. */
export interface TextPage {
  /** Canonical HTML path, e.g. `/docs/orm`. */
  path: string;
  title: string;
  description?: string;
  /** The sidebar section it sits under, or `undefined` for a page the sidebar does not list. */
  group?: string;
}

/**
 * Every hand-written page, in the sidebar's reading order, with its Markdown.
 *
 * The generated API tree is left out, as the sitemap leaves it out: thousands of
 * reference stubs would bury the guide, and `api_surface` answers those questions
 * exactly. A page the sidebar does not list comes after the ones it does.
 *
 * @param dir - The docs corpus. A parameter so tests can run without a booted app.
 * @param nav - The sidebar's pages, in order, from `navPages()`.
 */
export async function collectTextPages(
  dir: string,
  nav: readonly { slug: string; group: string }[],
): Promise<(TextPage & { slug: string; markdown: string })[]> {
  const slugs = await listDocSlugs(dir);
  const position = new Map(nav.map((page, index) => [page.slug, index]));
  const groupOf = new Map(nav.map((page) => [page.slug, page.group]));
  const ordered = [...slugs].sort(
    (a, b) =>
      (position.get(a) ?? Number.MAX_SAFE_INTEGER) - (position.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b),
  );

  const pages: (TextPage & { slug: string; markdown: string })[] = [];
  for (const slug of ordered) {
    const direct = Bun.file(join(dir, `${slug}.md`));
    const file = (await direct.exists()) ? direct : Bun.file(join(dir, slug, "index.md"));
    const { data, content } = parseFrontmatter(await file.text());
    const group = groupOf.get(slug);
    pages.push({
      slug,
      path: docPath(slug),
      title: data["title"] ?? extractTitle(content, slug),
      markdown: content.trimStart(),
      ...(data["description"] ? { description: data["description"] } : {}),
      ...(group !== undefined ? { group } : {}),
    });
  }
  return pages;
}

/**
 * `/llms.txt`: a heading, a summary, then the pages by section.
 *
 * Sections keep the sidebar's order, because that order is the guide's — getting
 * started before routing before the ORM. Pages the sidebar does not list come
 * last, under "Optional" with the release notes, which is the section the format
 * reserves for what a reader with a tight budget can skip.
 */
export function buildLlmsTxt(pages: readonly TextPage[], site: string): string {
  const groups = new Map<string, TextPage[]>();
  const optional: TextPage[] = [];
  for (const page of pages) {
    if (page.group === undefined || FULL_TEXT_EXCLUDED.has(page.path.replace(/^\/docs\/?/, ""))) {
      optional.push(page);
      continue;
    }
    const list = groups.get(page.group) ?? [];
    list.push(page);
    groups.set(page.group, list);
  }

  const line = (page: TextPage): string =>
    `- [${page.title}](${site}${markdownPath(page.path)})${page.description ? `: ${page.description}` : ""}`;

  const out = [
    "# Zerotal",
    "",
    "> A batteries-included, full-stack TypeScript framework for Bun: routing, an ORM, auth, " +
      "validation, jobs, mail and notifications, realtime, an admin panel, tenancy and AI, " +
      "from one dependency tree, on any host.",
    "",
    `Every page below is the Markdown copy of a page on ${site}. The whole guide is also one ` +
      `file at ${site}/llms-full.txt. An app's own coding agent gets the same pages, for the ` +
      "version it has installed, from the `search_docs` tool in `@zerotal/arch`.",
    "",
  ];
  for (const [group, list] of groups) {
    out.push(`## ${group}`, "", ...list.map(line), "");
  }
  if (optional.length > 0) out.push("## Optional", "", ...optional.map(line), "");
  return out.join("\n");
}

/**
 * `/llms-full.txt`: every page in reading order, each under a line naming its URL.
 *
 * @param pages - Pages in the order they should appear, with their Markdown bodies.
 */
export function buildLlmsFullTxt(
  pages: readonly (TextPage & { markdown: string })[],
  site: string,
): string {
  const parts = [
    "# Zerotal documentation",
    "",
    `The full guide from ${site}/docs, one page after another. Release notes are left out; ` +
      `they are at ${site}/docs/changelog.md.`,
  ];
  for (const page of pages) {
    parts.push("", "---", "", `Source: ${site}${page.path}`, "", page.markdown.trim());
  }
  return parts.join("\n") + "\n";
}
