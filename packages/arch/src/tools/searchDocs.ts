/**
 * `search_docs` — the framework's own documentation, version-matched.
 *
 * The corpus ships inside this package, so the pages an app searches are the
 * ones released with the `@zerotal/arch` it installed. That is the whole design:
 * no embeddings, no hosted API, no index to keep in sync with a release, and no
 * possibility of answering from documentation for a version the app is not
 * running. A semantic search over a hosted corpus buys ranking; being unable to
 * be wrong about the version buys more.
 *
 * Ranking is deliberately plain — term frequency weighted by where the term
 * appears. The corpus is 125 curated pages, not a web index, and a page's title
 * is a very good predictor of what it is about.
 */
import { basename } from "node:path";
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { ToolContext } from "./context.ts";

/** Terms shorter than this are dropped: they match everywhere and rank nothing. */
const MIN_TERM_LENGTH = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
/** How much of a matching section to return, in characters. */
const EXCERPT_BUDGET = 1200;

const WEIGHT = { title: 12, description: 6, heading: 3, body: 1 } as const;

interface DocSection {
  heading: string;
  text: string;
}

interface DocPage {
  /** Path relative to the corpus root, e.g. `orm/casts.md`. */
  path: string;
  /** The docs-site slug, e.g. `/docs/orm/casts`. */
  slug: string;
  title: string;
  description: string;
  sections: DocSection[];
}

export interface DocHit {
  path: string;
  slug: string;
  title: string;
  description: string;
  heading: string;
  excerpt: string;
  score: number;
}

// ── Corpus ────────────────────────────────────────────────────────────────────

/**
 * Read the corpus once per process.
 *
 * Safe to cache in a way the probe's answers are not: these files live inside
 * an installed package and cannot change while the server runs. Rebuilding the
 * index per call would re-read a couple of megabytes for no possible difference
 * in the result.
 */
const indexes = new Map<string, Promise<DocPage[]>>();

function corpus(dir: string): Promise<DocPage[]> {
  let index = indexes.get(dir);
  if (!index) {
    index = readCorpus(dir);
    indexes.set(dir, index);
  }
  return index;
}

async function readCorpus(dir: string): Promise<DocPage[]> {
  const pages: DocPage[] = [];
  let files: string[];
  try {
    files = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: dir, onlyFiles: true }));
  } catch {
    return pages;
  }

  for (const file of files.sort()) {
    try {
      pages.push(parsePage(file.replace(/\\/g, "/"), await Bun.file(`${dir}/${file}`).text()));
    } catch {
      /* an unreadable page is one page missing from a search, not a failure */
    }
  }
  return pages;
}

/** Split a page into its frontmatter and its `##`-delimited sections. */
export function parsePage(path: string, raw: string): DocPage {
  const { frontmatter, body } = splitFrontmatter(raw);

  const sections: DocSection[] = [];
  let heading = "";
  let buffer: string[] = [];
  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (text.length > 0 || heading.length > 0) sections.push({ heading, text });
    buffer = [];
  };

  for (const line of body.split("\n")) {
    const match = /^(#{1,3})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return {
    path,
    slug: `/docs/${path.replace(/\.md$/, "").replace(/\/index$/, "")}`,
    title: frontmatter["title"] ?? basename(path, ".md"),
    description: frontmatter["description"] ?? "",
    sections,
  };
}

/**
 * Read the leading `---` block.
 *
 * Deliberately a two-key reader rather than a YAML parser: every page in this
 * corpus carries exactly `title` and `description`, and a dependency to read two
 * strings would be the only one this package has.
 */
function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: raw };

  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key.length > 0) frontmatter[key] = value;
  }

  return { frontmatter, body: raw.slice(end + 4) };
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export function terms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((term) => term.length >= MIN_TERM_LENGTH),
    ),
  ];
}

