/**
 * Splitting a Markdown document into editable blocks, and putting it back.
 *
 * The block editor's whole premise is that a block is *still Markdown* — it is
 * never serialized back from rendered HTML, so a fenced code block, a table or a
 * footnote survives an edit untouched. That only holds if the split respects
 * fences: a blank line inside ``` is part of the code, not a block boundary.
 */

/** ```, ~~~, and any longer run — the opener and closer must use the same char. */
const FENCE = /^(\s*)(`{3,}|~{3,})/;

/**
 * Split `markdown` into blocks on blank lines, treating a fenced code block as
 * one indivisible unit however many blank lines it contains.
 *
 * @returns Non-empty blocks, in document order. An empty document yields `[]`.
 */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  /** The fence marker we are inside, or null at the top level. */
  let fence: string | null = null;

  const flush = (): void => {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    const match = FENCE.exec(line);

    if (fence === null && match) {
      // A fence opening mid-paragraph still starts its own block.
      if (current.length > 0 && current.join("").trim() === "") flush();
      fence = match[2]!;
      current.push(line);
      continue;
    }

    if (fence !== null) {
      current.push(line);
      // A closer is the same character, at least as long as the opener.
      if (match && match[2]![0] === fence[0] && match[2]!.length >= fence.length) {
        fence = null;
        flush();
      }
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    current.push(line);
  }

  // An unterminated fence is kept rather than dropped — the author is mid-edit,
  // and losing the text would be worse than an unbalanced block.
  flush();
  return blocks;
}

/**
 * Rejoin blocks into a document, one blank line between each.
 *
 * Not a byte-exact inverse of {@link splitBlocks}: runs of three or more blank
 * lines collapse to one, and trailing whitespace is dropped. Both are
 * semantically inert in Markdown, and normalising here means a post does not
 * accumulate whitespace drift every time it is opened.
 */
export function joinBlocks(blocks: string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * How a block is edited.
 *
 * `prose` — a paragraph, heading, list or quote. Edited as rich text: it looks
 * on screen the way it will publish, and the toolbar writes the Markdown, so
 * nobody has to know what `##` means.
 *
 * `raw` — a fenced code block, a table, or embedded HTML. Edited as plain text,
 * because these are exactly what a rich editor damages: round-tripping them
 * through a contenteditable and back is how a code fence turns into soup. They
 * are also the blocks a non-technical author is least likely to touch.
 */
export type BlockKind = "prose" | "raw";

export function blockKind(markdown: string): BlockKind {
  const text = markdown.trimStart();
  if (/^(`{3,}|~{3,})/.test(text)) return "raw"; // fenced code
  if (/^\|/m.test(text)) return "raw"; // table
  if (/^ {4,}\S/.test(text)) return "raw"; // indented code
  if (/^<[a-zA-Z]/.test(text)) return "raw"; // embedded HTML
  return "prose";
}

/**
 * A short label for a block, for a collapsed or empty view — the heading text,
 * the fence language, or the first few words.
 */
export function blockLabel(markdown: string): string {
  const firstLine = markdown.split("\n", 1)[0] ?? "";
  const heading = /^#{1,6}\s+(.*)$/.exec(firstLine);
  if (heading) return heading[1]!.trim();

  const fence = /^\s*(?:`{3,}|~{3,})\s*(\w+)?/.exec(firstLine);
  if (fence) return fence[1] ? `${fence[1]} code` : "code";

  const words = markdown.replace(/\s+/g, " ").trim();
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}
