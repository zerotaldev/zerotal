/**
 * HTML → Markdown for the rich block editor.
 *
 * Deliberately narrow. The input is not arbitrary web HTML — it is what a
 * `contenteditable` produces for one prose block, from typing plus the editor's
 * own toolbar (bold, italic, inline code, link, heading level, list, quote).
 * Anything outside that set degrades to its text rather than being guessed at.
 *
 * Blocks that cannot survive this trip — fenced code, tables, raw HTML — never
 * reach it: `blockKind()` routes them to the plain-text editor instead. That
 * split is what keeps a WYSIWYG editor from quietly eating a code fence.
 */

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

type Node = { kind: "text"; text: string } | { kind: "el"; tag: Tag; children: Node[] };

const VOID = new Set(["br", "img", "hr", "input", "wbr"]);

/** Tags whose content is a block: each renders on its own line. */
const BLOCKS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#160": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

/** Characters that would otherwise be read back as Markdown syntax. */
function escapeMarkdown(s: string): string {
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse the constrained HTML into a tree.
 *
 * Unclosed tags are tolerated (a `contenteditable` can produce them mid-edit):
 * a closing tag that matches nothing open is dropped, and anything still open at
 * the end is closed implicitly.
 */
function parse(html: string): Node[] {
  const root: Node[] = [];
  const stack: Node[] = [];
  const push = (node: Node): void => {
    const parent = stack[stack.length - 1];
    if (parent && parent.kind === "el") parent.children.push(node);
    else root.push(node);
  };

  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<!--[\s\S]*?-->/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    if (match.index > last) {
      push({ kind: "text", text: decodeEntities(html.slice(last, match.index)) });
    }
    last = pattern.lastIndex;

    if (match[0].startsWith("<!--")) continue;
    const name = (match[1] ?? "").toLowerCase();
    const closing = match[0].startsWith("</");
    const selfClosing = match[0].endsWith("/>") || VOID.has(name);

    if (closing) {
      // Unwind to the matching open tag; ignore a stray closer entirely.
      const at = stack.findLastIndex((n) => n.kind === "el" && n.tag.name === name);
      if (at >= 0) stack.length = at;
      continue;
    }

    const node: Node = {
      kind: "el",
      tag: { name, attrs: parseAttrs(match[2] ?? "") },
      children: [],
    };
    push(node);
    if (!selfClosing) stack.push(node);
  }

  if (last < html.length) push({ kind: "text", text: decodeEntities(html.slice(last)) });
  return root;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]!.toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attrs;
}

// ── Serialising ───────────────────────────────────────────────────────────────

/** Inline content of a node, as Markdown. */
function inline(nodes: Node[]): string {
  return nodes.map(inlineOne).join("");
}

function inlineOne(node: Node): string {
  if (node.kind === "text") {
    // Collapse the whitespace a contenteditable sprinkles between tags; a
    // paragraph's line breaks are carried by <br>, not by literal newlines.
    return escapeMarkdown(node.text.replace(/\s+/g, " "));
  }

  const { name, attrs } = node.tag;
  const inner = inline(node.children);

  switch (name) {
    case "strong":
    case "b":
      return inner.trim() ? `**${inner.trim()}**` : "";
    case "em":
    case "i":
      return inner.trim() ? `_${inner.trim()}_` : "";
    case "u": // no Markdown equivalent — keep the words, drop the underline
      return inner;
    case "code":
      // Inline code is literal: undo the escaping applied to its text.
      return inner.trim() ? `\`${inner.replace(/\\([\\`*_[\]])/g, "$1").trim()}\`` : "";
    case "a": {
      const href = attrs["href"] ?? "";
      if (!href) return inner;
      return `[${inner.trim()}](${href})`;
    }
    case "br":
      return "\n";
    case "img": {
      const src = attrs["src"] ?? "";
      return src ? `![${attrs["alt"] ?? ""}](${src})` : "";
    }
    default:
      return inner;
  }
}

/** Block-level content, as Markdown lines. */
function block(nodes: Node[], depth = 0): string[] {
  const lines: string[] = [];
  let pending: Node[] = [];

  const flushInline = (): void => {
    if (pending.length === 0) return;
    // Collapse runs of spaces left where a tag was dropped ("a <u>b</u> c" with
    // the <u> unwrapped) — a browser collapses them on screen too, so this is
    // what the writer saw.
    const text = inline(pending).replace(/ {2,}/g, " ").trim();
    if (text) lines.push(text);
    pending = [];
  };

  for (const node of nodes) {
    if (node.kind === "text" || !BLOCKS.has(node.tag.name)) {
      pending.push(node);
      continue;
    }
    flushInline();
    lines.push(...blockOne(node, depth));
  }

  flushInline();
  return lines;
}

function blockOne(node: Node, depth: number): string[] {
  if (node.kind !== "el") return [];
  const { name } = node.tag;

  if (name === "hr") return ["---"];

  const heading = /^h([1-6])$/.exec(name);
  if (heading) {
    const text = inline(node.children).trim();
    return text ? [`${"#".repeat(Number(heading[1]))} ${text}`] : [];
  }

  if (name === "ul" || name === "ol") {
    const items = node.children.filter(
      (child): child is Extract<Node, { kind: "el" }> =>
        child.kind === "el" && child.tag.name === "li",
    );
    const pad = "  ".repeat(depth);
    return items.flatMap((item, index) => {
      const marker = name === "ol" ? `${index + 1}. ` : "- ";
      // Continuation lines are already indented by their own depth — a nested
      // list renders with `pad` one level deeper — so nothing is added here.
      const [first = "", ...rest] = block(item.children, depth + 1);
      return [`${pad}${marker}${first}`, ...rest];
    });
  }

  if (name === "blockquote") {
    return block(node.children, depth).map((line) => `> ${line}`);
  }

  // p / div / li reached directly: their content is a line of its own.
  return block(node.children, depth);
}

/**
 * Convert one prose block's HTML to Markdown.
 *
 * @param html - `innerHTML` from the block's contenteditable.
 * @returns Markdown, trimmed. Empty when the block holds no text.
 */
export function htmlToMarkdown(html: string): string {
  return block(parse(html))
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
