import { Router, env } from "zerotal";
import { listPosts, loadPost } from "@app/support/blog.ts";
import { listDocSlugs, docPath } from "@app/support/helpers.ts";

/**
 * The site's public origin. Absolute URLs are not optional here: a sitemap entry
 * and a feed item are read away from the page that served them, so a relative
 * path has nothing to resolve against.
 */
const SITE = env("APP_URL", "https://zerotal.dev").replace(/\/$/, "");

/** XML text content — the five predefined entities, since these documents have no HTML parser to be lenient. */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlResponse(body: string, maxAge = 3600): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

// ── robots.txt ────────────────────────────────────────────────────────────────

Router.raw("GET", "/robots.txt", () => {
  // `/admin` is disallowed as a courtesy to crawlers, not as protection — it is
  // behind auth, and robots.txt is a public file that hides nothing.
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// ── sitemap.xml ───────────────────────────────────────────────────────────────

Router.raw("GET", "/sitemap.xml", async () => {
  const posts = await listPosts();
  const docs = await listDocSlugs();

  const url = (loc: string, lastmod?: string) =>
    `  <url>\n    <loc>${escXml(loc)}</loc>${lastmod ? `\n    <lastmod>${escXml(lastmod)}</lastmod>` : ""}\n  </url>`;

  const entries = [
    url(`${SITE}/`),
    url(`${SITE}/blog`),
    // The listing's `?category=`/`?sort=`/`?view=` views are deliberately absent:
    // they are the same posts rearranged, and every one of them canonicalises to
    // `/blog`. Listing them would be asking to be indexed as duplicates.
    ...docs.map((slug) => url(`${SITE}${docPath(slug)}`)),
    ...posts.map((post) => url(`${SITE}/blog/${post.slug}`, post.date)),
  ];

  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
  );
});

// ── RSS ───────────────────────────────────────────────────────────────────────

Router.raw("GET", "/blog/feed.xml", async () => {
  const posts = await listPosts();

  const items = await Promise.all(
    posts.slice(0, 20).map(async (post) => {
      const link = `${SITE}/blog/${post.slug}`;
      // The full Markdown body is deliberately not shipped: readers would get
      // raw syntax, and rendering it here would duplicate the article. The
      // description is the summary the author already wrote for the index.
      const loaded = post.description ? null : await loadPost(post.slug);
      const summary = post.description ?? loaded?.content.slice(0, 300) ?? "";
      const date = post.date ? new Date(`${post.date}T00:00:00Z`).toUTCString() : undefined;

      return [
        "    <item>",
        `      <title>${escXml(post.title)}</title>`,
        `      <link>${escXml(link)}</link>`,
        // Stable identity across edits: a slug does not change, so a reader's
        // feed does not resurface a post because its title was fixed.
        `      <guid isPermaLink="true">${escXml(link)}</guid>`,
        summary ? `      <description>${escXml(summary)}</description>` : "",
        post.category ? `      <category>${escXml(post.category)}</category>` : "",
        date ? `      <pubDate>${escXml(date)}</pubDate>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );

  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Zerotal Blog</title>
    <link>${escXml(`${SITE}/blog`)}</link>
    <description>Releases, architecture notes, and the reasoning behind the decisions.</description>
    <language>en</language>
    <atom:link href="${escXml(`${SITE}/blog/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>
`,
  );
});
