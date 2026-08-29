/**
 * Codemods — small, idempotent source transforms used by `make:*` generators to
 * wire newly-created code into existing bootstrap files (so you don't hand-edit
 * `bootstrap/providers.ts` after every `make:provider`).
 */

/** Insert an import statement after the last existing import (deduped). */
export function addImport(source: string, importStatement: string): string {
  if (source.includes(importStatement)) return source;
  const lines = source.split('\n');
  let lastImportIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*import\s/.test(lines[index]!)) lastImportIndex = index;
  }
  lines.splice(lastImportIndex + 1, 0, importStatement);
  return lines.join('\n');
}

/**
 * Append an identifier to a `export default [ ... ]` array literal, preserving
 * indentation and the trailing-comma style. No-op if already present.
 */
export function addToDefaultArrayExport(source: string, identifier: string): string {
  const start = source.indexOf('export default [');
  if (start === -1) return source;
  const close = source.indexOf('];', start);
  if (close === -1) return source;
  const body = source.slice(start, close);
  if (new RegExp(`\\b${identifier}\\b`).test(body)) return source; // Already listed.
  // Infer indentation from an existing item, else two spaces.
  const indentMatch = body.match(/\n(\s+)\S/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  return source.slice(0, close) + `${indent}${identifier},\n` + source.slice(close);
}

export type RegisterResult = 'added' | 'exists' | 'missing';

export interface RegisterProviderOptions {
  className: string;
  /** Import specifier, e.g. '../app/providers/FooProvider.ts' or '@zerotal/foo'. */
  importPath: string;
  /** Bootstrap file. Default: 'bootstrap/providers.ts'. */
  bootstrapPath?: string | undefined;
}

/**
 * Register a provider in the app's bootstrap providers file: adds the import and
 * appends it to the default-exported array. Idempotent.
 *
 * @returns 'added' | 'exists' (already registered) | 'missing' (no bootstrap file)
 */
export async function registerProvider(options: RegisterProviderOptions): Promise<RegisterResult> {
  const path = options.bootstrapPath ?? 'bootstrap/providers.ts';
  const file = Bun.file(path);
  if (!(await file.exists())) return 'missing';

  let source = await file.text();
  if (new RegExp(`\\b${options.className}\\b`).test(source)) return 'exists';

  source = addImport(source, `import { ${options.className} } from "${options.importPath}";`);
  source = addToDefaultArrayExport(source, options.className);
  await Bun.write(path, source);
  return 'added';
}
