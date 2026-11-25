import { Router } from "zerotal";
import { assetVersion } from "zerotal/assets";
import { ZEROTAL_VERSION, BUILD_SHA, BUILD_SHA_SHORT, BOOTED_AT } from "../app/version.ts";
import { searchDocs } from "../app/support/search.ts";
import { Layout, ApiLayout, isApiPath, navPages, SITE_URL } from "../app/routes/_layout.ts";
import {
  markdownPath,
  markdownResponse,
  markdownTarget,
  prefersMarkdown,
} from "../app/support/agent-docs.ts";
// Registers GET /blog and GET /blog/* on import.
import "./blog.ts";
// Registers the authoring UI at /admin on import.
import "./admin.ts";
// Registers robots.txt, sitemap.xml and the blog feed on import.
import "./seo.ts";
import {
  parseSlug,
  canonicalPath,
  parseFrontmatter,
  resolveDocument,
  renderNotFoundPage,
  createHtmlResponse,
  extractTitle,
} from "@app/support/helpers.ts";
import type { BunMarkdownOptions } from "zerotal/helpers";

const MARKDOWN_OPTIONS: BunMarkdownOptions = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
};

async function renderDoc(req: Request): Promise<Response> {
  // `/docs/orm.md` is the Markdown copy of `/docs/orm`, and so is `/docs/orm` asked
  // for as `text/markdown` — see `agent-docs.ts`. Resolved as the HTML path, so
  // both forms go through the same canonical rules.
  const requested = new URL(req.url).pathname;
  const target = markdownTarget(requested);
  const pathname = target ?? requested;
  const asMarkdown = target !== null || prefersMarkdown(req.headers.get("accept"));
  const suffix = target !== null ? ".md" : "";

  // Send the duplicates to the one URL before rendering anything. 301, because
  // this is settled: the sitemap has always named this form, and a permanent
  // redirect is what moves the accumulated ranking onto it.
  const canonical = canonicalPath(pathname);
  if (canonical) return Response.redirect(`${canonical}${suffix}`, 301);

  const slug = parseSlug(pathname);
  const resolved = await resolveDocument(slug);

  if (!resolved) {
    if (asMarkdown) {
      return new Response(`# Page not found\n\nNo documentation page at \`${pathname}\`.\n`, {
        status: 404,
        headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" },
      });
    }
    const notFoundHtml = renderNotFoundPage(slug, pathname);
    return createHtmlResponse(notFoundHtml, 404);
  }

  if (resolved.kind === "redirect") {
    return Response.redirect(`/docs/${resolved.slug}${suffix}`, 302);
  }

  const source = await Bun.file(resolved.filePath).text();
  // Split off optional YAML frontmatter so it never renders as a literal `---`
  // block; its `title`/`description` drive the page metadata when present.
  const { data, content } = parseFrontmatter(source);

  if (asMarkdown) return markdownResponse(content.trimStart(), `${SITE_URL}${pathname}`);
  const body = Bun.markdown.html(content, MARKDOWN_OPTIONS);
  const title = data.title ?? extractTitle(content, slug);

  const isApi = isApiPath(pathname);

  // TypeDoc names its root page "Documentation" — as a `<title>`, an `<h1>`, and
  // the only thing a search result would show for the entire API reference. The
  // tree is generated and gitignored, so the fix belongs here rather than in a
  // file that is rewritten on every build.
  const isApiRoot = pathname === "/docs/api/README" || pathname === "/docs/api";
  const apiMeta = isApiRoot
    ? {
        title: "Zerotal API Reference",
        description:
          "Every exported symbol in the framework: signatures, parameters and types, generated from the source of each package.",
        // The clean URL, not the `/README` the relative links need.
        canonical: "/docs/api",
      }
    : {};

  const render = isApi ? ApiLayout : Layout;
  const pageHtml = render({
    content: body,
    title,
    pathname,
    markdown: markdownPath(pathname),
    ...(data.description ? { description: data.description } : {}),
    ...apiMeta,
  });

  const response = createHtmlResponse(pageHtml);
  // The same URL answers in Markdown to an `Accept: text/markdown`, so a cache
  // must not hand one reader's format to the other.
  response.headers.set("Vary", "Accept");
  return response;
}

// Both forms, because `/docs/*` does not match the bare `/docs` — and trimming
// the URL back to the section root is exactly what a reader does when they want
// the table of contents.
Router.raw("GET", "/docs", renderDoc);
Router.raw("GET", "/docs/*", renderDoc);
// The overview's Markdown copy, which neither pattern above reaches.
Router.raw("GET", "/docs.md", renderDoc);

// Full-text search for the sidebar box, which until now filtered navigation
// labels and so could only find a page whose title you already knew.
//
/**
 * `/showcase` is a prefix, not a page — send it to the demo it prefixes.
 *
 * File-based routing mounts `app/showcase/**` under `/showcase`, so the pages
 * live at `/showcase/flow/…` and the bare prefix matched nothing. It is the URL
 * anyone types first, and it 404'd.
 */
Router.raw("GET", "/showcase", () => Response.redirect("/showcase/flow", 301));

/**
 * What this process is actually serving.
 *
 * A deploy command that exits zero proves the command ran, not that the site
 * changed — three batches of documentation fixes sat unshipped behind a checkout
 * that had not moved, and every check looked reasonable because no page said
 * which commit it was. `curl -s https://zerotal.dev/__version` now answers that
 * in one line, before anyone starts diffing rendered HTML against a branch.
 *
 * `no-store`, because a cached answer to "what is running" is worse than none.
 */
Router.raw("GET", "/__version", () =>
  Response.json(
    {
      version: ZEROTAL_VERSION,
      commit: BUILD_SHA,
      commitShort: BUILD_SHA_SHORT,
      bootedAt: BOOTED_AT,
      assetVersion: assetVersion(),
    },
    { headers: { "Cache-Control": "no-store" } },
  ),
);

// Declared before `/docs/*` would be reached for it — `/api/docs-search` sits
// outside the docs namespace on purpose, so a page can never be shadowed by it.
Router.raw("GET", "/api/docs-search", async (request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const q = query.trim().toLowerCase();

  // Two questions in one response. Page names answer "where is the Inertia
  // section" and match on a prefix; the body index answers "how do I defer a
  // prop" and needs whole words. Neither covers the other, so the dropdown shows
  // both and the client makes one request instead of two.
  const pages =
    q.length > 0
      ? navPages()
          .filter((p) => p.label.toLowerCase().includes(q) || p.group.toLowerCase().includes(q))
          .slice(0, 6)
      : [];

  // A page whose *name* matched will already be the first row on the card, so
  // ranking its body underneath it spends a second row saying the same thing —
  // "Icons" above "Icons", one under each heading. The body index still earns its
  // place for every other page; it just does not repeat what is already there.
  //
  // The two halves name pages differently — the nav carries `flow/icons`, the
  // index returns `/docs/flow/icons` — so they have to be reduced to one form
  // before they can be compared. Matching them raw silently deduplicated nothing.
  const key = (slug: string) => slug.replace(/^\/?docs\//, "").replace(/^\//, "");
  const named = new Set(pages.map((p) => key(p.slug)));
  const results = (await searchDocs(query)).filter((r) => !named.has(key(r.slug)));

  return Response.json(
    { query, pages, results },
    {
      // Same query, same corpus, same answer for the life of a deploy — but a
      // deploy replaces the corpus, so it is `no-cache` rather than immutable.
      headers: { "Cache-Control": "no-cache" },
    },
  );
});
