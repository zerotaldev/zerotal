/**
 * CSS selectors, matched against the tree `tree.ts` builds.
 *
 * The selectors a test writes: tags, `#id`, `.class`, every attribute operator (with the `i`
 * flag), the four combinators, selector lists, and the structural and form pseudo-classes —
 * `:not()`, `:is()`, `:where()`, `:has()`, `:nth-child()` and its relatives, `:checked`,
 * `:disabled`, `:enabled`, `:required`, `:empty`, `:root`. A selector it cannot read is an error
 * that names the part it stopped at, rather than a match that silently finds nothing.
 */
import { _attr, _childElements, _closest, _descendants, type _Element } from "./tree.ts";

type Combinator = " " | ">" | "+" | "~";

interface AttributeTest {
  name: string;
  op: "" | "=" | "~=" | "|=" | "^=" | "$=" | "*=";
  value: string;
  insensitive: boolean;
}

interface Pseudo {
  name: string;
  list?: Selector[];
  nth?: { a: number; b: number };
}

interface Compound {
  tag: string | null;
  ids: string[];
  classes: string[];
  attrs: AttributeTest[];
  pseudos: Pseudo[];
}

/** One complex selector: compounds joined by combinators, read right to left when matching. */
interface Selector {
  parts: Array<{ compound: Compound; combinator: Combinator | null }>;
}

const cache = new Map<string, Selector[]>();

/** Parse a selector list. Throws, naming the position, on one it cannot read. */
export function _parseSelector(source: string): Selector[] {
  const cached = cache.get(source);
  if (cached) return cached;
  const parser = new Parser(source);
  const list = parser.list();
  parser.end();
  if (cache.size > 500) cache.clear();
  cache.set(source, list);
  return list;
}

/** Whether `el` matches any selector in the list. */
export function _matches(el: _Element, selectors: Selector[] | string): boolean {
  const list = typeof selectors === "string" ? _parseSelector(selectors) : selectors;
  return list.some((selector) => matchFrom(el, selector.parts, selector.parts.length - 1));
}

/** The elements below `scope` that match, in document order. */
export function _select(scope: _Element, selectors: string): _Element[] {
  const list = _parseSelector(selectors);
  return _descendants(scope).filter((el) => _matches(el, list));
}

// ── Matching ────────────────────────────────────────────────────────────────

const parentOf = (el: _Element): _Element | null =>
  el.parent && el.parent.tag !== "#document" ? el.parent : null;

function siblingsOf(el: _Element): _Element[] {
  return el.parent ? _childElements(el.parent) : [el];
}

function matchFrom(el: _Element, parts: Selector["parts"], index: number): boolean {
  const part = parts[index]!;
  if (!matchCompound(el, part.compound)) return false;
  if (index === 0) return true;
  switch (part.combinator) {
    case ">": {
      const parent = parentOf(el);
      return parent !== null && matchFrom(parent, parts, index - 1);
    }
    case "+": {
      const siblings = siblingsOf(el);
      const previous = siblings[siblings.indexOf(el) - 1];
      return previous !== undefined && matchFrom(previous, parts, index - 1);
    }
    case "~": {
      const siblings = siblingsOf(el);
      return siblings.slice(0, siblings.indexOf(el)).some((s) => matchFrom(s, parts, index - 1));
    }
    default: {
      for (let node = parentOf(el); node; node = parentOf(node)) {
        if (matchFrom(node, parts, index - 1)) return true;
      }
      return false;
    }
  }
}

function matchCompound(el: _Element, compound: Compound): boolean {
  if (el.tag === "#document") return false;
  if (compound.tag !== null && compound.tag !== "*" && compound.tag !== el.tag) return false;
  if (compound.ids.length > 0 && !compound.ids.every((id) => _attr(el, "id") === id)) return false;
  if (compound.classes.length > 0) {
    const classes = (_attr(el, "class") ?? "").split(/\s+/);
    if (!compound.classes.every((name) => classes.includes(name))) return false;
  }
  return (
    compound.attrs.every((test) => matchAttribute(el, test)) &&
    compound.pseudos.every((pseudo) => matchPseudo(el, pseudo))
  );
}

function matchAttribute(el: _Element, test: AttributeTest): boolean {
  const raw = _attr(el, test.name);
  if (raw === null) return false;
  if (test.op === "") return true;
  const value = test.insensitive ? raw.toLowerCase() : raw;
  const expected = test.insensitive ? test.value.toLowerCase() : test.value;
  switch (test.op) {
    case "=":
      return value === expected;
    case "~=":
      return value.split(/\s+/).includes(expected);
    case "|=":
      return value === expected || value.startsWith(`${expected}-`);
    case "^=":
      return expected !== "" && value.startsWith(expected);
    case "$=":
      return expected !== "" && value.endsWith(expected);
    case "*=":
      return expected !== "" && value.includes(expected);
  }
}

