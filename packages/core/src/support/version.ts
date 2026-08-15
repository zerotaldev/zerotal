/**
 * The framework version this build of `@zerotal/core` is.
 *
 * Read from the manifest rather than written down, for the reason `@zerotal/monitor`
 * already learned: a hardcoded version is correct until the next release, and three
 * separate literals across the monorepo once claimed a version that had never been
 * published. The monorepo releases in lockstep, so this package's manifest carries
 * the framework version, and it ships inside the tarball.
 *
 * @module
 */
import { readFileSync } from "node:fs";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

/** Full version of the running framework, e.g. `1.6.2`. */
export const ZEROTAL_VERSION: string = pkg.version;

/**
 * The version of `@zerotal/core` currently installed in a project, which is not
 * necessarily {@link ZEROTAL_VERSION} — a long-running process holds the code it
 * booted with, so an upgrade lands on disk without reaching it.
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
