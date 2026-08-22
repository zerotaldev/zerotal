/**
 * Full-text search over the documentation, for the sidebar box.
 *
 * The box has always filtered the **navigation labels** — `item.dataset.label
 * .includes(q)` — so typing "requ" offered "Request Lifecycle" and "Requests
 * Context" and nothing else. Every page that explains requests without carrying
 * the word in its title was invisible, which is most of them. A reader searching
 * documentation is looking for where something is explained, not for a page whose
 * name they already know.
 *
 * ## This is `search_docs`, not a second search
 *
 * `@zerotal/arch` already ranks this exact corpus for the MCP tool an agent calls:
 * BM25 over an inverted index, with title, description and heading matches scored
 * as separate fields on top of the body. Its docblock records what that tuning
 * cost to get right — plain term-frequency ranked the 53-component reference first
 * for "send an email", and length normalisation, IDF and term saturation are each
 * load-bearing.
 *
 * Reimplementing it here would mean two rankings to keep honest and one of them
 * getting worse. Instead the site runs the tool: `archTools()` builds it against
 * whatever `docsDir` it is handed, so pointing it at the live `docs/` gives the
 * site and the agent the same answers from the same engine.
 *
 * The index is built on first read and held by the tool instance, so it is one
 * cost per process rather than per keystroke.
 */
import { archTools } from "@zerotal/arch";
import type { ArchTool } from "@zerotal/arch/mcp";
import { DOCS_DIR } from "./helpers.ts";

/** One hit, as the sidebar renders it. */
export interface DocHit {
  /** URL path on this site, e.g. `flow/icons`. */
  slug: string;
  title: string;
  /** The section the excerpt came from, for a sub-heading line. */
  heading: string;
  excerpt: string;
}

interface SearchPayload {
  results?: {
    slug?: unknown;
    title?: unknown;
    heading?: unknown;
    excerpt?: unknown;
  }[];
}

let tool: ArchTool | undefined;

/** The `search_docs` tool, pointed at this repository's live docs. */
function searchTool(): ArchTool {
  if (tool) return tool;

  const found = archTools({
    root: DOCS_DIR,
    docsDir: DOCS_DIR,
    // Never called: `search_docs` reads the corpus off disk and never boots the
    // app. Throwing is better than a stub that would let a future tool reach for
    // a subprocess from inside a web request without anyone noticing.
    probe: {
      run: () => {
        throw new Error("the docs site does not run probes");
      },
    },
  }).find((t) => t.name === "search_docs");

  if (!found) throw new Error("search_docs is missing from archTools()");
  tool = found;
  return tool;
}

/**
 * Rank the corpus for `query`.
 *
 * Returns `[]` for a query too short to rank rather than a page of noise — one or
 * two characters match nearly every page, and a list of everything is the same as
 * no list at all.
 */
export async function searchDocs(query: string, limit = 8): Promise<DocHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // Over-fetch, because the generated reference is filtered out below and would
  // otherwise eat most of a small limit.
  const outcome = await searchTool().run(
    { query: q, limit: limit * 3 },
    AbortSignal.timeout(5_000),
  );
  if (outcome.failed) return [];

  const payload = (outcome.data ?? {}) as SearchPayload;

  const hits = (payload.results ?? []).flatMap((r) => {
    if (typeof r.slug !== "string" || typeof r.title !== "string") return [];

    // Drop the generated API reference. `docs/api/**` is 3,000-odd typedoc pages
    // built from the same docblocks, and searching them here does exactly what
    // `scripts/arch-docs.ts` excludes them from the agent corpus to avoid: they
    // bury the hand-written page under stubs. Measured on this corpus, "soft
    // deletes" returned one guide page and three `Model` method pages. The site
    // has a dedicated API browser with its own symbol filter; this box is for prose.
    if (r.slug.startsWith("/docs/api/") || r.slug.startsWith("api/")) return [];
    return [
      {
        slug: r.slug,
        title: r.title,
        heading: typeof r.heading === "string" ? r.heading : "",
        excerpt: typeof r.excerpt === "string" ? r.excerpt : "",
      },
    ];
  });

  return hits.slice(0, limit);
}
