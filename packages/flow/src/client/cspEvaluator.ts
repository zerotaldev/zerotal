// ── CSP-safe expression evaluator ──────────────────────────────────────────────
//
// A tiny tokenizer + recursive-descent parser + tree-walking evaluator for the
// subset of JavaScript that Flow/Alpine expressions use — WITHOUT `eval` or
// `new Function`, so it runs under a strict Content-Security-Policy that omits
// `'unsafe-eval'`.
//
// Supported: identifiers, member access (a.b.c), calls f(a, b), literals
// (number/string/true/false/null/undefined), arrays, object literals, unary
// (! - +), prefix/postfix ++/--, binary (+ - * / % === !== == != < > <= >=),
// logical (&& ||), ternary (?:), grouping, and assignment (= += -= *= /=).
//
// NOT supported (throws): arrow functions (=>), template literals (`…`), computed
// member access (a[b]), spread (...), comma sequences, statements. Move that logic
// into an @expose action or a named method instead.

import { FlowClientError } from "./FlowClientError.ts";

export class CspSyntaxError extends FlowClientError {}

// ── Tokenizer ───────────────────────────────────────────────────────────────

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "name"; v: string }
  | { t: "punc"; v: string };

const PUNCT3 = ["===", "!==", "**="];
const PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "?."];
const PUNCT1 = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "<",
  ">",
  "=",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ".",
  ",",
  ":",
  "?",
];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // Reject the constructs we deliberately don't support, with a clear message.
    if (c === "`") throw new CspSyntaxError("Template literals are not allowed in CSP-safe mode.");

    // String literal
    if (c === '"' || c === "'") {
      const quote = c;
      let s = "";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          s += src[i + 1] ?? "";
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      if (i >= n) throw new CspSyntaxError("Unterminated string literal.");
      i++; // closing quote
      toks.push({ t: "str", v: s });
      continue;
    }

    // Number
    if (c >= "0" && c <= "9") {
      let s = "";
      while (i < n && /[0-9.]/.test(src[i]!)) {
        s += src[i];
        i++;
      }
      toks.push({ t: "num", v: Number(s) });
      continue;
    }

    // Identifier / keyword ($ and _ allowed)
    if (/[A-Za-z_$]/.test(c)) {
      let s = "";
      while (i < n && /[A-Za-z0-9_$]/.test(src[i]!)) {
        s += src[i];
        i++;
      }
      toks.push({ t: "name", v: s });
      continue;
    }

    // Punctuators (longest match first)
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (two === "=>") throw new CspSyntaxError("Arrow functions are not allowed in CSP-safe mode.");
    if (two === "...") {
      /* not reachable (3-char) */
    }
    if (src.slice(i, i + 3) === "...")
      throw new CspSyntaxError("Spread (...) is not allowed in CSP-safe mode.");
    if (PUNCT3.includes(three)) {
      toks.push({ t: "punc", v: three });
      i += 3;
      continue;
    }
    if (PUNCT2.includes(two)) {
      toks.push({ t: "punc", v: two });
      i += 2;
      continue;
    }
    if (PUNCT1.includes(c)) {
      toks.push({ t: "punc", v: c });
      i += 1;
      continue;
    }

    throw new CspSyntaxError(`Unexpected character '${c}' in expression.`);
  }
  return toks;
}

// ── AST ─────────────────────────────────────────────────────────────────────

type Node =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "member"; obj: Node; prop: string }
  | { k: "call"; callee: Node; args: Node[] }
  | { k: "array"; els: Node[] }
  | { k: "object"; props: Array<{ key: string; value: Node }> }
  | { k: "unary"; op: string; arg: Node }
  | { k: "update"; op: string; prefix: boolean; arg: Node }
  | { k: "binary"; op: string; left: Node; right: Node }
  | { k: "logical"; op: string; left: Node; right: Node }
  | { k: "cond"; test: Node; cons: Node; alt: Node }
  | { k: "assign"; op: string; target: Node; value: Node };

