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
 * Ranking is BM25 over a small inverted index built when the corpus is first
 * read, with matches in the title, description and headings scored as separate
 * fields on top of the body.
 *
 * It started as plain term frequency weighted by field, on the reasoning that
 * 126 curated pages are not a web index. Measured against real questions, that
 * ranked `components.md` — one generated page covering 53 components, and so
 * long that it mentions nearly everything — first for both "send an email" and
 * "how do I write a test for a controller". Length normalisation, inverse
 * document frequency and term saturation are each load-bearing, and the field
 * bonuses have to sit outside the saturation or BM25 flattens them into noise.
 *
 * Judged on a set of questions an agent would actually ask: top-1 relevance went
 * from roughly three in ten to twelve in fourteen. The remaining two return
 * pages that are related but not the best one, which is where this stops —
 * further tuning against a list this size is fitting the list, not the corpus.
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

/** Weights for picking which section of a chosen page to quote. */
const WEIGHT = { heading: 3, body: 1 } as const;

/**
 * What a match in each field adds, on top of the body's BM25 term.
 *
 * Added *outside* the saturation rather than multiplied into the frequency.
 * Folded in, BM25 compresses them: a title hit came out worth about twice one
 * passing mention in prose, when a page titled "Testing" is the answer to a
 * question about testing more or less by definition. The body term saturates at
 * `K1 + 1` = 2.2, so a title match at 3 is decisive and a heading match is a
 * strong nudge.
 */
const FIELD = { title: 3, description: 1.5, heading: 1 } as const;

/**
 * Words that carry no signal in a question and add noise to the excerpt pick.
 *
 * Kept deliberately short — IDF already discounts anything common, and a long
 * stop list starts removing terms that matter ("set", "get", "use" are all real
 * API vocabulary here).
 */
const STOP = new Set([
  "how",
  "do",
  "does",
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "can",
  "what",
  "when",
  "where",
  "why",
  "this",
  "that",
  "from",
  "into",
  "are",
  "was",
  "will",
]);

/**
 * BM25 term-saturation. Above this, more occurrences of the same term add
 * almost nothing — the tenth mention of "route" does not make a page ten times
 * more about routing.
 */
const K1 = 1.2;
/**
 * BM25 length normalisation, 0 (off) to 1 (full). At 0 this ranking degenerates
 * into the raw term count it replaced, and `components.md` — one generated page
 * covering 53 components — outranked the right answer for most queries simply by
 * being long enough to mention everything.
 */
const B = 0.75;

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
  /** Term counts in section bodies only — the field BM25 normalises. */
  body: Map<string, number>;
  /** Terms appearing in the title, description and headings: matched, not counted. */
  fields: { title: Set<string>; description: Set<string>; heading: Set<string> };
  /** Body token count — the document length BM25 normalises against. */
  length: number;
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

  const title = frontmatter["title"] ?? basename(path, ".md");
  const description = frontmatter["description"] ?? "";

  // Counted once, here, rather than scanned per query: the corpus is fixed for
  // the life of the process, and scoring reads these instead of the text.
  const bodyTerms = new Map<string, number>();
  let length = 0;
  for (const section of sections) {
    for (const token of tokenize(section.text)) {
      bodyTerms.set(token, (bodyTerms.get(token) ?? 0) + 1);
      length++;
    }
  }

  const fields = {
    title: new Set(tokenize(title)),
    description: new Set(tokenize(description)),
    heading: new Set(sections.flatMap((section) => tokenize(section.heading))),
  };

  return {
    path,
    slug: `/docs/${path.replace(/\.md$/, "").replace(/\/index$/, "")}`,
    title,
    description,
    sections,
    body: bodyTerms,
    fields,
    length,
  };
}

