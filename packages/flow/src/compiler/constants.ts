/**
 * String constants the compiler can read out of source without running it.
 *
 * `class={CARD}` is a static class string whenever `CARD` is a `const` holding one, wherever it
 * is declared. The compiler used to see only the page's own text, so an identifier was opaque and
 * the page fell back to the runtime renderer. That punished the idiom the starter teaches (a
 * shared `ui.ts` of class lists), and it also made those pages impossible under `cspSafe`, where
 * a page that does not compile is fatal.
 *
 * Deliberately a small subset, so that "static" stays easy to state:
 *
 * - a string literal, or a template literal with no substitutions;
 * - `+` between two of those;
 * - a template literal whose substitutions are themselves static;
 * - the name of an earlier top-level `const` that is one of the above.
 *
 * And from other files: only a **named import from a relative path**, of a name that module
 * `export const`s (or exports in an `export { … }` list), one level deep. A re-export, a
 * namespace import, a default export and anything computed all stay with the runtime renderer.
 *
 * Because the compiled output now depends on files other than the page, the values that were
 * read are part of the cache key (see {@link staticStringsFingerprint}); otherwise editing the
 * shared file would leave every page that uses it serving its old classes.
 */
import * as ts from "typescript";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Names mapped to the string they are known to hold. */
export type StaticStrings = ReadonlyMap<string, string>;

/** Strip the wrappers that do not change a value: parentheses, `as`, `satisfies`, `!`. */
function _unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The string `node` always evaluates to, or `undefined` when that cannot be known from the
 * source alone.
 */
export function foldStaticString(node: ts.Expression, names: StaticStrings): string | undefined {
  const n = _unwrap(node);

  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isIdentifier(n)) return names.get(n.text);

  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldStaticString(n.left, names);
    if (left === undefined) return undefined;
    const right = foldStaticString(n.right, names);
    return right === undefined ? undefined : left + right;
  }

  if (ts.isTemplateExpression(n)) {
    let out = n.head.text;
    for (const span of n.templateSpans) {
      const value = foldStaticString(span.expression, names);
      if (value === undefined) return undefined;
      out += value + span.literal.text;
    }
    return out;
  }

  return undefined;
}

/**
 * Every top-level `const` in `sf` that folds to a string, in declaration order so that a later
 * one can be built from an earlier one. `seed` is what is already known (imports).
 */
export function moduleStringConstants(
  sf: ts.SourceFile,
  seed: StaticStrings = new Map(),
): Map<string, string> {
  const known = new Map(seed);
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = foldStaticString(declaration.initializer, known);
      if (value !== undefined) known.set(declaration.name.text, value);
    }
  }
  return known;
}

/** The string constants a module exports, by their exported name. */
export function exportedStringConstants(sf: ts.SourceFile): Map<string, string> {
  const all = moduleStringConstants(sf);
  const exported = new Map<string, string>();

  for (const statement of sf.statements) {
    // export const NAME = "…"
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && all.has(declaration.name.text)) {
          exported.set(declaration.name.text, all.get(declaration.name.text)!);
        }
      }
    }
    // export { NAME, OTHER as ALIAS }   (not `export { … } from "…"`: that is a re-export)
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (all.has(local)) exported.set(element.name.text, all.get(local)!);
      }
    }
  }
  return exported;
}

/** Resolve a relative import specifier to the TypeScript file it names, if there is one. */
function _resolveModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    // `import … from "../ui.js"` is how ESM TypeScript spells a .ts file.
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
  ];
  return candidates.find((candidate) => {
    if (!/\.(ts|tsx)$/.test(candidate) || !existsSync(candidate)) return false;
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * The string constants `source` imports from other files, keyed by the name it imports them as.
 *
 * Reads each relative module once, parses it, and keeps only what folds. A module that is
 * missing, unreadable or does not parse simply contributes nothing, so the page falls back to
 * the runtime renderer exactly as it did before this existed.
 */
export function resolveImportedStrings(source: string, filename: string): Map<string, string> {
  const imported = new Map<string, string>();
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (
      !clause ||
      clause.isTypeOnly ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      continue;

    const file = _resolveModule(filename, statement.moduleSpecifier.text);
    if (!file) continue;

    let exports: Map<string, string>;
    try {
      const text = readFileSync(file, "utf8");
      const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      exports = exportedStringConstants(
        ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind),
      );
    } catch {
      continue;
    }

    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const value = exports.get((element.propertyName ?? element.name).text);
      if (value !== undefined) imported.set(element.name.text, value);
    }
  }
  return imported;
}

/**
 * A short digest of the values a page's compile depended on, for the cache key. Empty when the
 * page uses none, so such a page keeps the key it always had.
 */
export function staticStringsFingerprint(strings: StaticStrings): string {
  if (strings.size === 0) return "";
  const entries = [...strings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return String(Bun.hash(JSON.stringify(entries)));
}

/** A class list with its whitespace collapsed to single spaces, as the browser reads it. */
export function normalizeClassList(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}
