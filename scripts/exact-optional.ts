#!/usr/bin/env bun
/**
 * Widen optional properties in public option shapes to `?: T | undefined`.
 *
 *   bun run scripts/exact-optional.ts          # report what would change
 *   bun run scripts/exact-optional.ts --write  # make the change
 *
 * ## Why this is not cosmetic
 *
 * The generated `tsconfig.json` turns on `exactOptionalPropertyTypes`, and under it
 * `image?: string` and `image?: string | undefined` are different types. The first
 * says "this key may be absent"; only the second says "this key may be present and
 * hold `undefined`". So an app that has the strictness the framework shipped it
 * cannot write the most ordinary thing there is:
 *
 * ```ts
 * Media.store({ image: candidate ?? undefined });   // error, under our own config
 * ```
 *
 * The workaround is `...(x ? { x } : {})` at every call site, which is noise the
 * framework imposed on itself. An options bag exists to be spread into, and one
 * built by spreading has conditionally-absent keys — that is the shape of the
 * problem it solves.
 *
 * Widening is safe in both directions. A reader of `opts.image` already got
 * `string | undefined`, because an absent optional property reads as `undefined`;
 * nothing about consuming these types changes. Only construction gets easier.
 *
 * ## Scope
 *
 * Exported interfaces and type aliases whose name ends in `Options`, `Config` or
 * `ConfigShape` — the shapes an app constructs and passes in. Not every optional
 * property in the codebase: internal state, event payloads and return types are
 * read by apps rather than built by them, and widening those would be churn with
 * no call site behind it.
 *
 * Function and constructor types are parenthesised, because `() => void | undefined`
 * parses as a function returning `void | undefined` — a different type, and one that
 * still would not accept `undefined` in the property.
 *
 * ## Opting out
 *
 * A shape that *mirrors a third-party signature* must match it rather than be wider
 * than it: widen the mirror and it stops being assignable to the thing it mirrors,
 * which is the one direction this change can break. Mark those with
 * `@exact-optional-ignore` in the declaration's docblock and this leaves them alone.
 *
 * @module
 */
import { Glob } from "bun";
import ts from "typescript";

/** Interfaces and aliases an app builds and hands to the framework. */
const PUBLIC_SHAPE = /(?:Options|Config|ConfigShape)$/;

/** Docblock marker on a shape that must keep matching something external. */
const OPT_OUT = "@exact-optional-ignore";

const write = process.argv.includes("--write");

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Whether the declaration's leading comments ask to be left alone. */
function optedOut(node: ts.Node, source: ts.SourceFile): boolean {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  return ranges.some((r) => source.text.slice(r.pos, r.end).includes(OPT_OUT));
}

/** Whether `node` is exported from its module. */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * Whether this type already admits `undefined`, and so needs nothing done to it.
 *
 * `any` and `unknown` admit it by construction. A union that already names it is
 * done. `never` is a deliberate "you may not set this" and widening it would undo
 * the thing it was written to say.
 */
function alreadyAdmitsUndefined(type: ts.TypeNode): boolean {
  if (
    type.kind === ts.SyntaxKind.AnyKeyword ||
    type.kind === ts.SyntaxKind.UnknownKeyword ||
    type.kind === ts.SyntaxKind.UndefinedKeyword ||
    type.kind === ts.SyntaxKind.NeverKeyword
  ) {
    return true;
  }
  if (ts.isUnionTypeNode(type)) {
    return type.types.some(
      (t) => t.kind === ts.SyntaxKind.UndefinedKeyword || t.kind === ts.SyntaxKind.AnyKeyword,
    );
  }
  return false;
}

/** Types whose `| undefined` binds wrong without parentheses. */
function needsParentheses(type: ts.TypeNode): boolean {
  return (
    ts.isFunctionTypeNode(type) ||
    ts.isConstructorTypeNode(type) ||
    ts.isConditionalTypeNode(type) ||
    ts.isInferTypeNode(type)
  );
}

/** Every property signature in `members` that should be widened. */
function editsFor(members: ts.NodeArray<ts.TypeElement>, source: ts.SourceFile): Edit[] {
  const edits: Edit[] = [];
  for (const member of members) {
    // `foo?(): void` is a method, not a value the caller sets.
    if (!ts.isPropertySignature(member)) continue;
    if (!member.questionToken || !member.type) continue;
    if (alreadyAdmitsUndefined(member.type)) continue;

    const text = member.type.getText(source);
    edits.push({
      start: member.type.getStart(source),
      end: member.type.getEnd(),
      replacement: needsParentheses(member.type) ? `(${text}) | undefined` : `${text} | undefined`,
    });
  }
  return edits;
}

const files = (
  await Array.fromAsync(new Glob("packages/*/src/**/*.ts").scan({ cwd: process.cwd() }))
)
  .filter((f) => !f.includes(".test."))
  .filter((f) => !f.endsWith(".d.ts"))
  .sort();

let changedFiles = 0;
let changedProps = 0;

for (const file of files) {
  const original = await Bun.file(file).text();
  const source = ts.createSourceFile(file, original, ts.ScriptTarget.ESNext, true);

  const edits: Edit[] = [];
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      if (!isExported(statement) || !PUBLIC_SHAPE.test(statement.name.text)) continue;
      if (optedOut(statement, source)) continue;
      edits.push(...editsFor(statement.members, source));
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      if (!isExported(statement) || !PUBLIC_SHAPE.test(statement.name.text)) continue;
      if (optedOut(statement, source) || !ts.isTypeLiteralNode(statement.type)) continue;
      edits.push(...editsFor(statement.type.members, source));
    }
  }

  if (edits.length === 0) continue;

  // Back to front, so earlier offsets stay valid.
  let updated = original;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  }

  changedFiles += 1;
  changedProps += edits.length;
  if (write) await Bun.write(file, updated);
}

console.log(
  `${write ? "Widened" : "Would widen"} ${changedProps} optional propert${
    changedProps === 1 ? "y" : "ies"
  } across ${changedFiles} file(s).`,
);

// Non-zero on drift, so CI catches a new option shape that was added narrow. The
// point of the convention is that it holds for shapes written after it, not only
// for the ones that existed when it landed.
if (!write && changedProps > 0) {
  console.log("Run `bun run exact:optional` to apply, or mark the shape @exact-optional-ignore.");
  process.exit(1);
}