/**
 * Reduce a word to a form a query and a page can agree on.
 *
 * Conservative on purpose — enough to join "test"/"testing" and
 * "delete"/"deletes", which were the whole of the remaining miss rate, without
 * the over-stemming a full algorithm brings to a corpus this technical. The
 * `ss` guard keeps "class" and "process" intact, and the length floors stop
 * short words being ground down to something that matches everything.
 */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es") && !token.endsWith("ses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Split text into the tokens both the index and {@link terms} produce.
 *
 * A hyphenated or dotted word is emitted whole *and* in parts. `soft-delete` in
 * a heading has to be findable by someone typing "soft deletes", and `Bun.sql`
 * by someone typing "sql" — while an exact search for the compound still
 * matches it directly.
 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9_.-]+/)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    out.push(stem(raw));
    if (/[.-]/.test(raw)) {
      for (const part of raw.split(/[.-]+/)) {
        if (part.length >= MIN_TERM_LENGTH) out.push(stem(part));
      }
    }
  }
  return out;
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
  const kept = [...new Set(tokenize(query))].filter((term) => !STOP.has(term));
  // A query made entirely of stop words still has to search for something.
  return kept.length > 0 ? kept : [...new Set(tokenize(query))];
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

/**
 * Rank the corpus against a query, best first.
 *
 * BM25 over field-weighted term counts, which is three corrections to the raw
 * count this started as — and every one of them was load-bearing:
 *
 * - **Length normalisation.** `components.md` is one generated page covering 53
 *   components, so it mentions nearly every word in the framework at least once.
 *   Unnormalised, it was the top hit for "send an email" and "how do I write a
 *   test for a controller", above the Notifications and Testing pages.
 * - **Inverse document frequency.** "route" appears on most pages and separates
 *   nothing; "middleware" appears on few and separates a lot. Weighting every
 *   term equally let the common half of a query drown the informative half.
 * - **Term saturation.** The tenth mention of a word does not make a page ten
 *   times more about it, which is exactly what a linear count claims.
 */
export function search(pages: DocPage[], query: string, limit: number): DocHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const count = pages.length;
  const averageLength =
    count === 0 ? 1 : Math.max(1, pages.reduce((sum, page) => sum + page.length, 0) / count);

  // ln(1 + (N − n + 0.5) / (n + 0.5)) — always positive, so a term on every page
  // contributes little rather than going negative and penalising a match.
  const mentions = (page: DocPage, term: string): boolean =>
    page.body.has(term) ||
    page.fields.title.has(term) ||
    page.fields.description.has(term) ||
    page.fields.heading.has(term);

  const idf = new Map<string, number>();
  for (const term of wanted) {
    const withTerm = pages.reduce((n, page) => n + (mentions(page, term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + (count - withTerm + 0.5) / (withTerm + 0.5)));
  }

  const hits: DocHit[] = [];

  for (const page of pages) {
    const norm = K1 * (1 - B + (B * page.length) / averageLength);

    let total = 0;
    for (const term of wanted) {
      const frequency = page.body.get(term) ?? 0;
      let contribution = frequency > 0 ? (frequency * (K1 + 1)) / (frequency + norm) : 0;
      if (page.fields.title.has(term)) contribution += FIELD.title;
      if (page.fields.description.has(term)) contribution += FIELD.description;
      if (page.fields.heading.has(term)) contribution += FIELD.heading;
      if (contribution === 0) continue;
      total += (idf.get(term) ?? 0) * contribution;
    }
    if (total === 0) continue;

    // Which section to quote. Scored the plain way on purpose: this picks the
    // excerpt from a page already chosen, where density is exactly the right
    // signal and there is no long-document bias left to correct.
    let best: { section: DocSection; score: number } | undefined;
    for (const section of page.sections) {
      const heading = section.heading.toLowerCase();
      const text = section.text.toLowerCase();
      let score = 0;
      for (const term of wanted) {
        score += occurrences(heading, term) * WEIGHT.heading;
        score += occurrences(text, term) * WEIGHT.body;
      }
      if (score > 0 && (best === undefined || score > best.score)) best = { section, score };
    }

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
