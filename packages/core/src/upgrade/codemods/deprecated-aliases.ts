/**
 * Ledger #4 — retire the deprecated aliases.
 *
 * Two codemods, not one, because they retire at different times and a codemod
 * carries a single version:
 *
 * - {@link deprecatedAliases} at **1.13.0** — `routes:types` → `route:types` and
 *   `serve --dev` → `dev`. Both shipped; both fail loudly now.
 * - {@link baseModelRename} at **2.0.0** — `BaseModel` → `Model`. Not shipped;
 *   sized on 1 Sep 2026 at 617 api-surface references and moved to 2.0.
 *
 * They were one codemod, which forced one version, which took the later of the
 * two — so `zt upgrade --to 1.13.0` selected nothing and offered no help
 * migrating the very release that retired `serve --dev`, while an app crossing to
 * 2.0 would have had its `BaseModel` renamed as a side effect of a command alias.
 * A codemod nobody's upgrade reaches is a codemod that does not exist.
 */
import type { Change, Codemod, CodemodResult, Manual, SourceFile } from "../types.ts";

/**
 * `BaseModel` in a class heritage clause — the one place renaming is safe.
 *
 * Anchored on `class Name extends`, not on `extends` alone. A generic bound
 * writes `<T extends BaseModel>` with the same keyword, and matching that was a
 * real bug the tests caught: it rewrote precisely the type positions this file
 * says it will not touch.
 */
const BASE_MODEL_VALUE = /\bclass\s+(\w+)(\s*<[^>]*>)?\s+extends\s+BaseModel\b/g;

/** `BaseModel` inside a generic bound or a type annotation. Reported, not rewritten. */
const BASE_MODEL_TYPE = /<[^>]*\bextends\s+BaseModel\b[^>]*>|:\s*BaseModel\b/;

/** The import specifier, which has to follow the rename or the file stops compiling. */
const BASE_MODEL_IMPORT = /(\bimport\s*\{[^}]*?)\bBaseModel\b([^}]*?\}\s*from\s*["'][^"']*["'])/g;

const COMMAND_ALIASES: { find: RegExp; replace: string; label: string }[] = [
  { find: /\broutes:types\b/g, replace: "route:types", label: "`routes:types` → `route:types`" },
  {
    // `zt.ts` as well as `zt`, because the scaffolded entry point *is* `zt.ts` and
    // every generated `package.json` reads `bun zt.ts serve --dev`. Anchoring on
    // `zt` followed by whitespace missed the most common occurrence there is — the
    // one an app runs as `bun run dev` — so `zt upgrade` reported nothing to do on
    // the file that needed it most.
    find: /\b(zt|zerotal)(\.ts)?\s+serve\s+--dev\b/g,
    replace: "$1$2 dev",
    label: "`serve --dev` → `dev`",
  },
];

/** The command aliases retired in 1.13.0. Both fail loudly rather than drifting. */
export const deprecatedAliases: Codemod = {
  version: "1.13.0",
  name: "deprecated-aliases",
  description: "Retire routes:types and serve --dev in favour of their real names",
  ledger: 4,

  run(files: SourceFile[]): CodemodResult {
    const changes: Change[] = [];

    for (const { file, contents } of files) {
      let next = contents;
      const notes: string[] = [];

      for (const { find, replace, label } of COMMAND_ALIASES) {
        const hits = next.match(find)?.length ?? 0;
        if (hits === 0) continue;
        next = next.replace(find, replace);
        notes.push(`${hits} × ${label}`);
      }

      if (next !== contents) changes.push({ file, summary: notes.join(", "), contents: next });
    }

    return { changes, manual: [] };
  },
};

/**
 * `BaseModel` → `Model`, which has **not shipped** and is scheduled for 2.0.
 *
 * ## What this deliberately does not do
 *
 * **It does not touch `BaseModel` in a type position.** `Model` and `BaseModel`
 * are the same runtime class, so a value-position rename is cosmetic and safe.
 * In a generic bound — `<T extends BaseModel>` — the name may be load-bearing
 * for a reader even though it resolves identically, and in framework source it
 * genuinely is. Those are reported for a person instead.
 *
 * That asymmetry is the whole reason this is a codemod rather than a
 * find-and-replace: the mixin-composition script learned it the hard way in
 * 1.3.0, where a blind rename broke import specifiers it had not considered.
 */
export const baseModelRename: Codemod = {
  version: "2.0.0",
  name: "base-model-rename",
  description: "Rename BaseModel to Model at every declaration site",
  ledger: 4,

  run(files: SourceFile[]): CodemodResult {
    const changes: Change[] = [];
    const manual: Manual[] = [];

    for (const { file, contents } of files) {
      let next = contents;
      const notes: string[] = [];

      // Value positions first, then the import that has to agree with them.
      const valueHits = next.match(BASE_MODEL_VALUE)?.length ?? 0;
      if (valueHits > 0) {
        next = next.replace(
          BASE_MODEL_VALUE,
          (_match, name: string, generics = "") => `class ${name}${generics} extends Model`,
        );
        notes.push(`${valueHits} × \`extends BaseModel\` → \`extends Model\``);
      }

      if (valueHits > 0 && BASE_MODEL_IMPORT.test(next)) {
        BASE_MODEL_IMPORT.lastIndex = 0;
        // `Model` may already be imported alongside it; collapsing to a single
        // `Model` in that case would produce a duplicate specifier.
        next = next.replace(BASE_MODEL_IMPORT, (whole, before: string, after: string) =>
          /\bModel\b\s*[,}]/.test(before + after)
            ? whole.replace(/\bBaseModel\b\s*,\s*/, "").replace(/,\s*\bBaseModel\b/, "")
            : `${before}Model${after}`,
        );
        notes.push("import specifier updated");
      }

      // Type positions are a handover, not a rewrite.
      contents.split("\n").forEach((line, i) => {
        if (!BASE_MODEL_TYPE.test(line)) return;
        manual.push({
          file,
          line: i + 1,
          text: line.trim(),
          reason:
            "`BaseModel` in a type position. It resolves to the same class as `Model`, so this " +
            "compiles either way — renaming it is a readability call, not a correctness one.",
        });
      });

      if (next !== contents) changes.push({ file, summary: notes.join(", "), contents: next });
    }

    return { changes, manual };
  },
};
