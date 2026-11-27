/**
 * Function components the compiler can read out of source, so a page that renders one still
 * compiles ahead of time.
 *
 * `<ProjectForm values={values} />` used to send the whole page to the runtime renderer, and under
 * `cspSafe` it stopped the boot. When `ProjectForm` is a function declared in a module the page
 * imports by a relative path, its body is compiled with the page's rules instead, and the page
 * calls the result. This module only finds the components and records what was read; the
 * compiling is in `transform.ts`.
 *
 * What counts as a component here, deliberately narrow:
 *
 * - a **named import from a relative path** whose name starts with a capital letter and is used as
 *   a JSX tag, naming an `export function Name(…)`, an `export const Name = (…) => …` (or
 *   `= function (…)`), or a local function exported by an `export { … }` list;
 * - in a component's own module, the same, plus a function of that module used as a tag
 *   (`function Row(…)` beside `export function Table(…)`);
 * - followed at most {@link MAX_COMPONENT_DEPTH} modules deep.
 *
 * A default export, a re-export, a namespace import and a package import all stay with the
 * runtime renderer, as before.
 *
 * Because the compiled page now depends on these modules, every file read is recorded: the
 * compile cache keys the page on their text, and its manifest re-checks them on the next boot.
 */
import * as ts from "typescript";
import { dirname, relative, resolve, sep } from "node:path";
import { moduleStringConstants, readImportedStrings } from "./constants.ts";
import {
  moduleDigest,
  readModuleText,
  resolveRelativeModule,
  type StaticImport,
} from "./static-imports.ts";

/** How many modules deep a component's own components are followed. */
export const MAX_COMPONENT_DEPTH = 4;

/** A module that declares components, parsed once per compile. */
export interface ComponentModule {
  /** Absolute path of the module. */
  file: string;
  /** The module, parsed with parent pointers, so a node's text can be read back. */
  sf: ts.SourceFile;
  /** String constants the module can fold: its own top-level ones and those it imports. */
  strings: ReadonlyMap<string, string>;
  /** The components a tag in this module can name, by the name the tag uses. */
  components: Map<string, ComponentSource>;
}

/** One component: the name it is declared with, and the module that declares it. */
export interface ComponentSource {
  /** The name of its declaration inside {@link ComponentSource.module}. */
  name: string;
  module: ComponentModule;
}

/** What {@link readImportedComponents} found for a page. */
export interface ImportedComponents {
  /** The components the page's tags can name, by local name. */
  components: Map<string, ComponentSource>;
  /**
   * Every module read on the way that the page does not import itself, as an import from the
   * page: a component's module, and what that module reads class lists from. The page's own
   * imports are already recorded by the constants reader.
   */
  imports: StaticImport[];
  /** A digest of the text of every module read, for the cache key. Empty when there is none. */
  fingerprint: string;
}

/** Parse a module as the compiler reads every module: TSX, with parent pointers. */
function _parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** A capitalised name: what JSX reads as a component rather than an HTML element. */
function _isComponentName(name: string): boolean {
  const c = name.charCodeAt(0);
  return c >= 65 && c <= 90;
}

/** Every capitalised identifier used as a JSX tag anywhere in `node`. */
function _jsxTagNames(node: ts.Node, names = new Set<string>()): Set<string> {
  const visit = (n: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName) &&
      _isComponentName(n.tagName.text)
    ) {
      names.add(n.tagName.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * The tags a page's `render()` uses: only those are compiled into it. A component the page renders
 * elsewhere (its layout, from `layout()`) renders through the runtime as before, and reading it
 * would only make an edit to that layout recompile every page that uses it.
 */
function _renderTagNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    for (const member of stmt.members) {
      if (ts.isMethodDeclaration(member) && member.name.getText(sf) === "render") {
        _jsxTagNames(member, names);
      }
    }
  }
  return names;
}

function _hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind)) ?? false
  );
}

/**
 * The function a top-level declaration named `name` in `sf` holds: a function declaration, or a
 * `const` initialised with an arrow or function expression. `exported` asks for one the module
 * exports by that name, directly or through an `export { … }` list.
 */
export function findComponentFunction(
  sf: ts.SourceFile,
  name: string,
  exported: boolean,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  let local = name;
  let listed = false;
  if (exported) {
    for (const stmt of sf.statements) {
      if (
        !ts.isExportDeclaration(stmt) ||
        stmt.moduleSpecifier ||
        stmt.isTypeOnly ||
        !stmt.exportClause ||
        !ts.isNamedExports(stmt.exportClause)
      ) {
        continue;
      }
      for (const element of stmt.exportClause.elements) {
        if (element.name.text !== name || element.isTypeOnly) continue;
        local = (element.propertyName ?? element.name).text;
        listed = true;
      }
    }
  }
  for (const stmt of sf.statements) {
    const isExported =
      _hasModifier(stmt, ts.SyntaxKind.ExportKeyword) &&
      !_hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
    if (exported && !listed && !isExported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === local && stmt.body) return stmt;
    if (
      ts.isVariableStatement(stmt) &&
      stmt.declarationList.flags & ts.NodeFlags.Const &&
      !_hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)
    ) {
      for (const declaration of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== local) continue;
        let init = declaration.initializer;
        while (init && (ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))) {
          init = init.expression;
        }
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
      }
    }
  }
  return null;
}

