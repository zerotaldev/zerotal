import { Layout } from "@app/routes/_layout";
import { basePath } from "zerotal";
import { Glob } from "bun";
import { join } from "node:path";

const DOCS_DIR = join(basePath("/"), "../../docs");

export function parseSlug(pathname: string): string {
  return pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "") || "index";
}

/** Parsed YAML frontmatter: the top-level scalar fields plus the body that follows. */
export interface ParsedDocument {
  /** Top-level `key: value` fields from the frontmatter block (empty when absent). */
  data: Record<string, string>;
  /** The Markdown body with the frontmatter block removed. */
  content: string;
}

/**
 * Split an optional leading `--- … ---` YAML frontmatter block off a Markdown
 * document. Returns the parsed top-level scalar fields and the remaining body.
 *
 * Intentionally minimal — it reads top-level `key: value` pairs (with optional
 * quotes) and ignores nested/indented lines, which is all the docs need
 * (`title`, `description`). When there is no frontmatter the source is returned
 * untouched, so pages without it keep working via their `# H1`.
 */
export function parseFrontmatter(source: string): ParsedDocument {
  // The block must be the very first thing in the file (allow a leading BOM).
  const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)*/);
  if (!match) return { data: {}, content: source };

  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    // Only un-indented `key: value` scalars; nested lines (e.g. under `sidebar:`)
    // start with whitespace and are skipped.
    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") data[kv[1]!] = value;
  }

  return { data, content: source.slice(match[0].length) };
}

export function extractTitle(markdown: string, fallbackSlug: string): string {
  const match = markdown.match(/^#{1,2}\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallbackSlug.replace(/-/g, " ");
}

/** Either a Markdown file to render, or a redirect to a canonical slug. */
export type ResolvedDocument =
  { kind: "file"; filePath: string } | { kind: "redirect"; slug: string };

export async function resolveDocument(slug: string): Promise<ResolvedDocument | null> {
  // Direct hits: `<slug>.md` or a hand-authored `<slug>/index.md`. These render
  // at the requested URL as-is.
  for (const filePath of [join(DOCS_DIR, `${slug}.md`), join(DOCS_DIR, slug, "index.md")]) {
    if (await Bun.file(filePath).exists()) {
      return { kind: "file", filePath };
    }
  }

  // Directory index written as `README.md` (the TypeDoc-generated API tree).
  // Its links are relative to the directory, so we redirect the bare-directory
  // URL to `<slug>/README` — where the browser's base path matches the file's
  // location and those relative links resolve correctly.
  if (await Bun.file(join(DOCS_DIR, slug, "README.md")).exists()) {
    return { kind: "redirect", slug: `${slug}/README` };
  }

  return null;
}

/**
 * Every documentation slug, for the sitemap.
 *
 * `docs/api/` is skipped: it is TypeDoc output, regenerated on every build and
 * thousands of pages wide, which would bury the hand-written guide in a sitemap
 * and is not what anyone should land on from a search.
 */
export async function listDocSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  for await (const file of new Glob("**/*.md").scan({ cwd: DOCS_DIR })) {
    const path = file.replace(/\\/g, "/");
    if (path.startsWith("api/")) continue;
    slugs.push(path.replace(/\.md$/, "").replace(/\/index$/, ""));
  }
  return slugs.sort();
}

export function createHtmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function renderNotFoundPage(slug: string, pathname: string): string {
  return Layout({
    content: `<h1>Page not found</h1>
<p>No documentation page found for <code>${slug}</code>.</p>
<p><a href="/">← Back to index</a></p>`,
    title: "Not Found",
    pathname,
  });
}
