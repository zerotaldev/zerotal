/**
 * Flow's part in `bun zt compile`: compile the app's pages while the binary is built, and carry
 * the compiled modules in it.
 *
 * At boot, Flow compiles each page from its source and caches the result under `.zerotal/`. A
 * binary has neither the sources nor that directory, so the compile happens here instead, in
 * both CSP modes, and the binary boots from what was recorded.
 *
 * @module
 */
import { fileURLToPath } from "node:url";
import { sep } from "node:path";
import { _precompilePages } from "./compiler/index.ts";

/**
 * What `bun zt compile` hands each package that takes part in a build.
 *
 * @internal
 */
export interface CompileContext {
  /** The project root. */
  root: string;
  /** The app files the binary carries, root-relative with forward slashes. */
  files: readonly string[];
}

/**
 * Compile every page among the app's files, and return the compiled modules for the binary to
 * carry and the code that registers how each page came out.
 *
 * @internal
 */
export async function _compileContribution(
  context: CompileContext,
): Promise<{ files: string[]; setup: string }> {
  const { builds, modules } = await _precompilePages(context.root, context.files);
  const compiler = fileURLToPath(new URL("./compiler/index.ts", import.meta.url))
    .split(sep)
    .join("/");
  return {
    files: modules,
    setup:
      `import { _embedPageBuilds } from ${JSON.stringify(compiler)};\n` +
      `_embedPageBuilds(${JSON.stringify(builds)});\n`,
  };
}
