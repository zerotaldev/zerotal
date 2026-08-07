import { Router } from "zerotal";
import { Layout, ApiLayout, isApiPath } from "../app/routes/_layout.ts";
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
