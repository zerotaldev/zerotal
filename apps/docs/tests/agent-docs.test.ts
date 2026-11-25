/**
 * The docs as text: the Markdown copy of each page, `/llms.txt` and `/llms-full.txt`.
 *
 * Exercised without a booted app, against the real corpus, the way the canonical
 * URL tests are — the rules are pure, and the corpus is the thing most likely to
 * break them (a page with no frontmatter, a section index, the overview).
 */
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  FULL_TEXT_EXCLUDED,
  buildLlmsFullTxt,
  buildLlmsTxt,
  collectTextPages,
  markdownPath,
  markdownTarget,
  prefersMarkdown,
} from "@app/support/agent-docs.ts";
import { navPages } from "@app/routes/_layout.ts";

const CORPUS = join(import.meta.dir, "../../../docs");
const SITE = "https://zerotal.dev";

describe("markdownTarget", () => {
  it("maps a .md URL to the page it copies", () => {
    expect(markdownTarget("/docs/orm.md")).toBe("/docs/orm");
    expect(markdownTarget("/docs/orm/casts.md")).toBe("/docs/orm/casts");
  });

  it("maps /docs.md to the overview, the one page with no slug", () => {
    expect(markdownTarget("/docs.md")).toBe("/docs");
  });

  it("ignores everything else", () => {
    expect(markdownTarget("/docs/orm")).toBeNull();
    expect(markdownTarget("/blog/post.md")).toBeNull();
    expect(markdownTarget("/readme.md")).toBeNull();
  });

  it("round-trips with markdownPath", () => {
    for (const path of ["/docs", "/docs/orm", "/docs/testing/http"]) {
      expect(markdownTarget(markdownPath(path))).toBe(path);
    }
  });
});

describe("prefersMarkdown", () => {
  it("keeps serving HTML to a browser", () => {
    expect(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(
      false,
    );
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });

  it("serves Markdown when it is asked for first or alone", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.8")).toBe(true);
    expect(prefersMarkdown("text/markdown, */*")).toBe(true);
  });

  it("serves HTML when HTML outranks it", () => {
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0, text/plain")).toBe(false);
  });
});

describe("the corpus as text", async () => {
  const pages = await collectTextPages(CORPUS, navPages());

  it("covers every hand-written page and none of the API tree", () => {
    expect(pages.length).toBeGreaterThan(100);
    expect(pages.some((page) => page.slug.startsWith("api/"))).toBe(false);
    expect(pages.map((page) => page.path)).toContain("/docs");
    expect(pages.map((page) => page.path)).toContain("/docs/testing");
  });

  it("strips frontmatter from every copy", () => {
    const withFrontmatter = pages.filter((page) => page.markdown.startsWith("---"));
    expect(withFrontmatter.map((page) => page.slug)).toEqual([]);
  });

  it("keeps the sidebar's reading order", () => {
    const order = pages.map((page) => page.slug);
    expect(order.indexOf("getting-started")).toBeLessThan(order.indexOf("routing"));
    expect(order.indexOf("routing")).toBeLessThan(order.indexOf("orm"));
  });

  it("indexes every page by section, linking each to its Markdown copy", () => {
    const text = buildLlmsTxt(pages, SITE);
    expect(text.startsWith("# Zerotal\n\n> ")).toBe(true);
    expect(text).toContain(`(${SITE}/docs/getting-started.md)`);
    expect(text).toContain(`(${SITE}/docs.md)`);
    for (const page of pages) expect(text).toContain(`(${SITE}${markdownPath(page.path)})`);
    // The release notes are there to follow, but marked as skippable.
    expect(text.indexOf("## Optional")).toBeLessThan(text.indexOf("/docs/changelog.md"));
  });

  it("puts the whole guide in one file, without the release notes", () => {
    const full = buildLlmsFullTxt(
      pages.filter((page) => !FULL_TEXT_EXCLUDED.has(page.slug)),
      SITE,
    );
    expect(full).toContain(`Source: ${SITE}/docs/orm\n`);
    expect(full).not.toContain(`Source: ${SITE}/docs/changelog\n`);
  });
});
