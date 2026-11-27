/**
 * What `bun zt dev` does about a file that changed.
 *
 * One pure function, so the watch list is a table a test can read rather than a set of
 * prefixes spread through the watcher's callback.
 *
 * The line that matters most is between the two kinds of restart. Every process that sets
 * `restartOnChange` (the scheduler, say) boots the whole app again when it restarts, so
 * restarting it for a file it never loads only costs time. A Flow page, component or layout
 * under `app/flow/` is loaded by the server alone: a schedule or a job does not render pages.
 * Those restart the server and leave the other tabs running.
 */

/**
 * What one changed file asks of dev mode.
 *
 * - `ignore`: nothing. Output directories, tool directories, and paths nothing loads.
 * - `rebuild`: rebuild the assets and reload the browser. The server keeps running.
 * - `restart-server`: rebuild, then restart the server. Processes that restart with the
 *   server keep running, because they cannot load the file.
 * - `restart-all`: rebuild, then restart the server and every process that restarts with it.
 *
 * @internal
 */
export type _DevChange = "ignore" | "rebuild" | "restart-server" | "restart-all";

/**
 * Loaded by the server and nothing else, so a change restarts the server alone.
 *
 * Checked before {@link _RESTART_ALL}, which holds `app/` as a whole.
 *
 * @internal
 */
export const _RESTART_SERVER: readonly string[] = ["app/flow/", "resources/app.html"];

/**
 * Loaded by every process that boots the app: the server, and any process that sets
 * `restartOnChange`.
 *
 * @internal
 */
export const _RESTART_ALL: readonly string[] = [
  "app/",
  "routes/",
  "bootstrap/",
  "config/",
  "packages/",
];

/**
 * Built into the browser bundles. Inertia pages live under `resources/js/pages/`.
 *
 * @internal
 */
export const _REBUILD: readonly string[] = ["resources/pages/", "resources/js/", "resources/css/"];

/** Output and tool directories. Checked first, so nothing under them is ever acted on. */
const IGNORE: readonly string[] = ["public/", ".zerotal/", "node_modules/", ".git/"];

/** Written by the build itself, so its own change event must not start another build. */
const IGNORE_FILES = new Set(["resources/js/pages.generated.ts"]);

/**
 * Decide what dev mode does about one changed file.
 *
 * `path` is relative to the app root, as the file watcher reports it; Windows separators are
 * accepted. A directory's own event (`app/flow` after a folder is renamed in it) is treated
 * like a file inside it.
 *
 * @internal
 */
export function _classifyChange(path: string): _DevChange {
  const file = path.replace(/\\/g, "/").replace(/^\.\//, "");

  // Hidden files and directories: `.env`, editor swap directories, `.git`.
  if (file === "" || file.startsWith(".")) return "ignore";
  if (IGNORE_FILES.has(file) || _within(file, IGNORE)) return "ignore";

  if (_within(file, _RESTART_SERVER)) return "restart-server";
  if (_within(file, _RESTART_ALL)) return "restart-all";
  if (_within(file, _REBUILD)) return "rebuild";
  return "ignore";
}

/** Whether `file` is one of `entries`, or under one of the directories among them. */
function _within(file: string, entries: readonly string[]): boolean {
  return entries.some((entry) =>
    entry.endsWith("/") ? file.startsWith(entry) || file === entry.slice(0, -1) : file === entry,
  );
}
