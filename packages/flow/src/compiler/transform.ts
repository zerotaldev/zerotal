/**
 * Flow JSX compiler — TypeScript AST → compiled render() function string.
 *
 * Takes a .tsx source file and returns the body of a compiled render()
 * that emits HTML via string concatenation instead of going through the
 * jsx() runtime, getter instrumentation, and thunk system.
 *
 * Returns null when the file cannot be fully compiled (no Component subclass,
 * unsupported JSX patterns like maps/ternaries/imported components).
 * Those pages continue to use the standard runtime transparently.
 */

import * as ts from "typescript";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ZerotalError } from "@zerotal/core";
import {
  BOOLEAN_DIRECTIVES,
  STRING_DIRECTIVES,
  ATTR_RENAMES,
  VOID_ELEMENTS,
} from "./directives.ts";

// Component base class names that trigger compilation.
const BASE_CLASSES = new Set(["Component"]);

// Client-only `this.<magic>(…)` helpers (resolved on `$flow`, not the server). A
// read/call rooted at one compiles to a reactive binding (`:attr` or flow:text)
// rather than a server-rendered value — `this.<magic>` → `$flow.<magic>`.
const CLIENT_MAGICS = new Set(["currentUrl", "navigateCurrent"]);

// The only bare `this.<name>()` client magics still honoured — the ones that are ALSO real
// Component methods (`this.refresh()` / `this.dispatch()` …), so the name is owned by the base
// class and can't collide with a developer's own member. The `this.`→`$flow.` rewrite plus the
// bridge's alias resolve these to the matching `$flow.$<name>` helper. EVERY other client magic
// now lives ONLY under `$flow` with its `$`-prefix (`$flow.$set`, `$flow.$store`, `$flow.$parent`,
// …) — written directly, no rewrite — which leaves the bare names (`set`, `toggle`, `store`,
// `parent`, `on`, `watch`, …) free for the developer's own props/methods. Keep in sync with
// `_MAGIC_ALIASES` in client/bridge.ts.
const CLIENT_CALLBACK_MAGICS = new Set(["refresh", "dispatch", "dispatchTo", "dispatchSelf"]);

// The client magics you reach through `$flow`. In JSX you write them BARE for clean ergonomics
// (`$flow.set(...)`, `$flow.store.ui.dark`, `$flow.appendOptimistic(...)`) and the AOT compiler
// rewrites each to its canonical `$`-prefixed form (`$flow.$set`, `$flow.$store`, …) so the runtime
// is unambiguous. Longer names first so the alternation prefers `dispatchTo` over `dispatch`, etc.
const FLOW_MAGIC_NAMES = [
  "dispatchTo",
  "dispatchSelf",
  "dispatch",
  "appendOptimistic",
  "removeOptimistic",
  "onWhisper",
  "whisper",
  "on",
  "set",
  "get",
  "toggle",
  "call",
  "commit",
  "refresh",
  "watch",
  "parent",
  "store",
  "cancel",
];
const _FLOW_MAGIC_RE = new RegExp(`(\\$flow)\\.(${FLOW_MAGIC_NAMES.join("|")})\\b`, "g");

/**
 * Rewrite a client expression for emission. Two passes, in this order:
 *   1. author-written bare `$flow.<magic>` → `$flow.$<magic>` — the AOT step that makes the runtime
 *      unambiguous (a framework helper always wears `$`), so the bare names stay the developer's.
 *   2. `this.<member>` → `$flow.<member>` — the developer's reactive prop / action.
 * Order matters: (1) runs on the ORIGINAL text, so a `this.set` (a member named like a magic)
 * becomes `$flow.set` (the dev's reactive read / action), never the `$flow.$set` magic. The rule:
 * `this.name` is always yours; `$flow.name` is always the framework helper.
 */
function _rewriteClientExpr(src: string): string {
  return src.replace(_FLOW_MAGIC_RE, "$1.$$$2").replace(/\bthis\./g, "$flow.");
}

export interface TransformResult {
  /** The compiled render function body — ready to wrap in `export async function render() { ... }`. */
  renderBody: string;
  /** The Component class name, for attribution in the compiled file header. */
  className: string;
  /**
   * Module-level preamble to emit ABOVE the render function: the page's import
   * declarations (relative specifiers rewritten to absolute file URLs) plus its
   * top-level const/function/type declarations — so the compiled render can see
   * the same module scope (imported helpers, module consts) the original did.
   */
  preamble: string;
}

/**
 * Run only the validation pass for a Flow page source file.
 * Throws FlowValidationError on @expose/@locked violations.
 * Called unconditionally by the compiler orchestrator — even on cache hits —
 * so violations always surface regardless of cached compiled output.
 */
export function validateFlowFile(source: string, filename: string): void {
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const pageClass = _findPageClass(sf);
  if (!pageClass) return;
  const members = _getMemberInfo(pageClass);
  _validateFlowCallbacks(sf, members, filename);
}

/**
 * Transform a Flow page/component source file.
 * Returns the compiled render function, or null if the file can't be compiled.
 */
/** When true, the compiler emits only CSP-safe expressions (no arrow wrappers,
 *  no template literals in bindings) and errors on anything that can't be. Set
 *  per-call by transformFlowFile; read by the emission helpers below. Safe as
 *  module state because compilation is synchronous and single-threaded. */
let _cspSafe = false;

/** Throw if an emitted client expression uses syntax the CSP evaluator rejects. */
function _assertCspExpr(text: string, filename: string): void {
  if (!_cspSafe) return;
  if (/=>/.test(text)) {
    throw new FlowValidationError(
      `[Flow CSP] arrow functions aren't allowed in CSP-safe mode: \`${text}\`.\n` +
        `  Move the logic into an @expose action or a named method.\n  File: ${filename}`,
    );
  }
  if (text.includes("`")) {
    throw new FlowValidationError(
      `[Flow CSP] template literals aren't allowed in CSP-safe expressions: \`${text}\`.\n` +
        `  Use string concatenation (a + b) instead.\n  File: ${filename}`,
    );
  }
}

/**
 * Compile a page's `render()` to a string-concatenating function body.
 *
 * Returns null when the page can't be compiled and must render through the
 * runtime instead. Pass `report` to learn why: the compiler fills in the first
 * blocker it hit, with the line and column to look at.
 */
export function transformFlowFile(
  source: string,
  filename: string,
  opts: { cspSafe?: boolean; report?: BlockerReport } = {},
): TransformResult | null {
  _cspSafe = opts.cspSafe ?? false;
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const pageClass = _findPageClass(sf);
  if (!pageClass) return null;

  const members = _getMemberInfo(pageClass);
  const className = pageClass.name?.text ?? "Unknown";

  // Validate flow() client callbacks across the whole file before AOT.
  // This must run even when the AOT compiler bails (ternaries, components, etc.).
  _validateFlowCallbacks(sf, members, filename);

  const renderMethod = _findRenderMethod(pageClass);
  if (!renderMethod) return null;

  const report: BlockerReport = opts.report ?? {};
  const renderBody = _compileRenderMethod(renderMethod, filename, members, report);
  if (!renderBody) {
    // The page couldn't be statically compiled, so it falls back to the runtime renderer — which
    // EVALUATES JSX expressions on the server. A `$flow` read in a value position (a binding or a
    // text child) would blow up there with a bare `$flow is not defined`, because `$flow` is a
    // client-only global. Fail fast with the reason instead of that cryptic runtime error.
    const flowRef = _findServerEvaluatedFlowRef(renderMethod);
    if (flowRef) {
      const read = _blockerAt(flowRef.node, "", "");
      throw new FlowValidationError(
        `${className} reads \`$flow\` in a ${flowRef.where}, but this page can't be statically compiled.\n` +
          `  ${_at(filename, read.line, read.column)}  ← the \`$flow\` read\n` +
          `  Without compilation the page renders through the runtime, which evaluates JSX on the\n` +
          `  server — and \`$flow\` is a client-only global, so it would fail there.\n` +
          describeBlocker(report.blocker, filename) +
          `  Fix either side: drop the \`$flow\` read, or clear the blocker so the page compiles.\n` +
          `  (\`$flow\` inside an onClick/onChange handler is always fine — handlers are never evaluated on the server.)`,
      );
    }
    return null;
  }

  const preamble = _buildPreamble(sf, filename);
  return { renderBody, className, preamble };
}

/**
 * Find a `$flow` reference that the RUNTIME renderer would evaluate on the server — i.e. one in a
 * value position: a non-event JSX attribute value, or a JSX child expression.
 *
 * `$flow` inside an `on*` handler never counts, at any depth: handlers are serialised to a `flow:*`
 * attribute and never invoked server-side. Depth is the whole difficulty — a `<For>` child is an
 * arrow function whose body is full of handlers, so scanning a child expression wholesale reports
 * a read the developer never wrote, in a position they never used.
 *
 * Returns the offending identifier and a short description of its position, or null.
 */
function _findServerEvaluatedFlowRef(node: ts.Node): { where: string; node: ts.Node } | null {
  let found: { where: string; node: ts.Node } | null = null;

  const visit = (n: ts.Node): void => {
    if (found) return;
    // Skip the whole handler subtree rather than just its attribute.
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text.startsWith("on")) return;

    if (ts.isIdentifier(n) && n.text === "$flow") {
      const p = n.parent;
      // Skip when `$flow` is the member NAME (`obj.$flow`), not the object root.
      if (!(p && ts.isPropertyAccessExpression(p) && p.name === n)) {
        const where = _gelRefPosition(n);
        if (where) found = { where, node: n };
        return;
      }
    }
    ts.forEachChild(n, visit);
  };

  visit(node);
  return found;
}

