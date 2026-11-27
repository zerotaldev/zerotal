/**
 * Roles, accessible names and labels: what assistive technology reads off the markup.
 *
 * A test that finds the "Delete" button by its role and name reads the page the way a visitor
 * using a screen reader does, and keeps passing when the classes and the nesting change. This
 * is the part of the accessibility tree a server-rendered page decides by itself: the implicit
 * role of each element, an explicit `role`, and the name from `aria-labelledby`, `aria-label`,
 * a `<label>`, `alt`, the content or `title`, in that order. Styles are not applied, so an
 * element is hidden only by `hidden`, `aria-hidden="true"` or a `<template>`.
 */
import {
  _attr,
  _closest,
  _collapse,
  _descendants,
  _rootOf,
  type _Element,
  type _Node,
} from "./tree.ts";

const LANDMARK_SCOPE = new Set(["article", "aside", "main", "nav", "section"]);

const INPUT_ROLES: Record<string, string | null> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  email: "textbox",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
  hidden: null,
  password: null,
  file: null,
  color: null,
  date: null,
  "datetime-local": null,
  month: null,
  time: null,
  week: null,
};

const TAG_ROLES: Record<string, string> = {
  article: "article",
  aside: "complementary",
  blockquote: "blockquote",
  button: "button",
  caption: "caption",
  code: "code",
  dd: "definition",
  del: "deletion",
  details: "group",
  dfn: "term",
  dialog: "dialog",
  dt: "term",
  em: "emphasis",
  fieldset: "group",
  figure: "figure",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  hr: "separator",
  ins: "insertion",
  li: "listitem",
  main: "main",
  menu: "list",
  meter: "meter",
  nav: "navigation",
  ol: "list",
  optgroup: "group",
  option: "option",
  output: "status",
  p: "paragraph",
  progress: "progressbar",
  search: "search",
  strong: "strong",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  textarea: "textbox",
  tfoot: "rowgroup",
  thead: "rowgroup",
  time: "time",
  tr: "row",
  ul: "list",
};

/** The element's role: its `role` attribute, or the one its tag implies. `null` for none. */
export function _roleOf(el: _Element): string | null {
  const explicit = (_attr(el, "role") ?? "").trim().split(/\s+/)[0];
  if (explicit) return explicit === "presentation" || explicit === "none" ? null : explicit;

  switch (el.tag) {
    case "a":
    case "area":
      return _attr(el, "href") !== null ? "link" : null;
    case "img":
      return _attr(el, "alt") === "" ? null : "img";
    case "input": {
      const type = (_attr(el, "type") ?? "text").toLowerCase();
      if (_attr(el, "list") !== null && ["text", "search", "email", "tel", "url"].includes(type)) {
        return "combobox";
      }
      const role = INPUT_ROLES[type];
      return role === undefined ? "textbox" : role;
    }
    case "select": {
      const size = Number(_attr(el, "size") ?? "0");
      return _attr(el, "multiple") !== null || size > 1 ? "listbox" : "combobox";
    }
    case "header":
    case "footer": {
      for (let node = el.parent; node; node = node.parent) {
        if (LANDMARK_SCOPE.has(node.tag)) return null;
      }
      return el.tag === "header" ? "banner" : "contentinfo";
    }
    case "section":
      return _attr(el, "aria-label") || _attr(el, "aria-labelledby") ? "region" : null;
    case "form":
      return "form";
    case "th":
      return _attr(el, "scope") === "row" ? "rowheader" : "columnheader";
    default:
      return TAG_ROLES[el.tag] ?? null;
  }
}

/** The heading level of an `h1`–`h6`, or of a `role="heading"` with `aria-level`. */
export function _levelOf(el: _Element): number | null {
  const explicit = _attr(el, "aria-level");
  if (explicit !== null) return Number(explicit);
  const match = el.tag.match(/^h([1-6])$/);
  return match ? Number(match[1]) : null;
}

/** Hidden from assistive technology: `hidden`, `aria-hidden="true"`, or inside a `<template>`. */
export function _isHiddenFromA11y(el: _Element): boolean {
  for (let node: _Element | null = el; node && node.tag !== "#document"; node = node.parent) {
    if (
      _attr(node, "hidden") !== null ||
      _attr(node, "aria-hidden") === "true" ||
      node.tag === "template" ||
      node.tag === "head" ||
      (node.tag === "input" && (_attr(node, "type") ?? "").toLowerCase() === "hidden")
    ) {
      return true;
    }
  }
  return false;
}

/** Roles whose name, failing a label, comes from what they contain. */
const NAME_FROM_CONTENT = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "row",
  "rowheader",
  "switch",
  "tab",
  "tooltip",
  "treeitem",
]);

const LABELABLE = new Set(["input", "select", "textarea", "meter", "output", "progress", "button"]);

