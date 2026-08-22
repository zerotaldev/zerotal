import { Router } from "zerotal";
import { searchDocs } from "../app/support/search.ts";
import { Layout, ApiLayout, isApiPath, navPages } from "../app/routes/_layout.ts";
// Registers GET /blog and GET /blog/* on import.
import "./blog.ts";
// Registers the authoring UI at /admin on import.
import "./admin.ts";
// Registers robots.txt, sitemap.xml and the blog feed on import.
import "./seo.ts";
import {
  parseSlug,
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
  const { pathname } = new URL(req.url);
  const slug = parseSlug(pathname);
  const resolved = await resolveDocument(slug);

  if (!resolved) {
    const notFoundHtml = renderNotFoundPage(slug, pathname);
    return createHtmlResponse(notFoundHtml, 404);
  }

  if (resolved.kind === "redirect") {
    return Response.redirect(`/docs/${resolved.slug}`, 302);
  }

  const source = await Bun.file(resolved.filePath).text();
  // Split off optional YAML frontmatter so it never renders as a literal `---`
  // block; its `title`/`description` drive the page metadata when present.
  const { data, content } = parseFrontmatter(source);
  const body = Bun.markdown.html(content, MARKDOWN_OPTIONS);
  const title = data.title ?? extractTitle(content, slug);

  const render = isApiPath(pathname) ? ApiLayout : Layout;
  const pageHtml = render({
    content: body,
    title,
    pathname,
    ...(data.description ? { description: data.description } : {}),
  });

  return createHtmlResponse(pageHtml);
}

// Both forms, because `/docs/*` does not match the bare `/docs` — and trimming
// the URL back to the section root is exactly what a reader does when they want
// the table of contents.
Router.raw("GET", "/docs", renderDoc);
Router.raw("GET", "/docs/*", renderDoc);

// Full-text search for the sidebar box, which until now filtered navigation
// labels and so could only find a page whose title you already knew.
//
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

  const results = await searchDocs(query);

  return Response.json(
    { query, pages, results },
    {
      // Same query, same corpus, same answer for the life of a deploy — but a
      // deploy replaces the corpus, so it is `no-cache` rather than immutable.
      headers: { "Cache-Control": "no-cache" },
    },
  );
});