/**
 * Classify where a `$flow` identifier sits by walking up to the JSX construct holding it:
 * a named attribute binding, a text child, or a position the server never evaluates (null).
 */
function _gelRefPosition(id: ts.Node): string | null {
  for (let n: ts.Node | undefined = id; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) {
      const name = ts.isIdentifier(n.name) ? n.name.text : "";
      return name.startsWith("on") ? null : `\`${name}=\` binding`;
    }
    if (ts.isJsxExpression(n) && n.parent && !ts.isJsxAttribute(n.parent)) return "text child";
  }
  return null;
}

/**
 * Component binding props whose `{this.key}` value the runtime resolves to a
 * property NAME (via `_resolveReactiveName`). The AOT bind-injection pass makes
 * that resolution static + robust by emitting the key up front. Maps each attr
 * to the key it takes inside the emitted `__flowBinds` object (the same name the
 * component reads with `_injectedBindKey(props, attr)`).
 */
const BIND_INJECT_ATTRS = new Set(["show", "bind", "query"]);

/**
 * Bind-name injection — the runtime-path counterpart to AOT compilation.
 *
 * The string compiler bails on any function component, so component-heavy pages
 * render through the runtime `jsx()` path, where TSC's jsx transform has already
 * discarded the `show`→`sheetOpen` prop→key mapping. That makes value-based bind
 * resolution fragile (a sibling/child binding clobbers the getter capture, and
 * same-valued props can't be told apart). This pass reprints the page's
 * `render()` with `__flowBinds={{ show: "sheetOpen" }}` added to every component
 * that binds `show`/`bind`/`query` to `this.<key>`, so the component resolves its
 * bound prop statically. The reprint is otherwise identical to the source, so
 * behaviour is unchanged apart from robust binding. Returns a standalone
 * `render()` module (pragma + preamble + function), or null when nothing to inject.
 */
export function buildBindInjectedRender(source: string, filename: string): string | null {
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const pageClass = _findPageClass(sf);
  if (!pageClass) return null;
  const renderMethod = _findRenderMethod(pageClass);
  if (!renderMethod || !renderMethod.body) return null;

  let injected = false;

  const transformer =
    (ctx: ts.TransformationContext) =>
    (root: ts.Node): ts.Node => {
      const { factory } = ctx;

      const withInjectedAttrs = (attrs: ts.JsxAttributes, tagNode: ts.JsxTagNameExpression) => {
        const tag = _tagName(tagNode);
        if (!tag || !_isComponent(tag)) return attrs;
        // Respect an explicit __flowBinds already present (idempotent).
        if (
          attrs.properties.some(
            (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === "__flowBinds",
          )
        ) {
          return attrs;
        }
        const binds: ts.PropertyAssignment[] = [];
        for (const p of attrs.properties) {
          if (!ts.isJsxAttribute(p) || !ts.isIdentifier(p.name)) continue;
          if (!BIND_INJECT_ATTRS.has(p.name.text)) continue;
          const init = p.initializer;
          if (!init || !ts.isJsxExpression(init) || !init.expression) continue;
          const e = init.expression;
          if (
            ts.isPropertyAccessExpression(e) &&
            e.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isIdentifier(e.name)
          ) {
            binds.push(
              factory.createPropertyAssignment(
                factory.createIdentifier(p.name.text),
                factory.createStringLiteral(e.name.text),
              ),
            );
          }
        }
        if (binds.length === 0) return attrs;
        injected = true;
        const flowBindsAttr = factory.createJsxAttribute(
          factory.createIdentifier("__flowBinds"),
          factory.createJsxExpression(
            undefined,
            factory.createObjectLiteralExpression(binds, false),
          ),
        );
        return factory.updateJsxAttributes(attrs, [...attrs.properties, flowBindsAttr]);
      };

      const visit = (node: ts.Node): ts.Node => {
        if (ts.isJsxSelfClosingElement(node)) {
          const next = factory.updateJsxSelfClosingElement(
            node,
            node.tagName,
            node.typeArguments,
            withInjectedAttrs(node.attributes, node.tagName),
          );
          return ts.visitEachChild(next, visit, ctx);
        }
        if (ts.isJsxElement(node)) {
          const opening = factory.updateJsxOpeningElement(
            node.openingElement,
            node.openingElement.tagName,
            node.openingElement.typeArguments,
            withInjectedAttrs(node.openingElement.attributes, node.openingElement.tagName),
          );
          const next = factory.updateJsxElement(node, opening, node.children, node.closingElement);
          return ts.visitEachChild(next, visit, ctx);
        }
        return ts.visitEachChild(node, visit, ctx);
      };
      return ts.visitNode(root, visit);
    };

  const result = ts.transform(renderMethod.body, [transformer]);
  const newBody = result.transformed[0]!;
  if (!injected) {
    result.dispose();
    return null;
  }

  const printer = ts.createPrinter({ removeComments: false });
  const bodyText = printer.printNode(ts.EmitHint.Unspecified, newBody, sf);
  result.dispose();

  const isAsync = !!renderMethod.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const preamble = _buildPreamble(sf, filename);
  return (
    `/** @jsxImportSource @zerotal/flow */\n` +
    (preamble ? preamble + "\n\n" : "") +
    `export ${isAsync ? "async " : ""}function render() ${bodyText}\n`
  );
}

/**
 * Re-emit the page module's imports + top-level declarations so the compiled
 * render() (which lives in a separate file) resolves the same names. Relative
 * import specifiers are rewritten to absolute file:// URLs (location-independent);
 * package specifiers are kept as-is.
 */
function _buildPreamble(sf: ts.SourceFile, filename: string): string {
  const dir = path.dirname(filename);
  const out: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;
      const target = spec.startsWith(".") ? pathToFileURL(path.resolve(dir, spec)).href : spec;
      const clause = stmt.importClause ? stmt.importClause.getText() : "";
      out.push(
        clause
          ? `import ${clause} from ${JSON.stringify(target)};`
          : `import ${JSON.stringify(target)};`,
      );
      continue;
    }
    // Carry module-level declarations (consts, helpers, types) verbatim — they may be
    // referenced by the render body. The Component class itself is intentionally skipped.
    if (
      ts.isVariableStatement(stmt) ||
      ts.isFunctionDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      out.push(stmt.getText());
    }
  }
  return out.join("\n");
}

// ── AST finders ───────────────────────────────────────────────────────────────

function _findPageClass(sf: ts.SourceFile): ts.ClassDeclaration | null {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    const ext = stmt.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
    if (!ext) continue;
    for (const t of ext.types) {
      if (ts.isIdentifier(t.expression) && BASE_CLASSES.has(t.expression.text)) {
        return stmt;
      }
    }
  }
  return null;
}

function _findRenderMethod(cls: ts.ClassDeclaration): ts.MethodDeclaration | null {
  for (const m of cls.members) {
    if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === "render") return m;
  }
  return null;
}

// ── Member info extraction ────────────────────────────────────────────────────

interface MemberInfo {
  exposed: Set<string>; // @expose only — readable + writable from client
  locked: Set<string>; // @locked only — readable from client, not writable
  computed: Set<string>; // @computed getters — derived, NOT in the snapshot
  readable: Set<string>; // exposed ∪ locked — any prop in the snapshot (client-reactive)
}

/** Collect @expose, @locked, and @computed decorated members from the Component class AST. */
function _getMemberInfo(cls: ts.ClassDeclaration): MemberInfo {
  const exposed = new Set<string>();
  const locked = new Set<string>();
  const computed = new Set<string>();
  for (const member of cls.members) {
    // @computed sits on a getter (GetAccessorDeclaration); @expose/@locked on fields/methods.
    if (
      !ts.isPropertyDeclaration(member) &&
      !ts.isMethodDeclaration(member) &&
      !ts.isGetAccessorDeclaration(member)
    ) {
      continue;
    }
    if (!ts.isIdentifier(member.name)) continue;
    const name = member.name.text;
    const mods = member.modifiers ?? [];
    const has = (dec: string) =>
      mods.some(
        (m) => ts.isDecorator(m) && ts.isIdentifier(m.expression) && m.expression.text === dec,
      );
    if (has("expose")) exposed.add(name);
    if (has("locked")) locked.add(name);
    if (has("computed")) computed.add(name);
  }
  return { exposed, locked, computed, readable: new Set([...exposed, ...locked]) };
}

// ── this.xxx reference extraction (read vs write) ─────────────────────────────

interface ThisRef {
  name: string;
  isWrite: boolean;
}

/**
 * Walk an AST node and collect all direct `this.xxx` references,
 * flagging ones that are the immediate LHS of an assignment as writes.
 */
// ts.SyntaxKind.FirstAssignment / LastAssignment are @internal in TS 5.x
// and evaluate to undefined at runtime — enumerate assignment operators explicitly.
const ASSIGN_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
]);