// ── Parser (recursive descent) ────────────────────────────────────────────────

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private next(): Tok | undefined {
    return this.toks[this.p++];
  }
  private isPunc(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "punc" && t.v === v;
  }
  private eat(v: string): void {
    if (!this.isPunc(v)) throw new CspSyntaxError(`Expected '${v}'.`);
    this.p++;
  }

  parse(): Node {
    const node = this.assignment();
    if (this.p < this.toks.length)
      throw new CspSyntaxError("Unexpected trailing tokens in expression.");
    return node;
  }

  private assignment(): Node {
    const left = this.conditional();
    const t = this.peek();
    if (t && t.t === "punc" && ["=", "+=", "-=", "*=", "/=", "%="].includes(t.v)) {
      this.p++;
      const value = this.assignment();
      return { k: "assign", op: t.v, target: left, value };
    }
    return left;
  }

  private conditional(): Node {
    const test = this.logicalOr();
    if (this.isPunc("?")) {
      this.p++;
      const cons = this.assignment();
      this.eat(":");
      const alt = this.assignment();
      return { k: "cond", test, cons, alt };
    }
    return test;
  }

  private logicalOr(): Node {
    let left = this.logicalAnd();
    while (this.isPunc("||")) {
      this.p++;
      left = { k: "logical", op: "||", left, right: this.logicalAnd() };
    }
    return left;
  }
  private logicalAnd(): Node {
    let left = this.equality();
    while (this.isPunc("&&")) {
      this.p++;
      left = { k: "logical", op: "&&", left, right: this.equality() };
    }
    return left;
  }
  private equality(): Node {
    let left = this.relational();
    while (this.peekPuncIn(["===", "!==", "==", "!="])) {
      const op = (this.next() as Tok).v as string;
      left = { k: "binary", op, left, right: this.relational() };
    }
    return left;
  }
  private relational(): Node {
    let left = this.additive();
    while (this.peekPuncIn(["<", ">", "<=", ">="])) {
      const op = (this.next() as Tok).v as string;
      left = { k: "binary", op, left, right: this.additive() };
    }
    return left;
  }
  private additive(): Node {
    let left = this.multiplicative();
    while (this.peekPuncIn(["+", "-"])) {
      const op = (this.next() as Tok).v as string;
      left = { k: "binary", op, left, right: this.multiplicative() };
    }
    return left;
  }
  private multiplicative(): Node {
    let left = this.unary();
    while (this.peekPuncIn(["*", "/", "%"])) {
      const op = (this.next() as Tok).v as string;
      left = { k: "binary", op, left, right: this.unary() };
    }
    return left;
  }

  private peekPuncIn(ops: string[]): boolean {
    const t = this.peek();
    return !!t && t.t === "punc" && ops.includes(t.v);
  }

  private unary(): Node {
    if (this.peekPuncIn(["!", "-", "+"])) {
      const op = (this.next() as Tok).v as string;
      return { k: "unary", op, arg: this.unary() };
    }
    if (this.peekPuncIn(["++", "--"])) {
      const op = (this.next() as Tok).v as string;
      return { k: "update", op, prefix: true, arg: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.callMember();
    if (this.peekPuncIn(["++", "--"])) {
      const op = (this.next() as Tok).v as string;
      node = { k: "update", op, prefix: false, arg: node };
    }
    return node;
  }

  private callMember(): Node {
    let node = this.primary();
    for (;;) {
      if (this.isPunc(".")) {
        this.p++;
        const t = this.next();
        if (!t || t.t !== "name") throw new CspSyntaxError('Expected property name after ".".');
        node = { k: "member", obj: node, prop: t.v };
      } else if (this.isPunc("(")) {
        this.p++;
        const args: Node[] = [];
        if (!this.isPunc(")")) {
          args.push(this.assignment());
          while (this.isPunc(",")) {
            this.p++;
            args.push(this.assignment());
          }
        }
        this.eat(")");
        node = { k: "call", callee: node, args };
      } else if (this.isPunc("[")) {
        throw new CspSyntaxError(
          "Computed member access (obj[expr]) is not allowed in CSP-safe mode.",
        );
      } else {
        return node;
      }
    }
  }

  private primary(): Node {
    const t = this.next();
    if (!t) throw new CspSyntaxError("Unexpected end of expression.");
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "name") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (t.v === "undefined") return { k: "lit", v: undefined };
      return { k: "id", name: t.v };
    }
    if (t.t === "punc") {
      if (t.v === "(") {
        const e = this.assignment();
        this.eat(")");
        return e;
      }
      if (t.v === "[") {
        const els: Node[] = [];
        if (!this.isPunc("]")) {
          els.push(this.assignment());
          while (this.isPunc(",")) {
            this.p++;
            els.push(this.assignment());
          }
        }
        this.eat("]");
        return { k: "array", els };
      }
      if (t.v === "{") {
        const props: Array<{ key: string; value: Node }> = [];
        if (!this.isPunc("}")) {
          do {
            const kt = this.next();
            let key: string;
            if (kt && (kt.t === "name" || kt.t === "str")) key = String(kt.v);
            else throw new CspSyntaxError("Expected object key.");
            this.eat(":");
            props.push({ key, value: this.assignment() });
          } while (this.isPunc(",") && (this.p++, true));
        }
        this.eat("}");
        return { k: "object", props };
      }
    }
    throw new CspSyntaxError(`Unexpected token '${(t as { v?: unknown }).v}'.`);
  }
}

