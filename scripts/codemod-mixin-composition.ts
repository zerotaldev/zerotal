#!/usr/bin/env bun
/**
 * Codemod: `BaseModelWith(...)` / `ComponentWith(...)` → `Model.using(...)` / `Component.using(...)`
 *
 * Zerotal 1.3.0 replaced the two free-function mixin composers with a `static using()` on the base
 * class itself. This script rewrites call sites and fixes up the import specifiers that a plain
 * find-and-replace would leave broken.
 *
 * It also renames the base class at *declaration sites* (`extends BaseModel` → `extends Model`)
 * when run with `--rename-base`. `Model` and `BaseModel` are the same class object, so this is
 * cosmetic — it is applied to user-facing code (docs, templates, apps) and deliberately NOT to the
 * framework's own internals, where `BaseModel` still appears in generic bounds and type positions.
 *
 * Usage:
 *   bun run scripts/codemod-mixin-composition.ts [paths...] [--rename-base] [--dry]
 *
 * Defaults to `packages apps docs blog` when no paths are given.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const EXTENSIONS = new Set([".ts", ".tsx", ".md", ".mdx"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

interface Replacement {
  readonly find: RegExp;
  readonly replace: string;
}

/** Call-site rewrites. Applied to every scanned file. */
const CALL_SITES: Replacement[] = [
  { find: /\bComponentWith\s*\(/g, replace: "Component.using(" },
  { find: /\bBaseModelWith\s*\(/g, replace: "Model.using(" },
  // Prose/identifier references left over after the call-site pass.
  { find: /\bComponentWith\b/g, replace: "Component.using" },
  { find: /\bBaseModelWith\b/g, replace: "Model.using" },
];

/** `extends BaseModel` at a declaration site — only with --rename-base. */
const BASE_RENAME: Replacement[] = [{ find: /\bextends BaseModel\b/g, replace: "extends Model" }];

/**
 * Rewrite the named imports of a module specifier: drop `remove`, ensure `add` is present.
 * Only touches `import { … } from "<module>"` forms — namespace and default imports are left alone.
 */
function fixImports(source: string, modules: RegExp, remove: string[], add: string): string {
  const importRe = new RegExp(
    `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+(["'])(${modules.source})\\3`,
    "g",
  );
  return source.replace(importRe, (full, typeKw: string | undefined, body: string, quote, mod) => {
    const specifiers = body
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const kept = specifiers.filter((s) => {
      const local = s
        .split(/\s+as\s+/)[0]!
        .trim()
        .replace(/^type\s+/, "");
      return !remove.includes(local);
    });
    if (kept.length === specifiers.length) return full; // nothing removed → nothing to add

    const hasAdd = kept.some((s) => {
      const local = s
        .split(/\s+as\s+/)[0]!
        .trim()
        .replace(/^type\s+/, "");
      return local === add;
    });
    if (!hasAdd) kept.unshift(add);
    if (kept.length === 0) return ""; // import became empty — drop it entirely

    const multiline = full.includes("\n");
    const inner = multiline ? `\n  ${kept.join(",\n  ")},\n` : ` ${kept.join(", ")} `;
    return `import ${typeKw ?? ""}{${inner}} from ${quote}${mod}${quote}`;
  });
}

function transform(source: string, renameBase: boolean): string {
  let out = source;

  // 1. Imports first, while the old identifiers are still present to key off.
  out = fixImports(out, /@zerotal\/flow|zerotal\/flow/, ["ComponentWith"], "Component");
  out = fixImports(out, /@zerotal\/orm|zerotal\/orm/, ["BaseModelWith"], "Model");
  // In-repo relative imports of the mixin modules.
  out = fixImports(out, /\.\/mixins\.ts/, ["ComponentWith", "BaseModelWith"], "Component");

  // 2. Call sites and leftover prose references.
  for (const { find, replace } of CALL_SITES) out = out.replace(find, replace);

  // 3. Optional declaration-site rename.
  if (renameBase) {
    for (const { find, replace } of BASE_RENAME) out = out.replace(find, replace);
    // Only pull `Model` into the import when a declaration site actually needs it.
    if (/\bextends Model\b/.test(out)) {
      out = out.replace(
        /import\s+\{([^}]*)\}\s+from\s+(["'])(@zerotal\/orm|zerotal\/orm)\2/g,
        (full, body: string, quote, mod) => {
          const specs = body
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const locals = specs.map((s) =>
            s
              .split(/\s+as\s+/)[0]!
              .trim()
              .replace(/^type\s+/, ""),
          );
          if (locals.includes("Model")) return full;
          if (!locals.includes("BaseModel")) return full;
          // Swap BaseModel → Model unless BaseModel is still referenced elsewhere in the file.
          const stillUsed = new RegExp(String.raw`\bBaseModel\b`).test(
            out.replace(/import[^;]*;/g, ""),
          );
          const next = stillUsed
            ? ["Model", ...specs]
            : specs.map((s, i) => (locals[i] === "BaseModel" ? "Model" : s));
          return `import { ${next.join(", ")} } from ${quote}${mod}${quote}`;
        },
      );
    }
  }

  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const dry = args.includes("--dry");
  const renameBase = args.includes("--rename-base");
  const paths = args.filter((a) => !a.startsWith("--"));
  const roots = paths.length > 0 ? paths : ["packages", "apps", "docs", "blog"];

  let changed = 0;
  let scanned = 0;

  for (const root of roots) {
    for await (const file of walk(root)) {
      scanned++;
      const before = await readFile(file, "utf8");
      const after = transform(before, renameBase);
      if (before === after) continue;
      changed++;
      console.log(`${dry ? "would update" : "updated"}  ${file}`);
      if (!dry) await writeFile(file, after, "utf8");
    }
  }

  console.log(
    `\n${dry ? "Dry run: " : ""}${changed} file${changed === 1 ? "" : "s"} ` +
      `${dry ? "would change" : "changed"} (${scanned} scanned).`,
  );
  if (!dry) console.log("Run `bun run format` and `bun run typecheck` next.");
}

await main();
