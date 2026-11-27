/**
 * A page's HTML as a tree a test can walk.
 *
 * Bun's `HTMLRewriter` does the tokenizing: tags, attributes, comments, and the raw text of
 * `<script>`, `<style>`, `<textarea>` and `<title>`, the parts a hand-written regex gets wrong.
 * It is a streaming rewriter, not a tree builder, so this keeps the stack of open elements
 * itself and applies the end tags HTML leaves implied: a second `<li>` closes the first, a
 * `<div>` closes an open `<p>`. Without that, the first of two list items would contain the
 * second, and its text would be both.
 *
 * The tree is plain data. `HtmlElement` and `HtmlDocument` are the views a test reads it through.
 */

/** An element in the tree. The document itself is one, tagged `#document`. */
export interface _Element {
  readonly type: "element";
  readonly tag: string;
  /** In source order, names lower-cased, values with their character references decoded. */
  readonly attrs: Array<readonly [string, string]>;
  readonly children: _Node[];
  readonly parent: _Element | null;
}

/** A run of text, character references decoded (except inside `<script>` and `<style>`). */
export interface _Text {
  readonly type: "text";
  readonly text: string;
  readonly parent: _Element;
}

export type _Node = _Element | _Text;

/** Elements that never have content or an end tag. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Elements whose text is not markup and holds no character references. */
const RAW_TEXT = new Set(["script", "style"]);

/** Starting one of these closes an open `<p>`. */
const CLOSES_P = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

/**
 * For a tag whose start implies an end: the open elements it closes, and the elements past
 * which it stops looking. A second `<li>` inside a nested `<ul>` must not close the outer one.
 */
const IMPLIED: Record<string, { closes: readonly string[]; stopAt: readonly string[] }> = {
  li: { closes: ["li"], stopAt: ["ul", "ol", "menu"] },
  dt: { closes: ["dt", "dd"], stopAt: ["dl"] },
  dd: { closes: ["dt", "dd"], stopAt: ["dl"] },
  option: { closes: ["option"], stopAt: ["select", "datalist", "optgroup"] },
  optgroup: { closes: ["option", "optgroup"], stopAt: ["select"] },
  tr: { closes: ["tr", "td", "th"], stopAt: ["table", "thead", "tbody", "tfoot"] },
  td: { closes: ["td", "th"], stopAt: ["tr", "table"] },
  th: { closes: ["td", "th"], stopAt: ["tr", "table"] },
  thead: { closes: ["thead", "tbody", "tfoot", "tr", "td", "th"], stopAt: ["table"] },
  tbody: { closes: ["thead", "tbody", "tfoot", "tr", "td", "th"], stopAt: ["table"] },
  tfoot: { closes: ["thead", "tbody", "tfoot", "tr", "td", "th"], stopAt: ["table"] },
};

/** Looking for an open `<p>` to close stops at these: a `<p>` outside a button is not in scope. */
const P_SCOPE = new Set([
  "button",
  "table",
  "td",
  "th",
  "caption",
  "template",
  "html",
  "marquee",
  "object",
  "applet",
]);

/** Parse a page, or a fragment of one, into a tree rooted at a `#document` element. */
export function _parseHtml(source: string): _Element {
  const root: _Element = {
    type: "element",
    tag: "#document",
    attrs: [],
    children: [],
    parent: null,
  };
  const stack: _Element[] = [root];
  let pending = "";

  const top = (): _Element => stack[stack.length - 1] ?? root;

  const flush = (): void => {
    if (pending === "") return;
    const parent = top();
    const text = RAW_TEXT.has(parent.tag) ? pending : _decodeEntities(pending);
    const last = parent.children[parent.children.length - 1];
    // Text either side of a comment arrives as two runs; it is one run in the tree.
    if (last?.type === "text") (last as { text: string }).text += text;
    else parent.children.push({ type: "text", text, parent });
    pending = "";
  };

  /** Close `node` and everything opened inside it. A node already closed is left alone. */
  const close = (node: _Element): void => {
    const at = stack.lastIndexOf(node);
    if (at > 0) stack.length = at;
  };

  const closeImplied = (tag: string): void => {
    const rule = IMPLIED[tag];
    if (rule) {
      for (let i = stack.length - 1; i > 0; i--) {
        const open = stack[i]!;
        if (rule.closes.includes(open.tag)) {
          stack.length = i;
          break;
        }
        if (rule.stopAt.includes(open.tag)) break;
      }
    }
    if (CLOSES_P.has(tag)) {
      for (let i = stack.length - 1; i > 0; i--) {
        const open = stack[i]!;
        if (open.tag === "p") {
          stack.length = i;
          break;
        }
        if (P_SCOPE.has(open.tag)) break;
      }
    }
  };

  new HTMLRewriter()
    .on("*", {
      element(el) {
        flush();
        const tag = el.tagName.toLowerCase();
        closeImplied(tag);
        const parent = top();
        const attrs: Array<readonly [string, string]> = [];
        for (const [name, value] of el.attributes) {
          attrs.push([name.toLowerCase(), _decodeEntities(value)]);
        }
        const node: _Element = { type: "element", tag, attrs, children: [], parent };
        parent.children.push(node);
        if (VOID.has(tag) || !el.canHaveContent) return;
        stack.push(node);
        try {
          el.onEndTag(() => {
            flush();
            close(node);
          });
        } catch {
          // No end tag will come (a self-closed foreign element): it holds nothing.
          stack.pop();
        }
      },
    })
    .onDocument({
      text(chunk) {
        pending += chunk.text;
      },
      comments() {
        flush();
      },
    })
    .transform(source);
  flush();
  return root;
}