const FORM_CONTROLS = new Set(["button", "input", "select", "textarea", "optgroup", "option"]);

function isDisabled(el: _Element): boolean {
  if (!FORM_CONTROLS.has(el.tag) && el.tag !== "fieldset") return false;
  if (_attr(el, "disabled") !== null) return true;
  // A disabled fieldset disables what it holds, except what sits in its first legend.
  for (let node = el.parent; node; node = node.parent) {
    if (node.tag === "fieldset" && _attr(node, "disabled") !== null) {
      const legend = _childElements(node).find((child) => child.tag === "legend");
      return !(legend && _closest(el, "legend") === legend);
    }
  }
  return false;
}

function nthMatches(position: number, { a, b }: { a: number; b: number }): boolean {
  if (a === 0) return position === b;
  const n = (position - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function matchPseudo(el: _Element, pseudo: Pseudo): boolean {
  switch (pseudo.name) {
    case "not":
      return !_matches(el, pseudo.list!);
    case "is":
    case "where":
      return _matches(el, pseudo.list!);
    case "has":
      return _descendants(el).some((child) => _matches(child, pseudo.list!));
    case "root":
      return el.parent?.tag === "#document";
    case "empty":
      return el.children.every((node) => node.type === "text" && node.text === "");
    case "first-child":
      return siblingsOf(el)[0] === el;
    case "last-child":
      return siblingsOf(el).at(-1) === el;
    case "only-child":
      return siblingsOf(el).length === 1;
    case "first-of-type":
      return siblingsOf(el).find((s) => s.tag === el.tag) === el;
    case "last-of-type":
      return siblingsOf(el).findLast((s) => s.tag === el.tag) === el;
    case "only-of-type":
      return siblingsOf(el).filter((s) => s.tag === el.tag).length === 1;
    case "nth-child":
      return nthMatches(siblingsOf(el).indexOf(el) + 1, pseudo.nth!);
    case "nth-last-child": {
      const siblings = siblingsOf(el);
      return nthMatches(siblings.length - siblings.indexOf(el), pseudo.nth!);
    }
    case "nth-of-type": {
      const same = siblingsOf(el).filter((s) => s.tag === el.tag);
      return nthMatches(same.indexOf(el) + 1, pseudo.nth!);
    }
    case "nth-last-of-type": {
      const same = siblingsOf(el).filter((s) => s.tag === el.tag);
      return nthMatches(same.length - same.indexOf(el), pseudo.nth!);
    }
    case "checked":
      return el.tag === "option"
        ? _attr(el, "selected") !== null
        : el.tag === "input" && _attr(el, "checked") !== null;
    case "disabled":
      return isDisabled(el);
    case "enabled":
      return FORM_CONTROLS.has(el.tag) && !isDisabled(el);
    case "required":
      return _attr(el, "required") !== null;
    case "optional":
      return ["input", "select", "textarea"].includes(el.tag) && _attr(el, "required") === null;
    case "link":
    case "any-link":
      return (el.tag === "a" || el.tag === "area") && _attr(el, "href") !== null;
    default:
      return false;
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const SIMPLE_PSEUDOS = new Set([
  "root",
  "empty",
  "first-child",
  "last-child",
  "only-child",
  "first-of-type",
  "last-of-type",
  "only-of-type",
  "checked",
  "disabled",
  "enabled",
  "required",
  "optional",
  "link",
  "any-link",
]);
const LIST_PSEUDOS = new Set(["not", "is", "where", "has"]);
const NTH_PSEUDOS = new Set(["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"]);

class Parser {
  private i = 0;

  constructor(private readonly source: string) {}

  list(): Selector[] {
    const out = [this.complex()];
    this.skipSpace();
    while (this.peek() === ",") {
      this.i++;
      out.push(this.complex());
      this.skipSpace();
    }
    return out;
  }

  end(): void {
    this.skipSpace();
    if (this.i < this.source.length) this.fail(`unexpected "${this.source[this.i]}"`);
  }

  private complex(): Selector {
    this.skipSpace();
    const parts: Selector["parts"] = [{ compound: this.compound(), combinator: null }];
    for (;;) {
      const spaced = this.skipSpace();
      const next = this.peek();
      if (next === ">" || next === "+" || next === "~") {
        this.i++;
        this.skipSpace();
        parts.push({ compound: this.compound(), combinator: next });
      } else if (spaced && next !== undefined && next !== "," && next !== ")") {
        parts.push({ compound: this.compound(), combinator: " " });
      } else {
        return { parts };
      }
    }
  }

  private compound(): Compound {
    const compound: Compound = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
    const start = this.i;
    if (this.peek() === "*") {
      this.i++;
      compound.tag = "*";
    } else if (this.atIdent()) {
      compound.tag = this.ident().toLowerCase();
    }
    for (;;) {
      const next = this.peek();
      if (next === "#") {
        this.i++;
        compound.ids.push(this.ident());
      } else if (next === ".") {
        this.i++;
        compound.classes.push(this.ident());
      } else if (next === "[") {
        compound.attrs.push(this.attribute());
      } else if (next === ":") {
        compound.pseudos.push(this.pseudo());
      } else {
        break;
      }
    }
    if (this.i === start) this.fail("expected a selector");
    return compound;
  }

  private attribute(): AttributeTest {
    this.i++; // [
    this.skipSpace();
    const name = this.ident().toLowerCase();
    this.skipSpace();
    const test: AttributeTest = { name, op: "", value: "", insensitive: false };
    const op = this.source.slice(this.i).match(/^(=|~=|\|=|\^=|\$=|\*=)/)?.[1];
    if (op) {
      this.i += op.length;
      this.skipSpace();
      test.op = op as AttributeTest["op"];
      const quote = this.peek();
      test.value = quote === '"' || quote === "'" ? this.string(quote) : this.ident();
      this.skipSpace();
      const flag = this.peek()?.toLowerCase();
      if (flag === "i" || flag === "s") {
        test.insensitive = flag === "i";
        this.i++;
        this.skipSpace();
      }
    }
    if (this.peek() !== "]") this.fail(`expected "]"`);
    this.i++;
    return test;
  }

  private pseudo(): Pseudo {
    this.i++; // :
    if (this.peek() === ":") this.fail("pseudo-elements cannot match an element");
    const name = this.ident().toLowerCase();
    if (SIMPLE_PSEUDOS.has(name)) return { name };
    if (this.peek() !== "(") {
      this.fail(
        LIST_PSEUDOS.has(name) || NTH_PSEUDOS.has(name)
          ? `:${name} needs an argument`
          : `:${name} is not supported`,
      );
    }
    this.i++; // (
    if (LIST_PSEUDOS.has(name)) {
      const list = this.list();
      this.skipSpace();
      if (this.peek() !== ")") this.fail(`expected ")"`);
      this.i++;
      return { name, list };
    }
    if (NTH_PSEUDOS.has(name)) {
      const close = this.source.indexOf(")", this.i);
      if (close < 0) this.fail(`expected ")"`);
      const nth = parseNth(this.source.slice(this.i, close));
      if (!nth) this.fail(`cannot read :${name}(${this.source.slice(this.i, close)})`);
      this.i = close + 1;
      return { name, nth: nth! };
    }
    return this.fail(`:${name}() is not supported`);
  }

  private string(quote: string): string {
    this.i++;
    let out = "";
    while (this.i < this.source.length && this.source[this.i] !== quote) {
      if (this.source[this.i] === "\\") this.i++;
      out += this.source[this.i] ?? "";
      this.i++;
    }
    if (this.source[this.i] !== quote) this.fail("unterminated string");
    this.i++;
    return out;
  }

  private atIdent(): boolean {
    const char = this.peek();
    return char !== undefined && /[A-Za-z_\-\\ -￿]/.test(char);
  }

  private ident(): string {
    let out = "";
    while (this.i < this.source.length) {
      const char = this.source[this.i]!;
      if (char === "\\") {
        out += this.source[this.i + 1] ?? "";
        this.i += 2;
      } else if (/[A-Za-z0-9_\- -￿]/.test(char)) {
        out += char;
        this.i++;
      } else {
        break;
      }
    }
    if (out === "") this.fail("expected a name");
    return out;
  }

  private peek(): string | undefined {
    return this.source[this.i];
  }

  private skipSpace(): boolean {
    const start = this.i;
    while (this.i < this.source.length && /\s/.test(this.source[this.i]!)) this.i++;
    return this.i > start;
  }

  private fail(reason: string): never {
    throw new Error(
      `Cannot read the selector "${this.source}": ${reason} at position ${this.i + 1}.`,
    );
  }
}

/** `odd`, `even`, `3`, `2n+1`, `-n+3`. */
function parseNth(raw: string): { a: number; b: number } | null {
  const text = raw.replace(/\s+/g, "").toLowerCase();
  if (text === "odd") return { a: 2, b: 1 };
  if (text === "even") return { a: 2, b: 0 };
  if (/^[+-]?\d+$/.test(text)) return { a: 0, b: Number(text) };
  const match = text.match(/^([+-]?\d*)n([+-]\d+)?$/);
  if (!match) return null;
  const a = match[1] === "" || match[1] === "+" ? 1 : match[1] === "-" ? -1 : Number(match[1]);
  return { a, b: match[2] ? Number(match[2]) : 0 };
}
