// Shared helpers for the flow CLI commands: file copying with import-rewriting and
// the conventional UI directory location.

import { join } from "node:path";
import { resolveSource, rewriteImports, UTILS } from "../registry.ts";

/** Where copied components live, relative to the app root. */
export const DEFAULT_UI_DIR = "app/flow/components/ui";

/** npm deps the copied `cn` util needs the host app to provide. */
export const RUNTIME_DEPS = ["clsx", "tailwind-merge"] as const;

/**
 * Return the RUNTIME_DEPS that don't resolve from `cwd` — i.e. the app must add
 * them itself (the copy-in model means the app owns the code AND its deps).
 */
export function missingRuntimeDeps(cwd: string = process.cwd()): string[] {
  // Cast: `Bun.resolveSync` isn't in every consuming app's Bun typings, and this
  // module is pulled into apps' typechecks via the command import chain.
  const resolveSync = (Bun as unknown as { resolveSync(id: string, parent: string): string })
    .resolveSync;
  return RUNTIME_DEPS.filter((dep) => {
    try {
      resolveSync(dep, cwd);
      return false;
    } catch {
      return true;
    }
  });
}

/** Copy a text file, optionally transforming its contents. */
export async function copyText(
  absSource: string,
  destPath: string,
  transform: (s: string) => string = (s) => s,
): Promise<void> {
  const src = await Bun.file(absSource).text();
  await Bun.write(destPath, transform(src));
}

/**
 * Ensure the shared utils (cn, gva) exist under `<uiDir>/lib`. Returns the list of
 * targets actually written (skips ones already present). Idempotent.
 */
export async function ensureUtils(uiDir: string): Promise<string[]> {
  const written: string[] = [];
  for (const util of UTILS) {
    const dest = join(uiDir, util.target);
    if (await Bun.file(dest).exists()) continue;
    await copyText(resolveSource(util.source), dest, rewriteImports);
    written.push(util.target);
  }
  return written;
}