/** `spec` as written in `fromFile`, re-expressed as an import from `toFile`'s directory. */
function _respecify(fromFile: string, spec: string, toFile: string): string {
  const target = resolve(dirname(fromFile), spec);
  const rel = relative(dirname(toFile), target).split(sep).join("/");
  return rel.startsWith("../") || rel.startsWith("./") ? rel : `./${rel}`;
}

/**
 * The function components `source` imports from relative modules and uses as tags, with what
 * each one's module can see, and a record of every file read to find them.
 *
 * A module that is missing, unreadable or does not declare the component simply contributes
 * nothing, so the page falls back to the runtime renderer exactly as it did before this existed.
 */
export function readImportedComponents(source: string, filename: string): ImportedComponents {
  const modules = new Map<string, ComponentModule>();
  /** Every file read past the page itself: path → digest of its text (null when unreadable). */
  const read = new Map<string, string | null>();
  const imports: StaticImport[] = [];
  const recorded = new Set<string>();

  const record = (fromFile: string, spec: string, file: string | null, digest: string | null) => {
    const specifier = _respecify(fromFile, spec, filename);
    if (recorded.has(specifier)) return;
    recorded.add(specifier);
    imports.push({ specifier, file, digest });
  };

  /** The components the tags in `sf` can name: relative imports, and the module's own. */
  const componentsOf = (sf: ts.SourceFile, depth: number, own: boolean) => {
    const found = new Map<string, ComponentSource>();
    // A page is read for what its render() uses; a component module for any tag it has.
    const tags = own ? _jsxTagNames(sf) : _renderTagNames(sf);
    if (tags.size === 0 || depth > MAX_COMPONENT_DEPTH) return found;

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
      if (!ts.isNamedImports(clause.namedBindings)) continue;
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
      const wanted = clause.namedBindings.elements.filter(
        (e) => !e.isTypeOnly && tags.has(e.name.text),
      );
      if (wanted.length === 0) continue;

      const file = resolveRelativeModule(sf.fileName, spec);
      if (!file || !/\.tsx$/.test(file)) continue;
      const module = moduleAt(file, depth);
      if (!module) continue;
      for (const element of wanted) {
        const exported = (element.propertyName ?? element.name).text;
        if (findComponentFunction(module.sf, exported, true)) {
          found.set(element.name.text, { name: exported, module });
        }
      }
    }
    if (own) {
      for (const tag of tags) {
        if (found.has(tag)) continue;
        const module = modules.get(sf.fileName);
        if (module && findComponentFunction(sf, tag, false)) {
          found.set(tag, { name: tag, module });
        }
      }
    }
    return found;
  };

  /** Read, parse and resolve a component module once, whichever page or module imports it. */
  const moduleAt = (file: string, depth: number): ComponentModule | null => {
    const known = modules.get(file);
    if (known) return known;
    const text = readModuleText(file);
    read.set(file, moduleDigest(text));
    if (text === null) return null;

    let sf: ts.SourceFile;
    try {
      sf = _parse(file, text);
    } catch {
      return null;
    }
    // Class lists the module reads from its own relative imports. Those files decide its output
    // as much as its own text does, so they are recorded too.
    const constants = readImportedStrings(text, file);
    for (const imported of constants.imports) {
      record(file, imported.specifier, imported.file, imported.digest);
      if (imported.file) read.set(imported.file, imported.digest);
    }
    const module: ComponentModule = {
      file,
      sf,
      strings: moduleStringConstants(sf, constants.strings),
      components: new Map(),
    };
    modules.set(file, module);
    for (const [name, component] of componentsOf(sf, depth + 1, true)) {
      module.components.set(name, component);
    }
    return module;
  };

  let page: ts.SourceFile;
  try {
    page = _parse(filename, source);
  } catch {
    return { components: new Map(), imports: [], fingerprint: "" };
  }
  const components = componentsOf(page, 1, false);
  // The page's own imports of these modules are recorded by the constants reader. Record them
  // here as well, so the list is complete on its own; the caller drops what it already has.
  for (const module of modules.values()) {
    const digest = read.get(module.file) ?? null;
    imports.push({
      specifier: _respecify(filename, relative(dirname(filename), module.file), filename),
      file: module.file,
      digest,
    });
  }

  const fingerprint =
    components.size === 0
      ? ""
      : String(
          Bun.hash(JSON.stringify([...read].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))),
        );
  return { components, imports, fingerprint };
}