function _extractThisRefs(node: ts.Node): ThisRef[] {
  const refs: ThisRef[] = [];

  function walk(n: ts.Node): void {
    // Binary assignment: this.x = val  /  this.x += val  /  etc.
    if (ts.isBinaryExpression(n) && ASSIGN_OPS.has(n.operatorToken.kind)) {
      if (_isThisProp(n.left)) {
        refs.push({ name: (n.left as ts.PropertyAccessExpression).name.text, isWrite: true });
      } else {
        walk(n.left);
      }
      walk(n.right);
      return;
    }
    // Prefix/postfix ++/--: ++this.x / this.x++
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken) &&
      _isThisProp(n.operand)
    ) {
      refs.push({ name: (n.operand as ts.PropertyAccessExpression).name.text, isWrite: true });
      return;
    }
    if (_isThisProp(n)) {
      refs.push({ name: (n as ts.PropertyAccessExpression).name.text, isWrite: false });
      return;
    }
    ts.forEachChild(n, walk);
  }

  walk(node);
  return refs;
}

/**
 * If `expr` is `flow(this.prop)` or `flow(this.prop).mod1.mod2`, returns the
 * inner `this.prop` PropertyAccessExpression.  Returns null for arrow-function
 * flow() targets, parametric modifiers like `.debounce('300ms')`, or any other
 * non-this-prop form.
 */
function _extractFlowProp(expr: ts.Expression): ts.PropertyAccessExpression | null {
  // Strip any trailing simple property-access modifiers (.prevent, .stop, .live, …)
  let node: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(node)) {
    node = node.expression;
  }
  // node must now be the bare flow(…) call
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "flow" ||
    node.arguments.length !== 1
  )
    return null;
  const arg = node.arguments[0]!;
  if (!_isThisProp(arg)) return null;
  return arg as ts.PropertyAccessExpression;
}

/**
 * Collect the simple modifier names from a `flow(this.prop).a.b.c` chain.
 * Returns [] for a bare `flow(this.prop)` call.
 * Only works for simple property-access modifiers; parametric forms like
 * `.debounce('300ms')` (a CallExpression) are not collected — those callers
 * should bail to the runtime.
 */
function _extractFlowModifiers(expr: ts.Expression): string[] {
  const modifiers: string[] = [];
  let node: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(node)) {
    modifiers.unshift(node.name.text);
    node = node.expression;
  }
  return modifiers;
}

/**
 * Unwrap flow() modifier chains to find the inner arrow function.
 * Handles: flow(arrow), flow(arrow).stop, flow(arrow).debounce('300ms'), etc.
 */
function _findFlowArrow(expr: ts.Expression): ts.ArrowFunction | null {
  if (ts.isCallExpression(expr)) {
    // flow(arrow) — direct call
    if (
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "flow" &&
      expr.arguments.length >= 1 &&
      ts.isArrowFunction(expr.arguments[0] as ts.Node)
    ) {
      return expr.arguments[0] as ts.ArrowFunction;
    }
    // flow(arrow).debounce('300ms') — parametric modifier call
    return _findFlowArrow(expr.expression);
  }
  // flow(arrow).stop / .prevent / etc. — property modifier access
  if (ts.isPropertyAccessExpression(expr)) {
    return _findFlowArrow(expr.expression);
  }
  return null;
}

// ── Validation error ──────────────────────────────────────────────────────────

/**
 * Thrown by the pre-compilation validation pass.
 * Unlike ordinary compile failures (which bail to runtime), this is FATAL —
 * the orchestrator rethrows it so the server refuses to start with invalid code.
 */
export class FlowValidationError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_PULSE_VALIDATION", 500);
    this.name = "FlowValidationError";
  }
}

// ── Pre-compilation validation pass ──────────────────────────────────────────
//
// Runs BEFORE AOT compilation so it fires even on pages the compiler bails on
// (ternaries, maps, sub-components, etc.). Scans all JSX attributes for
// flow(arrowFn) client callbacks and validates their this.xxx references.

function _validateArrowRefs(arrow: ts.ArrowFunction, members: MemberInfo, filename: string): void {
  for (const { name: ref, isWrite } of _extractThisRefs(arrow)) {
    // The dual real-method magics (this.refresh/dispatch/…) resolve on $flow at runtime —
    // exempt from the @expose/@locked rules below. Every other client magic now lives on
    // `$flow` (`$flow.$set`, `$flow.$store`, …), which carries no `this.` ref for the validator
    // to see, so it's naturally exempt — and a bare `this.set` is validated as the developer's
    // own member (their method if defined, else a clear error).
    if (CLIENT_CALLBACK_MAGICS.has(ref)) continue;

    if (isWrite) {
      if (members.locked.has(ref)) {
        throw new FlowValidationError(
          `[Flow] Cannot set @locked property "${ref}" from a client callback.\n` +
            `  Move the update into a server action instead.\n` +
            `  File: ${filename}`,
        );
      }
      if (!members.exposed.has(ref)) {
        throw new FlowValidationError(
          `[Flow] "${ref}" does not match any @expose — only @expose properties can be set from a client callback.\n` +
            `  File: ${filename}`,
        );
      }
    } else {
      if (!members.readable.has(ref)) {
        throw new FlowValidationError(
          `[Flow] "${ref}" does not match any @expose or @locked — it cannot be read in a client callback.\n` +
            `  File: ${filename}`,
        );
      }
    }
  }
}

function _validateFlowCallbacks(sf: ts.SourceFile, members: MemberInfo, filename: string): void {
  function scan(node: ts.Node): void {
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const expr = node.initializer.expression;
      const attrName = ts.isIdentifier(node.name) ? node.name.text : "";
      // flow(() => …) chains — validate the wrapped arrow.
      const flowArrow = _findFlowArrow(expr);
      if (flowArrow) {
        _validateArrowRefs(flowArrow, members, filename);
      } else if (attrName.startsWith("on") && ts.isArrowFunction(expr)) {
        // Bare client-handler arrow — onClick={(e) => this.x = 0}. Same safety rules:
        // its this.xxx refs must be @expose (writes) / @expose|@locked (reads).
        _validateArrowRefs(expr, members, filename);
      }
    }
    ts.forEachChild(node, scan);
  }
  scan(sf);
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * What stopped a page compiling, and where. Recorded at the first bail — the one
 * that actually caused the fallback; everything after it is fallout.
 */
export interface CompileBlocker {
  /** What the compiler found, e.g. "`<Demo>` is an imported component". */
  reason: string;
  /** What to change, e.g. "inline its markup". */
  fix: string;
  /** 1-based position of the construct in the source file. */
  line: number;
  column: number;
}

/** Mutable out-parameter: the compiler fills `blocker` in when it falls back. */
export interface BlockerReport {
  blocker?: CompileBlocker;
}

/** Locate `node` in its source file, 1-based, for a `file:line:column` reference. */
function _blockerAt(node: ts.Node, reason: string, fix: string): CompileBlocker {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { reason, fix, line: line + 1, column: character + 1 };
}

/** `app/pages/lists.tsx:83:10` — relative and slash-normalised, so terminals linkify it. */
function _at(filename: string, line: number, column: number): string {
  const rel = path.relative(process.cwd(), filename).split("\\").join("/");
  return `${rel || filename}:${line}:${column}`;
}

/** A short single-line excerpt of `node`'s source, so a message can quote what it found. */
function _snippet(node: ts.Node, max = 40): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The "what stops it compiling" section of a diagnostic: the recorded blocker
 * and where to look. Falls back to the common causes when the compiler bailed
 * somewhere that records nothing.
 */
export function describeBlocker(blocker: CompileBlocker | undefined, filename: string): string {
  if (!blocker) {
    return (
      `  What stops it compiling: could not be pinpointed. The usual causes are an imported\n` +
      `  component in render(), a computed class={…}, or a numeric attribute like rows={3}.\n`
    );
  }
  return (
    `  What stops it compiling:\n` +
    `  ${_at(filename, blocker.line, blocker.column)}  ${blocker.reason}\n` +
    `      → ${blocker.fix}\n`
  );
}