function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** Rank the corpus against a query, best first. */
export function search(pages: DocPage[], query: string, limit: number): DocHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const hits: DocHit[] = [];

  for (const page of pages) {
    const title = page.title.toLowerCase();
    const description = page.description.toLowerCase();

    let pageScore = 0;
    for (const term of wanted) {
      pageScore += occurrences(title, term) * WEIGHT.title;
      pageScore += occurrences(description, term) * WEIGHT.description;
    }

    // The best section decides which excerpt to return; every section still
    // contributes to the page's score, so a term spread across a long page
    // ranks it even when no single section is dense in it.
    let best: { section: DocSection; score: number } | undefined;
    let bodyScore = 0;

    for (const section of page.sections) {
      const heading = section.heading.toLowerCase();
      const text = section.text.toLowerCase();
      let score = 0;
      for (const term of wanted) {
        score += occurrences(heading, term) * WEIGHT.heading;
        score += occurrences(text, term) * WEIGHT.body;
      }
      bodyScore += score;
      if (score > 0 && (best === undefined || score > best.score)) best = { section, score };
    }

    const total = pageScore + bodyScore;
    if (total === 0) continue;

    const section = best?.section ?? page.sections[0];
    hits.push({
      path: page.path,
      slug: page.slug,
      title: page.title,
      description: page.description,
      heading: section?.heading ?? "",
      excerpt: excerpt(section?.text ?? page.description, wanted),
      score: total,
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/**
 * A window of the section around its first matching term.
 *
 * Returning the whole section would be the honest thing for a human reader and
 * the wrong thing here: a long page can be tens of kilobytes, and a search that
 * fills a context window with one result has answered nothing.
 */
function excerpt(text: string, wanted: string[]): string {
  if (text.length <= EXCERPT_BUDGET) return text.trim();

  const lower = text.toLowerCase();
  let at = -1;
  for (const term of wanted) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, EXCERPT_BUDGET).trim() + "\n…";

  const start = Math.max(0, at - Math.floor(EXCERPT_BUDGET / 3));
  const window = text.slice(start, start + EXCERPT_BUDGET).trim();
  return `${start > 0 ? "…" : ""}${window}${start + EXCERPT_BUDGET < text.length ? "\n…" : ""}`;
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export function searchDocsTool(ctx: ToolContext): ArchTool {
  return {
    name: "search_docs",
    title: "Search docs",
    description:
      "Search the Zerotal documentation that shipped with this project's installed version — " +
      "routing, models, migrations, validation, auth, queues, Flow components, Inertia, admin, " +
      "deployment and the rest. Returns the matching section of each page rather than the whole " +
      "page. Use it for how a subsystem works or which approach the framework intends; use " +
      "api_surface when you need an exact signature.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'What to look for, e.g. "soft deletes" or "route model binding".',
        },
        limit: {
          type: "number",
          description: `How many pages to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        total: { type: "number" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              slug: { type: "string", description: "The page's URL on the docs site." },
              title: { type: "string" },
              description: { type: "string" },
              heading: { type: "string", description: "The section this excerpt came from." },
              excerpt: { type: "string" },
              score: { type: "number" },
            },
            required: ["path", "slug", "title", "description", "heading", "excerpt", "score"],
          },
        },
      },
      required: ["query", "total", "results"],
    },

    async run(args): Promise<ToolOutcome> {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (query.trim().length === 0) return { text: "`query` is required.", failed: true };

      const pages = await corpus(ctx.docsDir);
      if (pages.length === 0) {
        return {
          text:
            `No documentation corpus at ${ctx.docsDir}. It ships inside @zerotal/arch; a ` +
            `missing one means the package was installed without its docs/ directory.`,
          failed: true,
        };
      }

      const limit = clampLimit(args["limit"]);
      const results = search(pages, query, limit);
      const data = { query, total: results.length, results };

      if (results.length === 0) {
        return {
          text: `Nothing in the ${pages.length}-page corpus matches "${query}".`,
          data,
        };
      }

      const rendered = results
        .map((hit) => {
          const where = hit.heading ? `${hit.title} → ${hit.heading}` : hit.title;
          return `## ${where}\n${hit.slug}  (${hit.path})\n\n${hit.excerpt}`;
        })
        .join("\n\n---\n\n");

      return { text: rendered, data };
    },
  };
}

function clampLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}
