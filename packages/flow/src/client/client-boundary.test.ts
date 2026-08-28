/**
 * Flow's client entries must not reach `@zerotal/orm`'s runtime, and nothing
 * enforced that.
 *
 * `@zerotal/flow` depends on `@zerotal/orm`, and every orm import in the package is
 * `import type` — deliberately, because finding T16 was a root import dragging
 * `await import("bun")` into a browser bundle and breaking it at *resolution* time.
 * A resolution error happens before tree-shaking, so one server-only reach makes
 * the whole bundle fail, and the real cause shows up two layers down in a bundler
 * log rather than at the import that caused it.
 *
 * There is one exception in the tree: `synths/ModelSynth.ts` imports the *value*
 * `modelsByName` from `@zerotal/orm`. That is safe for exactly one reason — no
 * client entry reaches a synth — and it was verified by hand, once, in an audit, in
 * August. Nothing stopped the next refactor from making it false.
 *
 * This walks the import graph from each client entry instead of running the
 * bundler. Both would catch the same regression, and the static walk is the better
 * test here for two reasons: it names *which module* crossed the boundary rather
 * than reporting a resolution failure from somewhere inside the graph, and it is
 * deterministic — bundling inside an 85-file suite proved to fail intermittently
 * with a misleading `EISDIR`, which is a flaky guard, which is worse than none.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Every `import`/`export ... from "..."` in a source file, with its `type` marker. */
function importsOf(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  // Covers `import x from "y"`, `import "y"`, `export … from "y"`, and the
  // `import type` / `export type` forms. Good enough for a first-party tree that
  // is formatted by Prettier and has no dynamic specifiers on these paths.
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*["']([^"']+)["']/g;
  const bare = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const m of source.matchAll(pattern)) {
    found.push({ specifier: m[2]!, typeOnly: Boolean(m[1]) });
  }
  for (const m of source.matchAll(bare)) {
    found.push({ specifier: m[1]!, typeOnly: false });
  }
  return found;
}

/** Resolve a relative specifier against the importing file. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return resolve(dirname(fromFile), specifier);
}

/**
 * Walk every module reachable from `entry` through relative imports, and report
 * the value (non-type) imports of `@zerotal/orm` found along the way.
 *
 * Type-only imports are ignored on purpose: they erase, so they cannot reach a
 * browser at all, and banning them would ban the pattern the package deliberately
 * uses everywhere else.
 */
function ormValueImports(entry: string): Array<{ file: string; specifier: string }> {
  const seen = new Set<string>();
  const offenders: Array<{ file: string; specifier: string }> = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // A specifier this walker cannot resolve is not a finding.
    }

    for (const { specifier, typeOnly } of importsOf(source)) {
      if (typeOnly) continue;
      if (specifier === "@zerotal/orm" || specifier.startsWith("@zerotal/orm/")) {
        offenders.push({ file: file.replace(SRC, ""), specifier });
        continue;
      }
      const local = resolveLocal(file, specifier);
      if (local) queue.push(local);
    }
  }
  return offenders;
}

const ENTRIES = ["client/index.ts", "client/index.csp.ts", "client/enhance.ts"];

describe("Flow's client entries", () => {
  for (const entry of ENTRIES) {
    it(`${entry} reaches no @zerotal/orm runtime import`, () => {
      const offenders = ormValueImports(`${SRC}${entry}`);
      expect(
        offenders,
        offenders.length > 0
          ? `${entry} now reaches ${offenders.map((o) => o.file).join(", ")}, which imports ` +
              `${offenders[0]!.specifier} as a value. That drags the ORM's runtime — and ` +
              `\`await import("bun")\` with it — into a browser bundle, which fails at resolution ` +
              `time with an error pointing somewhere else entirely. Use \`import type\`, or move ` +
              `what you need behind the server boundary.`
          : "",
      ).toEqual([]);
    });
  }

  it("catches a violation, rather than passing because the walk found nothing", () => {
    // A guard nobody has seen fail is a guard nobody should trust. `ModelSynth` is
    // the known value importer, so walking from it must report exactly that.
    const offenders = ormValueImports(`${SRC}synths/ModelSynth.ts`);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.specifier).toBe("@zerotal/orm");
  });

  it("does not count a type-only import as a crossing", () => {
    // The pattern the rest of the package uses. If this ever fails, the walker has
    // become a rule against `import type`, which would be a rule against the fix.
    const typeOnly = importsOf(`import type { Model } from "@zerotal/orm";`);
    expect(typeOnly[0]).toEqual({ specifier: "@zerotal/orm", typeOnly: true });
  });
});
