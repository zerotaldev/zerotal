/**
 * Imports typed at the `bun zt repl` prompt.
 *
 * The REPL evaluates each line as a script in its own context, and a script can hold neither an
 * `import … from` declaration nor, without a loader, an `import()` expression. Both used to fail:
 * the first as a syntax error, the second with "A dynamic import callback was not specified". So
 * nothing outside the handful of globals providers contribute could be reached, framework
 * modules and the app's own models included.
 *
 * `import()` is given the main loader, with the app root as the script's location so a specifier
 * resolves as it would in a file at the root: `zerotal/auth` from the app's dependencies,
 * `./app/models/User` from the app. A declaration is rewritten to the `import()` it means.
 */

/**
 * Rewrite a one-line `import` declaration as the `await import()` it means, so a script can run
 * it. Anything else, an `import()` expression included, is returned unchanged.
 *
 * Covers the forms people type: a bare `import "m"`, a default import, a namespace import, named
 * imports with `as`, a default with named imports, and `import type`, which binds nothing at run
 * time and so becomes `undefined`. A default with a namespace import is left alone and reported as
 * the syntax error it then is.
 *
 * @param line - One trimmed line of REPL input.
 * @returns The line to evaluate.
 * @internal
 */
export function _rewriteImportDeclaration(line: string): string {
  if (!/^import\s/.test(line) || /^import\s*\(/.test(line)) return line;

  const declaration = line.replace(/;\s*$/, "");
  if (/^import\s+type\s/.test(declaration)) return "undefined";

  const bare = /^import\s+(["'][^"']+["'])$/.exec(declaration);
  if (bare) return `await import(${bare[1]})`;

  const match = /^import\s+(.+?)\s+from\s+(["'][^"']+["'])$/.exec(declaration);
  if (!match) return line;
  const clause = match[1]!.trim();
  const from = `await import(${match[2]})`;

  const namespace = /^\*\s+as\s+([\w$]+)$/.exec(clause);
  if (namespace) return `const ${namespace[1]} = ${from}`;

  const parts = /^(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?$/.exec(clause);
  if (!parts || (!parts[1] && parts[2] === undefined)) return line;

  const bindings: string[] = [];
  if (parts[1]) bindings.push(`default: ${parts[1]}`);
  for (const raw of (parts[2] ?? "").split(",")) {
    const name = raw.trim().replace(/^type\s+/, "");
    if (!name || raw.trim().startsWith("type ")) continue;
    const renamed = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(name);
    bindings.push(renamed ? `${renamed[1]}: ${renamed[2]}` : name);
  }
  if (bindings.length === 0) return `await import(${match[2]})`;
  return `const { ${bindings.join(", ")} } = ${from}`;
}
