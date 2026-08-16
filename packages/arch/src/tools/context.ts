/**
 * What every tool is handed: where the project is, where the corpus is, and how
 * to reach a booted app.
 *
 * Passing these in rather than reading them from module scope is what makes a
 * tool testable — a test points `root` at a fixture directory and injects a
 * {@link ProbeRunner} that returns a canned report, and no application is ever
 * booted.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ProbeRunner } from "./_probe.ts";

export interface ToolContext {
  /** The project being served. Every relative path a tool reads hangs off this. */
  root: string;
  /**
   * The documentation corpus.
   *
   * Defaults to the copy vendored inside this package, which is what makes
   * `search_docs` version-matched: the docs an app searches are the ones that
   * shipped with the `@zerotal/arch` it installed, not whatever is on main.
   */
  docsDir: string;
  probe: ProbeRunner;
}

/**
 * The docs shipped inside this package.
 *
 * Resolved from this module's own URL rather than the working directory,
 * because the working directory is the *app* and the corpus lives in
 * `node_modules`.
 */
export function vendoredDocsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
}
