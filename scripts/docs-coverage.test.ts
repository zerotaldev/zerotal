/**
 * The gate's program has to be able to see a `.tsx` module.
 *
 * With `jsx` unset — which is what the root tsconfig leaves it as — TypeScript
 * does not merely fail to parse a `.tsx` file, it declines to pull it into the
 * program at all. Every symbol declared in one is then invisible: an `@internal`
 * marker on a `.tsx` export was never seen, so the export stayed in the promised
 * set and was counted as an undocumented gap for as long as it existed.
 *
 * That silently inflated exactly the packages with the largest reported numbers,
 * because `admin` and `flow-ui` are the ones written in TSX. Correcting it moved
 * the total by 24 in `admin` alone. `api-surface.ts` had always set the option;
 * this script was the outlier, which is why the two disagreed about what existed.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import ts from "typescript";
import { analysisOptions } from "./docs-coverage.ts";

/** Building a real program is seconds, not milliseconds — build one and share it. */
const ENTRY = "packages/admin/src/index.ts";
const T = 60_000;
let program: ts.Program;

beforeAll(() => {
  program = ts.createProgram([ENTRY], analysisOptions());
}, T);

describe("the analysis program", () => {
  it("sets jsx, without which .tsx modules are not in the program", () => {
    expect(analysisOptions().jsx).toBe(ts.JsxEmit.Preserve);
  });

  it(
    "resolves a .tsx module reached through a re-export",
    () => {
      // The real shape of the bug: the entry point re-exports from a `.tsx` file,
      // and the alias resolved to nothing rather than to the declaration.
      const tsx = program.getSourceFile("packages/admin/src/pages/RolesPage.tsx");
      expect(
        tsx,
        "a .tsx module reached from the entry point must be in the program",
      ).toBeDefined();
    },
    T,
  );

  it(
    "sees an @internal marker on a .tsx declaration through the alias",
    () => {
      const checker = program.getTypeChecker();
      const source = program.getSourceFile(ENTRY)!;
      const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);

      const symbol = exports.find((e) => e.getName() === "RolesPage");
      expect(symbol).toBeDefined();
      const tags = checker.getAliasedSymbol(symbol!).getJsDocTags(checker);
      expect(tags.map((t) => t.name)).toContain("internal");
    },
    T,
  );
});