/** The element's accessible name, whitespace collapsed. `""` when it has none. */
export function _nameOf(el: _Element): string {
  const root = _rootOf(el);

  const labelledby = _attr(el, "aria-labelledby");
  if (labelledby) {
    const name = labelledby
      .split(/\s+/)
      .map((id) => byId(root, id))
      .filter((node): node is _Element => node !== null)
      .map((node) => textFor(node, null, true))
      .join(" ");
    if (_collapse(name)) return _collapse(name);
  }

  const label = _attr(el, "aria-label");
  if (label && label.trim()) return _collapse(label);

  if (el.tag === "input") {
    const type = (_attr(el, "type") ?? "text").toLowerCase();
    if (type === "submit" || type === "reset" || type === "button") {
      const value = _attr(el, "value");
      if (value !== null) return _collapse(value);
      if (type === "submit") return "Submit";
      if (type === "reset") return "Reset";
    }
    if (type === "image") return _collapse(_attr(el, "alt") ?? "Submit");
  }

  if (LABELABLE.has(el.tag)) {
    const labels = _labelsOf(el);
    if (labels.length > 0) {
      const name = _collapse(labels.map((node) => textFor(node, el, false)).join(" "));
      if (name) return name;
    }
  }

  if (el.tag === "img" || el.tag === "area") {
    const alt = _attr(el, "alt");
    if (alt !== null && alt.trim()) return _collapse(alt);
  }
  if (el.tag === "svg") {
    const title = el.children.find(
      (node): node is _Element => node.type === "element" && node.tag === "title",
    );
    if (title) return textFor(title, null, true);
  }
  if (el.tag === "fieldset" || el.tag === "table" || el.tag === "figure") {
    const captionTag = { fieldset: "legend", table: "caption", figure: "figcaption" }[el.tag];
    const caption = el.children.find(
      (node): node is _Element => node.type === "element" && node.tag === captionTag,
    );
    if (caption) {
      const name = textFor(caption, null, false);
      if (name) return name;
    }
  }

  const role = _roleOf(el);
  if (role !== null && NAME_FROM_CONTENT.has(role)) {
    const name = textFor(el, null, false);
    if (name) return name;
  }

  const title = _attr(el, "title");
  if (title && title.trim()) return _collapse(title);

  if (el.tag === "input" || el.tag === "textarea") {
    const placeholder = _attr(el, "placeholder");
    if (placeholder && placeholder.trim()) return _collapse(placeholder);
  }
  return "";
}

/**
 * Each document's ids and `<label for>` targets, indexed once. A parsed page does not change, and
 * scanning the whole page for every control made a form of a thousand fields take seconds.
 */
interface _DocIndex {
  byId: Map<string, _Element>;
  labelsFor: Map<string, _Element[]>;
}
const _indexes = new WeakMap<_Element, _DocIndex>();

function _indexOf(root: _Element): _DocIndex {
  let index = _indexes.get(root);
  if (index) return index;
  index = { byId: new Map(), labelsFor: new Map() };
  for (const node of _descendants(root)) {
    const id = _attr(node, "id");
    if (id && !index.byId.has(id)) index.byId.set(id, node);
    if (node.tag === "label") {
      const target = _attr(node, "for");
      if (target) {
        const list = index.labelsFor.get(target);
        if (list) list.push(node);
        else index.labelsFor.set(target, [node]);
      }
    }
  }
  _indexes.set(root, index);
  return index;
}

/** The `<label>` elements that label a control: `for` its id, or wrapped around it. */
export function _labelsOf(control: _Element): _Element[] {
  const labels: _Element[] = [];
  const id = _attr(control, "id");
  if (id) labels.push(...(_indexOf(_rootOf(control)).labelsFor.get(id) ?? []));
  const wrapping = control.parent ? _closest(control.parent, "label") : null;
  if (wrapping && !labels.includes(wrapping)) {
    const target = _attr(wrapping, "for");
    if (target === null || target === id) labels.push(wrapping);
  }
  return labels;
}

/**
 * The text a name is computed from: descendants' own names where they have one (an icon's
 * `aria-label`, an image's `alt`), hidden parts skipped unless the reference is explicit.
 */
function textFor(el: _Element, skip: _Element | null, includeHidden: boolean): string {
  const parts: string[] = [];
  const walk = (node: _Node, top: boolean): void => {
    if (node.type === "text") {
      if (node.parent.tag !== "script" && node.parent.tag !== "style") parts.push(node.text);
      return;
    }
    if (node === skip) return;
    if (!top) {
      if (node.tag === "script" || node.tag === "style" || node.tag === "template") return;
      if (
        !includeHidden &&
        (_attr(node, "hidden") !== null || _attr(node, "aria-hidden") === "true")
      ) {
        return;
      }
      const label = _attr(node, "aria-label");
      if (label && label.trim()) {
        parts.push(` ${label} `);
        return;
      }
      if (node.tag === "img") {
        parts.push(` ${_attr(node, "alt") ?? ""} `);
        return;
      }
      if (["input", "select", "textarea"].includes(node.tag)) return;
    }
    const spaced = !["a", "span", "strong", "em", "b", "i", "code", "small", "abbr"].includes(
      node.tag,
    );
    if (spaced) parts.push(" ");
    for (const child of node.children) walk(child, false);
    if (spaced) parts.push(" ");
  };
  walk(el, true);
  return _collapse(parts.join(""));
}

function byId(root: _Element, id: string): _Element | null {
  return _indexOf(root).byId.get(id) ?? null;
}

/** The element with this id in `el`'s document. */
export function _byId(el: _Element, id: string): _Element | null {
  return byId(_rootOf(el), id);
}
