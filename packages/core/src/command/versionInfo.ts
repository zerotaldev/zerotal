/**
 * What `bun zt version` reports, and the formatting of it.
 *
 * Split out of the command because the same answer has to be available from two
 * places: the registered {@link VersionCommand}, and the early intercept in
 * `startZerotal` that answers `--version` before config is loaded or the app is
 * imported. Those two must not drift — a version command that reports one thing
 * when the app boots and another when it does not is worse than either.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { ZEROTAL_VERSION } from "../support/version.ts";
import { runtimeMismatch } from "../support/runtime.ts";

/** Everything `zt version` knows. Fields are `null` when there is nothing to read. */
export interface _VersionInfo {
  /** Version of the running framework, e.g. `1.11.0`. */
  zerotal: string;
  /** Version of the Bun executing this process. */
  bun: string;
  /** The app's own name and version from its `package.json`, when it has one. */
  app: { name: string; version: string } | null;
  /**
   * A second Bun installed under `node_modules`, when one is there.
   *
   * Usually arrives as a transitive peer nothing executes, so it is reported
   * rather than complained about — but it is the recurring cause of "which Bun
   * actually ran this", and `version` is where someone goes to ask.
   */
  otherBun: string | null;
}

/**
 * Collect the versions worth reporting.
 *
 * @param cwd - Project root to read the app manifest and `node_modules` from.
 * @internal
 */
export function _versionInfo(cwd: string = process.cwd()): _VersionInfo {
  return {
    zerotal: ZEROTAL_VERSION,
    bun: Bun.version,
    app: _appManifest(cwd),
    otherBun: runtimeMismatch(cwd)?.installed ?? null,
  };
}

/** The app's own name and version, or `null` when the manifest is missing or unreadable. */
function _appManifest(cwd: string): { name: string; version: string } | null {
  try {
    const raw = readFileSync(`${cwd}/package.json`, "utf8");
    const { name, version } = JSON.parse(raw) as { name?: string; version?: string };
    if (name === undefined && version === undefined) return null;
    return { name: name ?? "(unnamed)", version: version ?? "(no version)" };
  } catch {
    return null;
  }
}

/**
 * Render {@link _VersionInfo} as the lines `zt version` prints.
 *
 * Plain text with no colour, because this output gets piped into scripts and
 * pasted into bug reports more often than it gets read on a terminal.
 *
 * @internal
 */
export function _formatVersion(info: _VersionInfo): string {
  const rows: [string, string][] = [
    ["Zerotal", info.zerotal],
    ["Bun", info.bun],
  ];
  if (info.app) rows.push(["App", `${info.app.name} ${info.app.version}`]);

  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);

  if (info.otherBun !== null && info.otherBun !== info.bun) {
    lines.push(
      "",
      `node_modules also contains bun ${info.otherBun}, which is not the one running.`,
      `Nothing executes it — it arrives as a peer dependency — but that is the copy`,
      `an install would use if anything ever did.`,
    );
  }

  return lines.join("\n");
}