function _compileRenderMethod(
  method: ts.MethodDeclaration,
  filename: string,
  members: MemberInfo,
  report?: BlockerReport,
): string | null {
  let canCompile = true;

  /** Record the first blocker and stop compiling. */
  function bail(reason: string, fix: string, node: ts.Node): null {
    canCompile = false;
    if (report && !report.blocker) report.blocker = _blockerAt(node, reason, fix);
    return null;
  }

  if (!method.body) return bail("render() has no body", "give it a body that returns JSX", method);

  // The body must be: [zero or more non-return leading statements] then ONE top-level
  // return of JSX. Any other return anywhere (early returns / branching) → bail to runtime.
  const returns: ts.ReturnStatement[] = [];
  const countReturns = (n: ts.Node): void => {
    if (ts.isReturnStatement(n)) returns.push(n);
    ts.forEachChild(n, countReturns);
  };
  countReturns(method.body);
  if (returns.length !== 1) {
    return bail(
      `render() has ${returns.length} return statements; the compiler needs exactly one`,
      "fold the branching into the returned JSX (a ternary) or into a leading const",
      returns[1] ?? method,
    );
  }

  const stmts = method.body.statements;
  const returnIdx = stmts.findIndex((s) => ts.isReturnStatement(s));
  if (returnIdx === -1) {
    return bail(
      "render()'s only return is nested inside another block",
      "return the JSX from the top level of render()",
      returns[0] ?? method,
    );
  }
  const retStmt = stmts[returnIdx] as ts.ReturnStatement;
  if (!retStmt.expression) return bail("render() returns nothing", "return JSX", retStmt);

  // Leading statements (const/let computations etc.) carried verbatim — they run against
  // `this` and the carried module scope before the JSX is emitted.
  const leading = stmts
    .slice(0, returnIdx)
    .map((s) => s.getText())
    .join("\n  ");

  let returnExpr: ts.Expression = retStmt.expression;
  while (ts.isParenthesizedExpression(returnExpr)) returnExpr = returnExpr.expression;
  if (
    !ts.isJsxElement(returnExpr) &&
    !ts.isJsxFragment(returnExpr) &&
    !ts.isJsxSelfClosingElement(returnExpr)
  ) {
    return bail(
      "render() returns something other than a JSX element",
      "return the markup directly instead of a value computed from it",
      returnExpr,
    );
  }

  // Segment builder
  const parts: string[] = [];
  let staticBuf = "";

  function emitStatic(s: string): void {
    staticBuf += s;
  }

  function emitDynamic(expr: string): void {
    if (staticBuf) {
      parts.push(JSON.stringify(staticBuf));
      staticBuf = "";
    }
    parts.push(expr);
  }

  function flush(): void {
    if (staticBuf) {
      parts.push(JSON.stringify(staticBuf));
      staticBuf = "";
    }
  }

  /**
   * Run `run` against a fresh sub-buffer and return the JS string-expression it
   * produced (for embedding inside a ternary/&&/map branch), restoring the outer
   * buffer afterward. Returns null if the sub-render bailed.
   */
  function captureExpr(run: () => void): string | null {
    const outerParts = parts.slice();
    const outerBuf = staticBuf;
    parts.length = 0;
    staticBuf = "";
    run();
    let result: string | null = null;
    if (canCompile) {
      if (staticBuf) {
        parts.push(JSON.stringify(staticBuf));
        staticBuf = "";
      }
      result = parts.length ? parts.join(" + ") : '""';
    }
    parts.length = 0;
    for (const p of outerParts) parts.push(p);
    staticBuf = outerBuf;
    return result;
  }

  /**
   * Compile an expression in *value/child position* (a ternary/&&/map branch, a
   * map body, etc.) to a JS string-expression. Returns null to bail. The condition,
   * array and arrow params are emitted verbatim (they run server-side against `this`
   * + the carried module scope); nested JSX is compiled recursively.
   */
  function _compileValueExpr(raw: ts.Expression): string | null {
    let expr: ts.Expression = raw;
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;

    // Client magics are reactive client expressions, so they can't appear in a part that
    // this compiler emits to run on the SERVER (a ternary/&& condition, a .map() source, a
    // template literal, the general escaped-text fallback). They DO work when reached
    // recursively in an attribute value or text child of a nested JSX node (handled there).
    const _assertNoServerMagic = (node: ts.Node, where: string): void => {
      const m = _containsClientMagic(node);
      if (m) {
        throw new FlowValidationError(
          `[Flow] this.${m}(…) (a client-only magic) can't be used in ${where} — that runs on the ` +
            `server. Use it as an attribute value, a class/style expression, or a text child.\n` +
            `  File: ${filename}`,
        );
      }
    };

    if (ts.isJsxElement(expr) || ts.isJsxFragment(expr) || ts.isJsxSelfClosingElement(expr)) {
      return captureExpr(() => visitChild(expr as unknown as ts.JsxChild));
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
      return JSON.stringify(_escHtml(expr.text));
    if (ts.isNumericLiteral(expr)) return JSON.stringify(expr.text);
    if (expr.kind === ts.SyntaxKind.NullKeyword) return '""';
    if (ts.isIdentifier(expr) && expr.text === "undefined") return '""';
    if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword)
      return '""';

    if (_isThisProp(expr)) {
      const prop = (expr as ts.PropertyAccessExpression).name.text;
      if (!members.readable.has(prop)) return null;
      return `__esc(this.${prop})`;
    }

    // {cond ? A : B}
    if (ts.isConditionalExpression(expr)) {
      _assertNoServerMagic(expr.condition, "a ternary condition");
      const t = _compileValueExpr(expr.whenTrue);
      const f = _compileValueExpr(expr.whenFalse);
      if (t === null || f === null) return null;
      return `(${expr.condition.getText()} ? ${t} : ${f})`;
    }

    // {cond && A}
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      _assertNoServerMagic(expr.left, "an && condition");
      const r = _compileValueExpr(expr.right);
      if (r === null) return null;
      return `(${expr.left.getText()} ? ${r} : "")`;
    }

    // {arr.map((item, i) => <JSX>)}  /  {arr.map(item => { …; return <JSX>; })}
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "map" &&
      expr.arguments.length >= 1 &&
      (ts.isArrowFunction(expr.arguments[0]!) || ts.isFunctionExpression(expr.arguments[0]!))
    ) {
      const fn = expr.arguments[0] as ts.ArrowFunction | ts.FunctionExpression;
      _assertNoServerMagic(expr.expression.expression, "a .map() source");
      const arrText = expr.expression.expression.getText();
      const params = fn.parameters.map((p) => p.getText()).join(", ");
      let bodyExpr: string | null;
      if (ts.isBlock(fn.body)) {
        const last = fn.body.statements[fn.body.statements.length - 1];
        if (!last || !ts.isReturnStatement(last) || !last.expression) return null;
        const compiled = _compileValueExpr(last.expression);
        if (compiled === null) return null;
        const lead = fn.body.statements
          .slice(0, -1)
          .map((s) => s.getText())
          .join("\n");
        bodyExpr = lead ? `(() => { ${lead}\nreturn ${compiled}; })()` : compiled;
      } else {
        bodyExpr = _compileValueExpr(fn.body);
      }
      if (bodyExpr === null) return null;
      return `${arrText}.map((${params}) => ${bodyExpr}).join("")`;
    }

    // `Hi ${this.name}` — template literal: server-render the escaped string.
    if (ts.isTemplateExpression(expr)) {
      _assertNoServerMagic(expr, "a template literal");
      return `__esc(${expr.getText()})`;
    }

    // General value expression — identifier (local/param), member/element access,
    // arithmetic/comparison, unary — render as escaped text. Emitted verbatim so it
    // evaluates against `this` + carried module scope + enclosing map params.
    // CallExpressions are excluded: they may return an HtmlNode rather than a string.
    if (
      ts.isIdentifier(expr) ||
      ts.isPropertyAccessExpression(expr) ||
      ts.isElementAccessExpression(expr) ||
      ts.isBinaryExpression(expr) ||
      ts.isPrefixUnaryExpression(expr) ||
      ts.isPostfixUnaryExpression(expr)
    ) {
      _assertNoServerMagic(expr, "this position");
      return `__esc(${expr.getText()})`;
    }

    return null;
  }

  /**
   * True if every value in `node` comes from `this.<snapshot prop>` or the `$flow` client
   * runtime (`$flow.$store.*`, `$flow.count`) + literals/operators (no bare locals, calls, or
   * other roots) — i.e. it's safe to evaluate client-side against the reactive proxy.
   */
  function _isSnapshotOnly(node: ts.Node): boolean {
    let ok = true;
    const visit = (n: ts.Node): void => {
      if (!ok) return;
      if (ts.isPropertyAccessExpression(n)) {
        let root: ts.Expression = n.expression;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        // `$flow` client runtime root — `$flow.$store.ui.dark` — reactive on the client, allowed.
        if (ts.isIdentifier(root) && root.text === "$flow") return;
        if (root.kind !== ts.SyntaxKind.ThisKeyword) {
          ok = false;
          return;
        }
        let pa: ts.PropertyAccessExpression = n;
        while (ts.isPropertyAccessExpression(pa.expression)) pa = pa.expression;
        if (!members.readable.has(pa.name.text)) ok = false;
        return; // chain is all this.x.y — don't recurse
      }
      if (n.kind === ts.SyntaxKind.ThisKeyword) return;
      if (ts.isIdentifier(n)) {
        ok = false;
        return;
      } // bare local / import
      if (ts.isCallExpression(n) || ts.isElementAccessExpression(n)) {
        ok = false;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return ok;
  }

  // ── Visitors ─────────────────────────────────────────────────────────────

  function visitChildren(children: readonly ts.JsxChild[]): void {
    for (const c of children) visitChild(c);
  }

  function visitChild(node: ts.JsxChild): void {
    if (!canCompile) return;
    // A widened handle: the checks below narrow `node` to `never` by the end, and
    // the final bail still needs somewhere to point.
    const child: ts.Node = node;

    // ── Whitespace-only text node (between tags) ─────────────────────────
    if (ts.isJsxText(node)) {
      if (node.containsOnlyTriviaWhiteSpaces) return;
      // Normalise: collapse leading/trailing whitespace on lines, newlines → space
      const raw = node.text;
      const lines = raw.split("\n");
      const trimmed = lines
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
      if (trimmed) emitStatic(_escHtml(trimmed));
      return;
    }

    // ── JSX expression: {expr} ───────────────────────────────────────────
    if (ts.isJsxExpression(node)) {
      if (!node.expression) return; // {/* comment */}
      const expr = node.expression;

      // {' '} or {'literal'} — string literal
      if (ts.isStringLiteral(expr)) {
        emitStatic(_escHtml(expr.text));
        return;
      }

      // {this.propName}
      if (_isThisProp(expr)) {
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        // @computed getters aren't in the snapshot, but a text child renders a STATIC
        // server-evaluated value (`__esc`), not a reactive binding — so a derived getter
        // is fine here (it just updates on the next server patch, like any static read).
        if (!members.readable.has(prop) && !members.computed.has(prop)) {
          throw new FlowValidationError(
            `[Flow] {this.${prop}} — "${prop}" does not match any @expose, @locked, or @computed property.\n` +
              `  File: ${filename}`,
          );
        }
        emitDynamic(`__esc(this.${prop})`);
        return;
      }

      // {Number(this.x)} or {String(this.x)} — simple casts
      if (
        ts.isCallExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        (expr.expression.text === "Number" || expr.expression.text === "String") &&
        expr.arguments.length === 1 &&
        _isThisProp(expr.arguments[0]!)
      ) {
        const prop = (expr.arguments[0] as ts.PropertyAccessExpression).name.text;
        // @computed getters aren't in the snapshot, but a text child renders a STATIC
        // server-evaluated value (`__esc`), not a reactive binding — so a derived getter
        // is fine here (it just updates on the next server patch, like any static read).
        if (!members.readable.has(prop) && !members.computed.has(prop)) {
          throw new FlowValidationError(
            `[Flow] {this.${prop}} — "${prop}" does not match any @expose, @locked, or @computed property.\n` +
              `  File: ${filename}`,
          );
        }
        emitDynamic(`__esc(this.${prop})`);
        return;
      }

      // {this.currentUrl(...)} or {this.currentUrl() === "/" ? "a" : "b"} — a client-magic
      // read in text position (a pure value, no JSX). Emit a reactive flow:text span (a wrapper
      // so it composes with siblings); the bridge evaluates the $flow expression on hydration.
      // Magic-bearing expressions that contain JSX fall through to _compileValueExpr, which
      // throws (it can't be made reactive there).
      if (_containsClientMagic(expr) && !_containsJsx(expr)) {
        const src = _clientMagicSrc(expr, members, filename);
        _assertCspExpr(src, filename);
        emitStatic(`<span flow:text="${_escAttr(src)}"></span>`);
        return;
      }

      // {$flow.$store.ui.dark ? 'On' : 'Off'} — reads the `$flow` client runtime in text
      // position. Emit an Alpine-native x-text (reactive on the client, no round-trip). Any
      // mixed this.<prop> refs are rewritten to $flow.<prop> (also Alpine-reactive).
      if (_referencesGel(expr) && !_containsJsx(expr)) {
        const src = _clientMagicSrc(expr, members, filename);
        _assertCspExpr(src, filename);
        emitStatic(`<span x-text="${_escAttr(src)}"></span>`);
        return;
      }
      // {$flow.$store.x ? <A/> : <B/>} — a client value can't switch between JSX subtrees
      // (that needs client-side templating Flow doesn't do). Fail with guidance rather than
      // bake a client-only value into server-rendered HTML.
      if (_referencesGel(expr)) {
        throw new FlowValidationError(
          `[Flow] a \`$flow\` value can't select between JSX elements ({$flow.$store.x ? <A/> : <B/>}).\n` +
            `  Drive the DOM from it with a class / style / show binding or a text child instead,\n` +
            `  or switch on an @expose/@locked prop (this.x) for server-rendered branches.\n  File: ${filename}`,
        );
      }

      // Ternaries, &&, .map(), template literals → recursive sub-expression compile.
      const compiled = _compileValueExpr(expr);
      if (compiled !== null) {
        emitDynamic(compiled);
        return;
      }

      // Anything else — can't compile; fall back to the runtime renderer.
      bail(
        `\`{${_snippet(expr)}}\` is an expression the compiler can't render statically`,
        "compute it into a leading const, or move it behind an @expose prop",
        expr,
      );
      return;
    }

    if (ts.isJsxElement(node)) {
      visitElement(node);
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      visitSelfClosing(node);
      return;
    }
    if (ts.isJsxFragment(node)) {
      visitChildren(node.children);
      return;
    }

    bail(
      `an unsupported ${ts.SyntaxKind[child.kind]} node in the markup`,
      "rewrite it as plain JSX",
      child,
    );
  }

  /**
   * Compile `<ErrorMessage for={this.field} class="…" />` to a reactive, self-hiding
   * `<span flow:error="field" flow:show="errors.field">`. `for` (preferred) or the legacy `name`
   * accepts `this.field`, `this.errors.field`, or a literal field name. Falls back to runtime
   * (bail) for anything it can't statically resolve.
   */
  function emitErrorMessage(attrs: ts.JsxAttributes): void {
    let field: string | null = null;
    let cls = "text-red-400 text-xs";
    let extra = "";

    for (const attr of attrs.properties) {
      if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) {
        bail(
          "<ErrorMessage> has a spread or computed attribute",
          "write its attributes out by name",
          attr,
        );
        return;
      }
      const name = attr.name.text;
      const init = attr.initializer;

      if (name === "for" || name === "name") {
        if (init && ts.isStringLiteral(init)) {
          field = init.text;
          continue;
        }
        if (init && ts.isJsxExpression(init) && init.expression) {
          const e = init.expression;
          // this.errors.<field>
          if (
            ts.isPropertyAccessExpression(e) &&
            ts.isPropertyAccessExpression(e.expression) &&
            e.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
            e.expression.name.text === "errors"
          ) {
            field = e.name.text;
            continue;
          }
          // this.<field>
          if (_isThisProp(e)) {
            const prop = e.name.text;
            if (!members.readable.has(prop)) {
              throw new FlowValidationError(
                `[Flow] <ErrorMessage for={this.${prop}} /> — "${prop}" is not an @expose or @locked property.\n` +
                  `  File: ${filename}`,
              );
            }
            field = prop;
            continue;
          }
        }
        bail(
          `<ErrorMessage ${name}={…}> names a field the compiler can't resolve`,
          `write ${name}="fieldName", or ${name}={this.fieldName}`,
          attr,
        );
        return;
      }

      if (name === "class" || name === "className") {
        if (init && ts.isStringLiteral(init)) {
          cls = init.text;
          continue;
        }
        // dynamic class → let the runtime component render it
        bail("<ErrorMessage> has a computed class", "inline the class as a string literal", attr);
        return;
      }

      // Forward other plain static attributes (id, data-*, etc.).
      if (init === undefined) {
        extra += ` ${name}`;
        continue;
      }
      if (ts.isStringLiteral(init)) {
        extra += ` ${name}="${_escAttr(init.text)}"`;
        continue;
      }
      bail(
        `<ErrorMessage ${name}={…}> is not a static value`,
        `write ${name}="…" as a string literal`,
        attr,
      );
      return;
    }

    if (!field) {
      bail(
        "<ErrorMessage> has no `for` field",
        'add for="fieldName" (or for={this.fieldName})',
        attrs,
      );
      return;
    }
    emitStatic(
      `<span flow:error="${field}" flow:show="errors.${field}" class="${_escAttr(cls)}"${extra}></span>`,
    );
  }

  function visitElement(node: ts.JsxElement): void {
    const tag = _tagName(node.openingElement.tagName);
    if (tag === "ErrorMessage") {
      emitErrorMessage(node.openingElement.attributes);
      return;
    }
    // <For each={this.items} keyBy="id">{(item) => <JSX>}</For> — a reactive list. Compiles to an
    // Alpine <template x-for>, so appendOptimistic/removeOptimistic (and any client update to the
    // array) re-render it instantly, while server patches keep it authoritative.
    if (tag === "For") {
      emitStatic(_compileFor(node));
      return;
    }
    // <Link href hover current> — the Flow SPA-nav anchor. Compiles to
    // <a flow:navigate …> (see _visitAttrs link mode) instead of bailing.
    if (tag === "Link") {
      emitStatic("<a");
      _visitAttrs(node.openingElement.attributes, true);
      if (!canCompile) return;
      emitStatic(">");
      visitChildren(node.children);
      emitStatic("</a>");
      return;
    }
    if (!tag || _isComponent(tag)) {
      bail(
        `\`<${tag ?? "?"}>\` is a component, not an HTML element`,
        "inline its markup here, or let this page render through the runtime",
        node.openingElement.tagName,
      );
      return;
    }

    emitStatic(`<${tag}`);
    const textProp = _visitAttrs(node.openingElement.attributes);
    if (!canCompile) return;
    emitStatic(">");

    if (textProp !== null) {
      // text={this.x} overrides all children
      emitDynamic(`__esc(this.${textProp})`);
    } else {
      visitChildren(node.children);
    }

    emitStatic(`</${tag}>`);
  }

  function visitSelfClosing(node: ts.JsxSelfClosingElement): void {
    const tag = _tagName(node.tagName);
    if (tag === "ErrorMessage") {
      emitErrorMessage(node.attributes);
      return;
    }
    // <Link href … /> — SPA-nav anchor with no children. → <a flow:navigate …></a>
    if (tag === "Link") {
      emitStatic("<a");
      _visitAttrs(node.attributes, true);
      if (!canCompile) return;
      emitStatic("></a>");
      return;
    }
    if (!tag || _isComponent(tag)) {
      bail(
        `\`<${tag ?? "?"} />\` is a component, not an HTML element`,
        "inline its markup here, or let this page render through the runtime",
        node.tagName,
      );
      return;
    }

    emitStatic(`<${tag}`);
    const textProp = _visitAttrs(node.attributes);
    if (!canCompile) return;

    if (VOID_ELEMENTS.has(tag)) {
      emitStatic(">");
    } else {
      emitStatic(">");
      if (textProp !== null) emitDynamic(`__esc(this.${textProp})`);
      emitStatic(`</${tag}>`);
    }
  }

  // ── <For> reactive list → Alpine <template x-for> ─────────────────────────────

  function _forError(node: ts.Node, msg: string): never {
    void node;
    throw new FlowValidationError(
      `[Flow] <For>: ${msg}\n` +
        `  Shape: <For each={this.arrayProp} keyBy="idField">{(item) => <li>…</li>}</For>.\n` +
        `  Item templates support element structure, static attrs, class/className, reactive attrs,\n` +
        `  on* arrow handlers, and {item.field} text. For anything else, drop to a raw Alpine\n` +
        `  <template x-for="item in $flow.arrayProp"> escape hatch.\n  File: ${filename}`,
    );
  }

  const _rewriteThis = _rewriteClientExpr;

  /** Compile one attribute of a <For> item element to an Alpine directive (x-for scope). */
  function _compileItemAttr(a: ts.JsxAttributeLike): string {
    if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name)) {
      _forError(a, "unsupported attribute in a <For> item");
    }
    const attr = a as ts.JsxAttribute;
    const name = attr.name.getText();
    if (name === "key") return ""; // consumed by the <template> :key
    const init = attr.initializer;
    if (init === undefined) return ` ${name}`; // boolean attribute
    if (ts.isStringLiteral(init)) return ` ${name}="${_escAttr(init.text)}"`;
    if (!ts.isJsxExpression(init) || !init.expression) return "";
    const expr = init.expression;
    const event = name.startsWith("on") && name.length > 2 ? name.slice(2).toLowerCase() : null;
    if (event) {
      // Alpine @event — evaluated in the x-for scope (loop var + $flow). Unwrap arrow handlers to
      // their body (a bare `() => expr` would otherwise never fire).
      if (ts.isArrowFunction(expr)) {
        if (ts.isBlock(expr.body)) {
          _forError(
            a,
            "block-body arrow handlers aren't supported in a <For> item — use one expression",
          );
        }
        return ` @${event}="${_escAttr(_rewriteThis(expr.body.getText()))}"`;
      }
      return ` @${event}="${_escAttr(_rewriteThis(expr.getText()))}"`;
    }
    // class/className → :class; any other value expr → reactive :attr.
    const alpine = name === "className" ? "class" : name;
    return ` :${alpine}="${_escAttr(_rewriteThis(expr.getText()))}"`;
  }

  /** Compile one node of a <For> item template to Alpine-directive HTML. */
  function _compileItemNode(node: ts.Node): string {
    if (ts.isJsxText(node)) {
      return node.text.trim() ? _escHtml(node.text) : "";
    }
    if (ts.isJsxExpression(node)) {
      return node.expression
        ? `<span x-text="${_escAttr(_rewriteThis(node.expression.getText()))}"></span>`
        : "";
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = _tagName(opening.tagName);
      if (!tag || _isComponent(tag)) {
        _forError(node, `nested component <${tag}> isn't supported in a <For> item`);
      }
      let attrsHtml = "";
      for (const a of opening.attributes.properties) attrsHtml += _compileItemAttr(a);

      if (ts.isJsxSelfClosingElement(node)) {
        return VOID_ELEMENTS.has(tag) ? `<${tag}${attrsHtml}>` : `<${tag}${attrsHtml}></${tag}>`;
      }
      // A single `{item.field}` child → x-text on the element (cleaner than a wrapper span).
      const meaningful = node.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
      if (
        meaningful.length === 1 &&
        ts.isJsxExpression(meaningful[0]!) &&
        meaningful[0]!.expression
      ) {
        const src = _rewriteThis((meaningful[0] as ts.JsxExpression).expression!.getText());
        return `<${tag}${attrsHtml} x-text="${_escAttr(src)}"></${tag}>`;
      }
      const inner = node.children.map(_compileItemNode).join("");
      return `<${tag}${attrsHtml}>${inner}</${tag}>`;
    }
    return "";
  }

  function _compileFor(node: ts.JsxElement): string {
    let eachProp: string | null = null;
    let keyBy: string | null = null;
    for (const a of node.openingElement.attributes.properties) {
      if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name))
        _forError(node, "unsupported <For> attribute");
      const n = (a as ts.JsxAttribute).name.getText();
      const init = (a as ts.JsxAttribute).initializer;
      if (n === "each") {
        if (init && ts.isJsxExpression(init) && init.expression && _isThisProp(init.expression)) {
          eachProp = (init.expression as ts.PropertyAccessExpression).name.text;
        } else _forError(node, "each must be {this.<arrayProp>}");
      } else if (n === "keyBy") {
        const lit =
          init && ts.isStringLiteral(init)
            ? init.text
            : init &&
                ts.isJsxExpression(init) &&
                init.expression &&
                ts.isStringLiteral(init.expression)
              ? init.expression.text
              : null;
        if (lit === null) _forError(node, 'keyBy must be a string field name, e.g. keyBy="id"');
        keyBy = lit;
      } else {
        _forError(node, `unsupported <For> attribute "${n}"`);
      }
    }
    if (!eachProp) _forError(node, "needs each={this.<arrayProp>}");

    const exprChild = node.children.find((c) => ts.isJsxExpression(c) && c.expression);
    const arrow = exprChild && ts.isJsxExpression(exprChild) ? exprChild.expression : undefined;
    if (!arrow || !ts.isArrowFunction(arrow) || arrow.parameters.length < 1) {
      _forError(node, "child must be an arrow: {(item) => <JSX>}");
    }
    const varName = arrow.parameters[0]!.name.getText();
    const body = ts.isParenthesizedExpression(arrow.body) ? arrow.body.expression : arrow.body;
    let itemHtml: string;
    if (ts.isJsxFragment(body)) itemHtml = body.children.map(_compileItemNode).join("");
    else if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body))
      itemHtml = _compileItemNode(body);
    else return _forError(node, "the item arrow must return a JSX element");

    const keyAttr = keyBy ? ` :key="${_escAttr(`${varName}.${keyBy}`)}"` : "";
    return `<template x-for="${_escAttr(`${varName} in $flow.${eachProp}`)}"${keyAttr}>${itemHtml}</template>`;
  }

  /**
   * Process all attributes on an element, emitting static/dynamic parts.
   * Returns the prop name of a `text={this.x}` attribute (if found),
   * so the caller can inject the current value as element children.
   * Returns null when no `text` prop is present.
   * Sets canCompile=false and returns null early on unsupported patterns.
   */
  function _visitAttrs(attrs: ts.JsxAttributes, link = false): string | null {
    let textProp: string | null = null;

    // <Link> → <a flow:navigate>: the navigate directive is always present; `hover`
    // and `current` are translated to their flow: directives in the loop below.
    if (link) emitStatic(" flow:navigate");

    // Sync-timing modifiers for the input binding (sibling boolean attrs: live / blur).
    const _hasBoolAttr = (n: string) =>
      attrs.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          ts.isIdentifier(a.name) &&
          a.name.text === n &&
          a.initializer === undefined,
      );
    const modelMod = _hasBoolAttr("blur") ? ".blur" : _hasBoolAttr("live") ? ".live" : "";
    // `number` / `trim` input modifiers → data-flow-* markers the bridge reads when coercing the
    // value (client-side data hygiene, so the server sees a real number / trimmed string).
    const modelExtra =
      (_hasBoolAttr("number") ? " data-flow-number" : "") +
      (_hasBoolAttr("trim") ? " data-flow-trim" : "");

    // The `transition` preset on this element (fade when bare / no string), else null.
    const _transitionPreset = (): string | null => {
      for (const a of attrs.properties) {
        if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || a.name.text !== "transition")
          continue;
        const i = a.initializer;
        if (i === undefined) return "fade";
        if (ts.isStringLiteral(i)) return i.text || "fade";
        if (ts.isJsxExpression(i) && i.expression && ts.isStringLiteral(i.expression))
          return i.expression.text || "fade";
        return "fade";
      }
      return null;
    };
    /** True if this element has a `show=` prop at all. When paired with `transition`, the show is
     *  driven by Alpine `x-show` + Alpine's real `x-transition` engine (see _emitShowTransition),
     *  so the `transition` prop must NOT also emit a bare `flow:transition` (which is morph-enter). */
    const _hasShowAttr = (): boolean =>
      attrs.properties.some(
        (a) => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === "show",
      );

    /** Alpine class-based x-transition directives for a `show=` element, reusing the shared
     *  `flow-t-<preset>` CSS (the preset class carries the transition timing AND the hidden state
     *  via `.flow-t-<preset>.flow-t-out`). Alpine owns the enter/leave lifecycle — no custom JS. */
    const _emitShowTransition = (preset: string): string =>
      ` x-transition:enter="flow-t-${preset}" x-transition:enter-start="flow-t-out"` +
      ` x-transition:leave="flow-t-${preset}" x-transition:leave-end="flow-t-out"`;

    for (const attr of attrs.properties) {
      if (!canCompile) return null;

      // <Link> prop translations (link mode only).
      if (link && ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name)) {
        const ln = attr.name.text;
        if (ln === "hover" && attr.initializer === undefined) {
          emitStatic(" flow:navigate.hover");
          continue;
        }
        if (ln === "current") {
          const ci = attr.initializer;
          // current={false} → opt out of the auto active class; current={true} → default (skip).
          if (ci && ts.isJsxExpression(ci) && ci.expression?.kind === ts.SyntaxKind.FalseKeyword) {
            emitStatic(" flow:current.ignore");
            continue;
          }
          if (ci && ts.isJsxExpression(ci) && ci.expression?.kind === ts.SyntaxKind.TrueKeyword) {
            continue;
          }
          // current="active-class" → falls through to STRING_DIRECTIVES (current → flow:current).
        }
      }

      // Spread: {...foo} — can't compile
      if (ts.isJsxSpreadAttribute(attr)) {
        return bail(
          `\`{...${_snippet(attr.expression, 20)}}\` spreads attributes`,
          "write the attributes out by name",
          attr,
        );
      }
      if (!ts.isJsxAttribute(attr)) {
        return bail("an attribute the compiler can't read", 'write it as `name="value"`', attr);
      }

      const name = ts.isIdentifier(attr.name) ? attr.name.text : null;
      if (!name) {
        return bail("an attribute with a namespaced name", "use a plain attribute name", attr.name);
      }

      const init = attr.initializer;

      // `transition` on a `show=` element is animated by Alpine's x-transition (emitted with the
      // show binding), so skip the flow:transition emission here (that's the morph-enter feature,
      // for `transition` WITHOUT `show=`).
      if (name === "transition" && _hasShowAttr()) continue;

      // ── Boolean attributes (no value) ──────────────────────────────
      if (init === undefined) {
        // live / blur are input-binding modifiers consumed by value/checked — never emitted.
        if (name === "live" || name === "blur" || name === "number" || name === "trim") continue;
        if (name in BOOLEAN_DIRECTIVES) {
          emitStatic(` ${BOOLEAN_DIRECTIVES[name]}`);
        } else {
          emitStatic(` ${name}`);
        }
        continue;
      }

      // ── String literal value ───────────────────────────────────────
      if (ts.isStringLiteral(init)) {
        const htmlName = ATTR_RENAMES[name] ?? STRING_DIRECTIVES[name] ?? name;
        emitStatic(` ${htmlName}="${_escAttr(init.text)}"`);
        continue;
      }

      // ── Expression value ──────────────────────────────────────────
      if (!ts.isJsxExpression(init) || !init.expression) continue;
      const expr = init.expression;

      // text={this.x} — directive + dynamic child injection
      if (name === "text") {
        // text={$flow.store.ui.dark ? "…" : "…"} — a client-reactive value. flow:text reads the
        // component snapshot, which the store isn't part of, so emit Alpine-native x-text. The
        // element's literal children stay as the server-rendered fallback until Alpine swaps them.
        if (_referencesGel(expr) || _containsClientMagic(expr)) {
          const src = _clientMagicSrc(expr, members, filename);
          _assertCspExpr(src, filename);
          emitStatic(` x-text="${_escAttr(src)}"`);
          continue;
        }
        if (!_isThisProp(expr)) {
          return bail(
            `\`text={${_snippet(expr, 24)}}\` is not a \`this.<prop>\` read`,
            "bind text to an @expose or @locked property",
            attr,
          );
        }
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        if (!members.readable.has(prop)) {
          const hint = members.computed.has(prop)
            ? ` "${prop}" is @computed — it isn't in the snapshot, so it can't be bound reactively. ` +
              `Use {this.${prop}} for a static value, or make it @expose.`
            : "";
          throw new FlowValidationError(
            `[Flow] text={this.${prop}} — "${prop}" does not match any @expose or @locked property.${hint}\n` +
              `  File: ${filename}`,
          );
        }
        emitStatic(` flow:text="${prop}"`);
        textProp = prop;
        continue;
      }

      // error={this.errors.field} — validation message binding (flow:error + flow:show).
      if (
        name === "error" &&
        ts.isPropertyAccessExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        expr.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        expr.expression.name.text === "errors"
      ) {
        const field = expr.name.text;
        emitStatic(` flow:error="${field}" flow:show="errors.${field}"`);
        // SSR initial message is injected as a text child at render; keep it simple
        // (the field's first message is rendered client-side reactively via flow:show).
        continue;
      }

      // onClick={this.method} / onClick={(e) => this.x = 0} / onSubmit={flow(this.method).prevent}
      // Bare `submit={…}` on a <form> is a recognised shorthand for onSubmit (→ flow:submit).
      const eventName =
        name.startsWith("on") && name.length > 2
          ? name.slice(2).toLowerCase()
          : name === "submit"
            ? "submit"
            : null;
      if (eventName !== null) {
        const event = eventName;
        // onClick={this.method} — server action (named method reference).
        if (_isThisProp(expr)) {
          emitStatic(` flow:${event}="${(expr as ts.PropertyAccessExpression).name.text}"`);
          continue;
        }
        // onClick={(e) => this.x = 0} — bare arrow → client expression, emitted verbatim
        // (this.→$flow.); the bridge auto-invokes it with the event. Handlers stay on the flow:*
        // form for consistency with the rest of the directive surface (loading/confirm/dirty all
        // key off it). The <For> path below is the one exception — a loop handler must be an
        // Alpine `@event`, because the loop variable only exists in Alpine's x-for scope.
        if (ts.isArrowFunction(expr)) {
          if (_cspSafe) {
            // CSP-safe: emit the bare expression body (no arrow wrapper). An event
            // param or a block body has no CSP-safe inline form → compile error.
            if (expr.parameters.length > 0) {
              throw new FlowValidationError(
                `[Flow CSP] onClick={(e) => …} can't access the event in CSP-safe mode.\n` +
                  `  Move it to an @expose action (onClick={this.method}).\n  File: ${filename}`,
              );
            }
            if (!ts.isExpression(expr.body)) {
              throw new FlowValidationError(
                `[Flow CSP] block-body arrows (() => { … }) aren't allowed in CSP-safe mode.\n` +
                  `  Use a single expression or an @expose action.\n  File: ${filename}`,
              );
            }
            const body = _rewriteClientExpr(expr.body.getText());
            _assertCspExpr(body, filename);
            emitStatic(` flow:${event}="${_escAttr(body)}"`);
            continue;
          }
          const src = _rewriteClientExpr(expr.getText());
          emitStatic(` flow:${event}="${_escAttr(src)}"`);
          continue;
        }
        // flow(() => …) with modifiers — let the runtime emit it (rare); bail this page.
        if (_findFlowArrow(expr)) {
          return bail(
            `\`${name}={flow(() => …)}\` carries modifiers the compiler can't emit`,
            "call the handler directly, or use flow(this.method) with modifiers",
            attr,
          );
        }
        // flow(this.method) / flow(this.method).mod1.mod2 — server action with modifiers.
        const flowPropExpr = _extractFlowProp(expr);
        if (flowPropExpr) {
          const method = flowPropExpr.name.text;
          const mods = _extractFlowModifiers(expr);
          const base = `flow:${event}`;
          emitStatic(` ${mods.length ? `${base}.${mods.join(".")}` : base}="${method}"`);
          continue;
        }
        // Non-this, non-flow ref — skip silently.
        continue;
      }

      // show={$flow.$store.ui.open} / show={this.currentUrl() === "/"} — visibility driven by a
      // client-reactive value. Emit Alpine-native x-show (NOT flow:show, which only re-runs on
      // server patches), so it toggles instantly on the client. `show={this.prop}` still takes
      // the flow:show path below (server-owned boolean).
      if (
        name === "show" &&
        !_isThisProp(expr) &&
        (_referencesGel(expr) || _containsClientMagic(expr))
      ) {
        const src = _clientMagicSrc(expr, members, filename);
        _assertCspExpr(src, filename);
        emitStatic(` x-show="${_escAttr(src)}"`);
        const preset = _transitionPreset();
        if (preset) emitStatic(_emitShowTransition(preset));
        continue;
      }

      // className={this.currentUrl() === "/" ? "on" : ""} / class={$flow.$store.ui.dark ? "dark" : ""}
      // — any attribute expression that references a client magic OR the `$flow` runtime compiles
      // to a reactive Alpine binding (:attr) with this.→$flow. ($flow left as-is), so it
      // re-evaluates client-side. Checked before the value/checked/class handlers so such an
      // expression isn't bailed.
      if (_containsClientMagic(expr) || _referencesGel(expr)) {
        const src = _clientMagicSrc(expr, members, filename);
        _assertCspExpr(src, filename);
        const htmlName = ATTR_RENAMES[name] ?? name;
        emitStatic(` :${htmlName}="${_escAttr(src)}"`);
        continue;
      }

      // value={this.form.field} — nested binding for Form objects. The root (e.g.
      // `form`) must be an @expose prop; emits flow:model="form.field" so the client
      // edits the nested field and the server fills the Form on the round-trip.
      if (
        (name === "value" || name === "checked") &&
        ts.isPropertyAccessExpression(expr) &&
        _isThisProp(expr.expression)
      ) {
        const root = (expr.expression as ts.PropertyAccessExpression).name.text;
        const field = expr.name.text;
        if (members.exposed.has(root) && !members.locked.has(root)) {
          if (name === "value") {
            emitStatic(` flow:model${modelMod}="${root}.${field}"${modelExtra} value="`);
            emitDynamic(`__escAttr(this.${root}.${field})`);
            emitStatic('"');
          } else {
            emitStatic(` flow:model${modelMod}="${root}.${field}"${modelExtra}`);
          }
          continue;
        }
      }

      // value={this.x} / checked={this.x} — the input binding (replaces `bind`).
      // @expose → two-way (flow:model); @locked → reactive read-only (:value + readonly).
      if ((name === "value" || name === "checked") && _isThisProp(expr)) {
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        if (members.exposed.has(prop)) {
          if (name === "value") {
            emitStatic(` flow:model${modelMod}="${prop}"${modelExtra} value="`);
            emitDynamic(`__escAttr(this.${prop})`);
            emitStatic('"');
          } else {
            emitStatic(` flow:model${modelMod}="${prop}"${modelExtra}`); // bridge syncs checkbox .checked from state
          }
          continue;
        }
        if (members.locked.has(prop)) {
          if (name === "value") {
            emitStatic(` :value="$flow.${prop}" readonly value="`);
            emitDynamic(`__escAttr(this.${prop})`);
            emitStatic('"');
          } else {
            emitStatic(` :checked="$flow.${prop}" disabled`);
          }
          continue;
        }
        // Not a snapshot prop → fall through to the generic server-rendered value.
      }

      // poll={{ every: '1s', action: this.method, keepAlive?: true, visible?: true }}
      if (name === "poll" && ts.isObjectLiteralExpression(expr)) {
        let every = "";
        let keepAlive = false;
        let visible = false;
        let actionMethod = "$refresh";
        for (const prop of expr.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = ts.isIdentifier(prop.name) ? prop.name.text : "";
          const val = prop.initializer;
          if (key === "every" && ts.isStringLiteral(val)) every = val.text;
          else if (key === "action" && _isThisProp(val))
            actionMethod = (val as ts.PropertyAccessExpression).name.text;
          else if (key === "keepAlive" && val.kind === ts.SyntaxKind.TrueKeyword) keepAlive = true;
          else if (key === "visible" && val.kind === ts.SyntaxKind.TrueKeyword) visible = true;
        }
        let attrName = "flow:poll";
        if (every) attrName += `.${every}`;
        if (keepAlive) attrName += ".keep-alive";
        if (visible) attrName += ".visible";
        emitStatic(` ${attrName}="${actionMethod}"`);
        continue;
      }

      // show={this.prop} transition — animate via Alpine's real x-transition engine. The prop is
      // reactive on the client (`$flow.prop` reads comp.reactive[prop]), so x-show + x-transition
      // handles both visibility and enter/leave natively; no bridge flow:show / custom animator.
      // Plain show={this.prop} (no transition) stays on flow:show for full bridge integration
      // (modal Escape, showImportant, server-patch sync).
      if (name === "show" && _isThisProp(expr)) {
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        if (!members.readable.has(prop)) {
          throw new FlowValidationError(
            `[Flow] show={this.${prop}} — "${prop}" does not match any @expose or @locked property.\n` +
              `  File: ${filename}`,
          );
        }
        const preset = _transitionPreset();
        if (preset) {
          emitStatic(` x-show="$flow.${prop}"` + _emitShowTransition(preset));
        } else {
          emitStatic(` flow:show="${prop}"`);
        }
        continue;
      }

      // show={this.x} — simple this-prop expression directives
      if (name in STRING_DIRECTIVES && _isThisProp(expr)) {
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        if (!members.readable.has(prop)) {
          throw new FlowValidationError(
            `[Flow] ${name}={this.${prop}} — "${prop}" does not match any @expose or @locked property.\n` +
              `  File: ${filename}`,
          );
        }
        emitStatic(` ${STRING_DIRECTIVES[name]}="${prop}"`);
        continue;
      }

      // class={`base ${this.x ? 'a' : 'b'}`} — reactive class (Workstream G). When a
      // template literal's substitutions reference only snapshot props, split the literal
      // parts into a static `class` and the dynamic parts into Alpine's `:class` array, so
      // the class updates client-side with no round-trip. Decomposition (static vs dynamic)
      // avoids Alpine's class-merge duplication (static base never overlaps computed values).
      if (
        (name === "class" || name === "className") &&
        ts.isTemplateExpression(expr) &&
        _isSnapshotOnly(expr)
      ) {
        const staticParts: string[] = [];
        const dynamic: string[] = [];
        if (expr.head.text) staticParts.push(expr.head.text);
        for (const span of expr.templateSpans) {
          const part = _rewriteClientExpr(span.expression.getText());
          _assertCspExpr(part, filename); // CSP: substitutions must be subset-safe (no nested `…`/=>)
          dynamic.push(part);
          if (span.literal.text) staticParts.push(span.literal.text);
        }
        const staticClass = staticParts.join(" ").split(/\s+/).filter(Boolean).join(" ");
        if (staticClass) emitStatic(` class="${_escAttr(staticClass)}"`);
        emitStatic(` :class="${_escAttr(`[${dynamic.join(", ")}]`)}"`);
        continue;
      }

      // class={['base', cond && 'extra']} / class={this.x} — not statically decomposable → runtime.
      if (name === "class" || name === "className") {
        return bail(
          `\`${name}={${_snippet(expr, 28)}}\` is not a static class string`,
          "inline the classes as a string literal, or build them in a template literal",
          attr,
        );
      }

      // style={{ ... }} object — can't compile
      if (name === "style") {
        return bail(
          "`style={{ … }}` is an object literal",
          'write style="…" as a string, or move it into a class',
          attr,
        );
      }

      // Boolean true/false literal
      if (expr.kind === ts.SyntaxKind.TrueKeyword) {
        emitStatic(` ${name}`);
        continue;
      }
      if (expr.kind === ts.SyntaxKind.FalseKeyword) {
        // false → omit attribute
        continue;
      }

      // This-prop for arbitrary attributes (e.g. value={this.x})
      if (_isThisProp(expr)) {
        const prop = (expr as ts.PropertyAccessExpression).name.text;
        if (!members.readable.has(prop)) {
          throw new FlowValidationError(
            `[Flow] ${name}={this.${prop}} — "${prop}" does not match any @expose or @locked property.\n` +
              `  File: ${filename}`,
          );
        }
        const htmlName = ATTR_RENAMES[name] ?? name;
        emitStatic(` ${htmlName}="`);
        emitDynamic(`__escAttr(this.${prop})`);
        emitStatic('"');
        continue;
      }

      // Anything else (flow() chains, ternaries, etc.) — can't compile
      return bail(
        ts.isNumericLiteral(expr)
          ? `\`${name}={${expr.text}}\` is a numeric literal`
          : `\`${name}={${_snippet(expr, 28)}}\` is not a static value`,
        ts.isNumericLiteral(expr)
          ? `write ${name}="${expr.text}"`
          : `use a string literal, or bind it to an @expose property (${name}={this.x})`,
        attr,
      );
    }

    return textProp;
  }

  // ── Kick off ──────────────────────────────────────────────────────────────
  visitChild(returnExpr as unknown as ts.JsxChild);
  if (!canCompile) return null;
  flush();
  if (parts.length === 0) {
    return bail("render() produced no markup", "return the page's JSX", returnExpr);
  }

  const htmlExpr = parts.join(" + ");
  const body = `  return { html: ${htmlExpr} };`;
  return leading ? `  ${leading}\n${body}` : body;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isThisProp(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword;
}

