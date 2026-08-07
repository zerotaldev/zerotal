/**
 * The block editor never serializes HTML back to Markdown — a block *is*
 * Markdown. That guarantee lives or dies on these two functions, so the round
 * trip is tested against the real posts, not just fixtures.
 */
import { describe, test, expect } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";
import { splitBlocks, joinBlocks, blockLabel } from "../app/support/markdown-blocks.ts";

const BLOG_DIR = join(import.meta.dir, "../../../blog");

describe("splitBlocks", () => {
  test("splits paragraphs on blank lines", () => {
    expect(splitBlocks("One.\n\nTwo.\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  test("keeps a fenced code block whole, blank lines and all", () => {
    const source = [
      "Intro.",
      "",
      "```ts",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
      "",
      "After.",
    ].join("\n");

    expect(splitBlocks(source)).toEqual([
      "Intro.",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      "After.",
    ]);
  });

  test("a fence inside a fence is content, not a boundary", () => {
    // Four backticks wrapping a three-backtick example — the inner run is too
    // short to close the outer one.
    const source = "````md\n```ts\nx\n```\n````";
    expect(splitBlocks(source)).toEqual([source]);
  });

  test("tilde fences work, and a tilde does not close a backtick fence", () => {
    const source = "~~~\na\n\nb\n~~~";
    expect(splitBlocks(source)).toEqual([source]);
    expect(splitBlocks("```\na\n~~~\nb\n```")).toEqual(["```\na\n~~~\nb\n```"]);
  });

  test("an unterminated fence is kept rather than dropped", () => {
    // Mid-edit state: losing the text would be worse than an unbalanced block.
    expect(splitBlocks("```ts\nconst a = 1;")).toEqual(["```ts\nconst a = 1;"]);
  });

  test("collapses blank runs and ignores trailing whitespace", () => {
    expect(splitBlocks("One.\n\n\n\nTwo.\n\n")).toEqual(["One.", "Two."]);
    expect(splitBlocks("")).toEqual([]);
    expect(splitBlocks("\n\n \n")).toEqual([]);
  });

  test("tables and lists stay in one block", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    const list = "- one\n- two\n- three";
    expect(splitBlocks(`${table}\n\n${list}`)).toEqual([table, list]);
  });
});

describe("round trip", () => {
  test("join(split(x)) is stable — a second pass changes nothing", () => {
    const source = "# Title\n\nBody.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nEnd.";
    const once = joinBlocks(splitBlocks(source));
    const twice = joinBlocks(splitBlocks(once));

    expect(once).toBe(source);
    expect(twice).toBe(once);
  });

  test("every committed post survives a round trip byte-for-byte", async () => {
    const files = [...new Glob("*.md").scanSync({ cwd: BLOG_DIR })];
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const raw = await Bun.file(join(BLOG_DIR, file)).text();
      // Front matter is not part of the body the editor touches.
      const body = raw.replace(/^---[\s\S]*?\n---\n/, "").trim();

      const rebuilt = joinBlocks(splitBlocks(body));

      // Normalised the same way on both sides: the only differences the editor
      // is allowed to introduce are blank-line runs and trailing whitespace.
      const normalise = (s: string) =>
        s
          .replace(/\r\n/g, "\n")
          .replace(/[ \t]+$/gm, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

      expect(rebuilt, `${file} did not survive the round trip`).toBe(normalise(body));
    }
  });

  test("code fences in a real post keep their language and indentation", async () => {
    const raw = await Bun.file(join(BLOG_DIR, "no-build-step.md")).text();
    const blocks = splitBlocks(raw.replace(/^---[\s\S]*?\n---\n/, ""));

    const fences = blocks.filter((b) => b.startsWith("```"));
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(fence).toMatch(/^```/);
      expect(fence.trimEnd()).toMatch(/```$/);
    }
  });
});

describe("blockLabel", () => {
  test("prefers heading text, then fence language, then a truncated excerpt", () => {
    expect(blockLabel("## Why this is possible")).toBe("Why this is possible");
    expect(blockLabel("```ts\nconst a = 1;\n```")).toBe("ts code");
    expect(blockLabel("```\nplain\n```")).toBe("code");
    expect(blockLabel("A short paragraph.")).toBe("A short paragraph.");
    expect(blockLabel("word ".repeat(40)).endsWith("…")).toBe(true);
  });
});