// ── Character references ────────────────────────────────────────────────────

/**
 * The named references a page is likely to carry. A renderer escapes with the first five;
 * the rest are what people type into templates by hand. Anything else is left as written,
 * which a failure message shows plainly.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  shy: "\u00ad",
  zwj: "\u200d",
  zwnj: "\u200c",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  middot: "·",
  bull: "•",
  times: "×",
  divide: "÷",
  plusmn: "±",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  hearts: "♥",
  star: "☆",
  check: "✓",
};

/** The references HTML accepts without a closing semicolon. */
const LEGACY = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"]);

/** Decode the character references in a run of text or an attribute value. */
export function _decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}))(;?)/g,
    (match, hex: string | undefined, dec: string | undefined, name: string | undefined, semi) => {
      if (hex !== undefined || dec !== undefined) {
        const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
        return String.fromCodePoint(code);
      }
      const value = NAMED[name!];
      if (value === undefined || (semi === "" && !LEGACY.has(name!))) return match;
      return value;
    },
  );
}

// ── Reading the tree ────────────────────────────────────────────────────────

/** An attribute's value, or `null` when the element does not carry it. */
export function _attr(el: _Element, name: string): string | null {
  for (const [key, value] of el.attrs) if (key === name) return value;
  return null;
}

/** The element's child elements, in order. */
export function _childElements(el: _Element): _Element[] {
  return el.children.filter((node): node is _Element => node.type === "element");
}

/** Every element below `el`, in document order. */
export function _descendants(el: _Element): _Element[] {
  const out: _Element[] = [];
  const walk = (node: _Element): void => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
}

/** The `#document` element at the top of `el`'s tree. */
export function _rootOf(el: _Element): _Element {
  let node = el;
  while (node.parent) node = node.parent;
  return node;
}

/** The nearest ancestor with this tag, or the element itself. */
export function _closest(el: _Element, tag: string): _Element | null {
  for (let node: _Element | null = el; node; node = node.parent) if (node.tag === tag) return node;
  return null;
}

/** Elements laid out as blocks: their edges separate words, as on screen. */
const BLOCK = new Set([
  ...CLOSES_P,
  "body",
  "html",
  "li",
  "dd",
  "dt",
  "tr",
  "td",
  "th",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "option",
  "legend",
  "summary",
  "label",
  "button",
  "select",
  "textarea",
  "img",
  "svg",
  "video",
  "iframe",
]);

/** Elements whose content is never part of what a visitor reads. */
const NOT_TEXT = new Set(["script", "style", "template", "noscript", "head"]);

/**
 * The text a visitor reads in `el`: no scripts, styles, templates, `<head>` or `hidden` elements,
 * a space where one block ends and the next begins, and whitespace collapsed.
 */
export function _visibleText(el: _Element): string {
  const parts: string[] = [];
  const walk = (node: _Node, root: boolean): void => {
    if (node.type === "text") {
      parts.push(node.text);
      return;
    }
    if (!root && (NOT_TEXT.has(node.tag) || _attr(node, "hidden") !== null)) return;
    const block = BLOCK.has(node.tag);
    if (block || node.tag === "br") parts.push(" ");
    for (const child of node.children) walk(child, false);
    if (block) parts.push(" ");
  };
  walk(el, true);
  return _collapse(parts.join(""));
}

/** Collapse whitespace (non-breaking spaces included) to single spaces, and trim. */
export function _collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Whether a visitor sees `el`: no `hidden`, `<template>` or `<head>` around it. */
export function _isVisible(el: _Element): boolean {
  for (let node: _Element | null = el; node && node.tag !== "#document"; node = node.parent) {
    if (_attr(node, "hidden") !== null || NOT_TEXT.has(node.tag)) return false;
  }
  return true;
}

// ── Writing it back out ─────────────────────────────────────────────────────

const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string): string => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Attributes whose presence is the whole of their meaning: written bare when empty. */
const BOOLEAN_ATTRS = new Set([
  "async",
  "autofocus",
  "checked",
  "defer",
  "disabled",
  "hidden",
  "inert",
  "multiple",
  "novalidate",
  "open",
  "readonly",
  "required",
  "selected",
]);

/** The element's start tag, as it would be written: `<a href="/projects">`. */
export function _startTag(el: _Element): string {
  const attrs = el.attrs
    .map(([name, value]) =>
      value === "" && BOOLEAN_ATTRS.has(name) ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`,
    )
    .join("");
  return `<${el.tag}${attrs}>`;
}

/** The element and its content, as markup. */
export function _outerHtml(el: _Element): string {
  if (el.tag === "#document") return _innerHtml(el);
  if (VOID.has(el.tag)) return _startTag(el);
  return `${_startTag(el)}${_innerHtml(el)}</${el.tag}>`;
}

/** The element's content, as markup. */
export function _innerHtml(el: _Element): string {
  return el.children
    .map((node) =>
      node.type === "element"
        ? _outerHtml(node)
        : RAW_TEXT.has(el.tag)
          ? node.text
          : escapeText(node.text),
    )
    .join("");
}
