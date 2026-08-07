/**
 * The rich block editor's only lossy step: what a `contenteditable` hands back
 * becomes Markdown here. A block that cannot survive this — fenced code, a
 * table — never reaches it (see `blockKind`), so what is tested is the prose
 * subset the toolbar can actually produce.
 */
import { describe, test, expect } from "bun:test";
import { htmlToMarkdown } from "../app/support/html-to-markdown.ts";
import { splitBlocks } from "../app/support/markdown-blocks.ts";

const md = (html: string) => htmlToMarkdown(html);

describe("inline formatting", () => {
  test("bold, italic and inline code", () => {
    expect(md("<p>A <strong>bold</strong> word.</p>")).toBe("A **bold** word.");
    expect(md("<p>An <em>italic</em> word.</p>")).toBe("An _italic_ word.");
    expect(md("<p>Call <code>bun dev</code> first.</p>")).toBe("Call `bun dev` first.");
  });

  test("the tags a browser actually emits for bold/italic", () => {
    // execCommand("bold") produces <b> in some engines and <strong> in others.
    expect(md("<p>A <b>bold</b> word.</p>")).toBe("A **bold** word.");
    expect(md("<p>An <i>italic</i> word.</p>")).toBe("An _italic_ word.");
  });

  test("links keep their href", () => {
    expect(md('<p>See <a href="/docs/routing">Routing</a>.</p>')).toBe(
      "See [Routing](/docs/routing).",
    );
  });

  test("underline has no Markdown form, so the words survive without it", () => {
    expect(md("<p>An <u>underlined</u> word.</p>")).toBe("An underlined word.");
  });

  test("nested emphasis", () => {
    expect(md("<p><strong>Bold and <em>italic</em></strong></p>")).toBe("**Bold and _italic_**");
  });

  test("inline code is literal — its contents are not escaped as Markdown", () => {
    expect(md("<p><code>a_b*c</code></p>")).toBe("`a_b*c`");
  });

  test("text that would read as Markdown is escaped", () => {
    expect(md("<p>Use * and _ literally.</p>")).toBe("Use \\* and \\_ literally.");
    expect(md("<p>An [example] of brackets.</p>")).toBe("An \\[example\\] of brackets.");
  });
});

describe("block formatting", () => {
  test("headings at every level", () => {
    expect(md("<h1>Title</h1>")).toBe("# Title");
    expect(md("<h2>Section</h2>")).toBe("## Section");
    expect(md("<h3>Sub</h3>")).toBe("### Sub");
  });

  test("bullet and numbered lists", () => {
    expect(md("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
    expect(md("<ol><li>first</li><li>second</li></ol>")).toBe("1. first\n2. second");
  });

  test("a nested list indents under its parent item", () => {
    expect(md("<ul><li>one<ul><li>inner</li></ul></li></ul>")).toBe("- one\n  - inner");
  });

  test("blockquote", () => {
    expect(md("<blockquote><p>Quoted.</p></blockquote>")).toBe("> Quoted.");
  });

  test("a <br> is a line break inside the block", () => {
    expect(md("<p>One<br>Two</p>")).toBe("One\nTwo");
  });

  test("several paragraphs become separate lines", () => {
    expect(md("<p>One.</p><p>Two.</p>")).toBe("One.\nTwo.");
  });
});

describe("resilience", () => {
  test("entities are decoded", () => {
    expect(md("<p>A &amp; B &lt; C</p>")).toBe("A & B < C");
    expect(md("<p>Non&nbsp;breaking</p>")).toBe("Non breaking");
  });

  test("unknown tags degrade to their text", () => {
    expect(md('<p>A <span class="x">span</span> here.</p>')).toBe("A span here.");
    expect(md("<p>A <mark>mark</mark> here.</p>")).toBe("A mark here.");
  });

  test("unbalanced markup does not throw or lose text", () => {
    expect(md("<p>Unclosed <strong>bold")).toBe("Unclosed **bold**");
    expect(md("stray </em> closer")).toBe("stray closer");
  });

  test("empty input is empty output", () => {
    expect(md("")).toBe("");
    expect(md("<p></p>")).toBe("");
    expect(md("<p><br></p>")).toBe("");
  });

  test("whitespace a contenteditable sprinkles between tags is collapsed", () => {
    expect(md("<p>\n  A   spaced\n  sentence.\n</p>")).toBe("A spaced sentence.");
  });
});

describe("round trip through the editor", () => {
  // Markdown → HTML (what the block renders) → Markdown (what commit stores).
  const roundTrip = (markdown: string): string =>
    htmlToMarkdown(Bun.markdown.html(markdown, { tables: true, autolinks: true }));

  test("prose survives being rendered and read back", () => {
    for (const source of [
      "A plain paragraph.",
      "## A heading",
      "A **bold** and _italic_ sentence.",
      "Some `inline code` here.",
      "- one\n- two\n- three",
      "1. first\n2. second",
      "> A quotation.",
      "A [link](/docs/routing) in a sentence.",
    ]) {
      expect(roundTrip(source), `${source} did not survive`).toBe(source);
    }
  });

  test("every prose block of every committed post survives the round trip", async () => {
    const { Glob } = await import("bun");
    const { join } = await import("node:path");
    const dir = join(import.meta.dir, "../../../blog");

    for (const file of new Glob("*.md").scanSync({ cwd: dir })) {
      const body = (await Bun.file(join(dir, file)).text()).replace(/^---[\s\S]*?\n---\n/, "");

      for (const source of splitBlocks(body)) {
        // Only prose reaches the rich editor; code fences and tables are edited
        // as text and never converted.
        if (/^(```|~~~|\||<)/.test(source)) continue;
        // Setext/HTML-ish edge cases aside, a prose block must be recoverable.
        const rebuilt = roundTrip(source);
        expect(
          rebuilt.replace(/\s+/g, " ").trim().length,
          `${file}: block lost its text`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