// ── Evaluator ───────────────────────────────────────────────────────────────

type Scope = Record<string, unknown>;

/** Resolve an assignment/update target to its container + key (for write-back). */
function resolveRef(node: Node, scope: Scope): { obj: Record<string, unknown>; key: string } {
  if (node.k === "id") return { obj: scope, key: node.name };
  if (node.k === "member") {
    const obj = evalNode(node.obj, scope) as Record<string, unknown>;
    if (obj == null) throw new CspSyntaxError(`Cannot assign to property "${node.prop}" of null.`);
    return { obj, key: node.prop };
  }
  throw new CspSyntaxError("Invalid assignment target.");
}

function evalNode(node: Node, scope: Scope): unknown {
  switch (node.k) {
    case "lit":
      return node.v;
    case "id":
      return scope[node.name];
    case "member": {
      const obj = evalNode(node.obj, scope);
      return obj == null ? undefined : (obj as Record<string, unknown>)[node.prop];
    }
    case "array":
      return node.els.map((e) => evalNode(e, scope));
    case "object": {
      const o: Record<string, unknown> = {};
      for (const p of node.props) o[p.key] = evalNode(p.value, scope);
      return o;
    }
    case "call": {
      let thisArg: unknown = undefined;
      let fn: unknown;
      if (node.callee.k === "member") {
        thisArg = evalNode(node.callee.obj, scope);
        fn = thisArg == null ? undefined : (thisArg as Record<string, unknown>)[node.callee.prop];
      } else {
        fn = evalNode(node.callee, scope);
      }
      if (typeof fn !== "function") throw new CspSyntaxError("Attempted to call a non-function.");
      const args = node.args.map((a) => evalNode(a, scope));
      return (fn as (...a: unknown[]) => unknown).apply(thisArg, args);
    }
    case "unary": {
      const v = evalNode(node.arg, scope);
      if (node.op === "!") return !v;
      if (node.op === "-") return -(v as number);
      return +(v as number);
    }
    case "update": {
      const ref = resolveRef(node.arg, scope);
      const old = Number(ref.obj[ref.key]);
      const next = node.op === "++" ? old + 1 : old - 1;
      ref.obj[ref.key] = next;
      return node.prefix ? next : old;
    }
    case "logical": {
      const l = evalNode(node.left, scope);
      if (node.op === "&&") return l ? evalNode(node.right, scope) : l;
      return l ? l : evalNode(node.right, scope);
    }
    case "cond":
      return evalNode(node.test, scope) ? evalNode(node.cons, scope) : evalNode(node.alt, scope);
    case "binary": {
      const l = evalNode(node.left, scope) as never;
      const r = evalNode(node.right, scope) as never;
      switch (node.op) {
        case "===":
          return l === r;
        case "!==":
          return l !== r;
        case "==":
          return l == r; // eslint-disable-line eqeqeq
        case "!=":
          return l != r; // eslint-disable-line eqeqeq
        case "<":
          return l < r;
        case ">":
          return l > r;
        case "<=":
          return l <= r;
        case ">=":
          return l >= r;
        case "+":
          return (l as number) + (r as number);
        case "-":
          return (l as number) - (r as number);
        case "*":
          return (l as number) * (r as number);
        case "/":
          return (l as number) / (r as number);
        case "%":
          return (l as number) % (r as number);
      }
      throw new CspSyntaxError(`Unknown operator '${node.op}'.`);
    }
    case "assign": {
      const ref = resolveRef(node.target, scope);
      const rhs = evalNode(node.value, scope);
      if (node.op === "=") {
        ref.obj[ref.key] = rhs;
        return rhs;
      }
      const cur = ref.obj[ref.key] as number;
      const next =
        node.op === "+="
          ? (cur as unknown as number) + (rhs as number)
          : node.op === "-="
            ? cur - (rhs as number)
            : node.op === "*="
              ? cur * (rhs as number)
              : node.op === "/="
                ? cur / (rhs as number)
                : cur % (rhs as number);
      ref.obj[ref.key] = next;
      return next;
    }
  }
}

// Small AST cache so repeated evaluations of the same expression skip re-parsing.
const _astCache = new Map<string, Node>();

/** Parse + evaluate `expr` against `scope`, with no eval/new Function. */
export function evaluateCsp(expr: string, scope: Scope): unknown {
  let ast = _astCache.get(expr);
  if (!ast) {
    ast = new Parser(tokenize(expr)).parse();
    _astCache.set(expr, ast);
  }
  return evalNode(ast, scope);
}