/**
 * If `expr` references a client magic anywhere — `this.currentUrl(…)` /
 * `this.navigateCurrent(…)`, whether the whole value or nested in a larger
 * expression (`this.currentUrl() === "/" ? "on" : ""`) — return the magic name;
 * otherwise null. Such an expression compiles to a reactive client binding.
 */
function _containsClientMagic(node: ts.Node): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ThisKeyword &&
      CLIENT_MAGICS.has(n.name.text)
    ) {
      found = n.name.text;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * True if `node` reads the `$flow` client runtime object (`$flow.$store.ui.dark`,
 * `$flow.count`, `$flow.$parent.save()`) anywhere — used to route the expression to an
 * Alpine-native reactive binding (x-text / :attr / :class / x-show) so it updates on the
 * client with NO server round-trip. Matches `$flow` only as an access ROOT, never a property
 * name. `$flow` is written directly (it IS the runtime object), so it needs no rewrite.
 */
function _referencesGel(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === "$flow") {
      const p = n.parent;
      // Skip when `$flow` is the member NAME (`obj.$flow`), not the object root.
      if (!(p && ts.isPropertyAccessExpression(p) && p.name === n)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** True if `node` contains any JSX element/fragment (so it isn't a pure value expression). */
function _containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Build the client text for a client-reactive expression — one that references a client
 * magic (`this.currentUrl()`) and/or the `$flow` runtime (`$flow.store.ui.dark`). Applies the
 * AOT client rewrite (bare `$flow.<magic>`→`$flow.$<magic>`, then `this.`→`$flow.`) after
 * validating that any non-magic `this.x` it references is a readable (@expose/@locked) prop —
 * else `$flow.x` would resolve to a server-action stub at runtime.
 */
function _clientMagicSrc(expr: ts.Expression, members: MemberInfo, filename: string): string {
  for (const { name: ref } of _extractThisRefs(expr)) {
    if (CLIENT_MAGICS.has(ref)) continue;
    if (!members.readable.has(ref)) {
      throw new FlowValidationError(
        `[Flow] a client-reactive expression references this.${ref}, which is not an @expose or @locked property.\n` +
          `  File: ${filename}`,
      );
    }
  }
  return _rewriteClientExpr(expr.getText());
}

function _isComponent(tag: string): boolean {
  const c = tag.charCodeAt(0);
  return c >= 65 && c <= 90; // A–Z
}

function _tagName(tagNameNode: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagNameNode)) return tagNameNode.text;
  // member expressions like React.Fragment — skip
  return null;
}

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
