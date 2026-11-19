/**
 * The framework version this build of `@zerotal/core` is.
 *
 * Read from the manifest rather than written down, for the reason `@zerotal/monitor`
 * already learned: a hardcoded version is correct until the next release, and three
 * separate literals across the monorepo once claimed a version that had never been
 * published. The monorepo releases in lockstep, so this package's manifest carries
 * the framework version, and it ships inside the tarball.
 *
 * The manifest is imported, not read from disk. A path relative to this module
 * points nowhere inside a binary built by `bun zt compile`, so reading it crashed
 * the binary before the app booted; an import is embedded by the bundler, and an
 * unbundled run still reads the manifest that sits next to the source.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };

/** Full version of the running framework, e.g. `1.6.2`. */
export const ZEROTAL_VERSION: string = pkg.version;

/**
 * The version of `@zerotal/core` currently installed in a project, which is not
 * necessarily {@link ZEROTAL_VERSION} — a long-running process holds the code it
 * booted with, so an upgrade lands on disk without reaching it.
 *
 * This one does read the disk, on purpose: the point is what is installed now, not
 * what this process was built from. A compiled binary usually has no `node_modules`
 * beside it, so it gets `null`, which callers already treat as nothing to report.
 *
 * @param cwd - Project root to look under.
 * @returns The installed version, or `null` when there is nothing to read — a
 *   workspace checkout, a hoisted layout, a partial install. Absence is not a
 *   finding, so callers stay quiet on `null` rather than guessing.
 */
export function installedCoreVersion(cwd: string): string | null {
  try {
    const raw = readFileSync(`${cwd}/node_modules/@zerotal/core/package.json`, "utf8");
    const { version } = JSON.parse(raw) as { version?: string };
    return version ?? null;
  } catch {
    return null;
  }
}
