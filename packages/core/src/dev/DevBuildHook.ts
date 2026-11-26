/**
 * The registry of frontend build routines used in dev mode. Lets view packages
 * (`@zerotal/inertia`, `@zerotal/flow`) hand their build routine to the core
 * DevOrchestrator without core importing them, avoiding a circular dependency.
 *
 * The registry holds one entry per package rather than a single routine,
 * because an app can run more than one view layer at a time — an Inertia app
 * that installs `@zerotal/monitor` pulls in Flow for the monitor panel, and
 * both have a bundle to build. With a single slot the provider that booted last
 * would silently replace the other's build, and the displaced package's assets
 * would sit frozen at whatever the last manual build left on disk while the dev
 * server cheerfully reported "rebuilding… ✓ ready" on every change.
 */

/**
 * Outcome of a frontend build: whether it succeeded and any collected logs.
 *
 * @internal
 */
export interface BuildResult {
  success: boolean;
  logs?: unknown[];
  /**
   * True when every registered routine skipped — nothing had changed since the
   * last build. Reported so the dev log can say so: a developer who saves a file
   * and sees no rebuild, with no explanation, deletes `.zerotal/` and stops
   * trusting the tool.
   */
  skipped?: boolean;
}

/**
 * A frontend build routine that resolves once the build finishes.
 *
 * @internal
 */
export type BuildHookFn = () => Promise<BuildResult>;

const _hooks = new Map<string, BuildHookFn>();

/**
 * @internal Exported for view packages to wire their dev build into core.
 *
 * Register a frontend build routine for dev mode under a package name.
 * Registering the same name twice replaces the earlier routine, so a provider
 * may safely register on every boot.
 *
 * Called from provider boot (e.g. `InertiaProvider.onBooted()`) so the core
 * DevOrchestrator can trigger a build without `@zerotal/core` importing the
 * view package (which would create a circular dependency).
 */
export function registerDevBuildHook(name: string, fn: BuildHookFn): void {
  _hooks.set(name, fn);
}

/** @internal Whether any package has a dev build routine registered. */
export function hasDevBuildHooks(): boolean {
  return _hooks.size > 0;
}

/** @internal Forget every registered routine (tests only). */
export function _resetDevBuildHooks(): void {
  _hooks.clear();
}

/**
 * @internal One line for a bundler message: where it is, then what it says.
 *
 * `String()` of a `Bun.build()` message is only `BuildMessage: Unexpected ;`; the file, line and
 * column sit on its `position`, and without them a failed rebuild names nothing to open.
 *
 * @param entry - A `Bun.build()` log entry, or anything a build routine reported.
 * @returns `file:line:column message`, or the entry as text when it carries no position.
 */
export function _describeBuildLog(entry: unknown): string {
  if (entry === null || typeof entry !== "object") return String(entry);
  const { message, position } = entry as {
    message?: unknown;
    position?: { file?: unknown; line?: unknown; column?: unknown } | null;
  };
  if (typeof message !== "string") return String(entry);
  if (!position || typeof position.file !== "string" || position.file === "") return message;
  const line = Number(position.line);
  if (line > 0) return `${position.file}:${line}:${String(position.column)} ${message}`;
  // An error a plugin throws (the `.vue` compiler's, say) reaches Bun with no place of its own,
  // so its position is `0:0`, and `index.vue:0:0 … (12:15)` sent a developer to the top of the
  // file. The compiler puts the place in the message instead, as `(line:column)` at the end of
  // its first line; read it from there.
  const [first = "", ...rest] = message.split("\n");
  const at = /\s*\((\d+):(\d+)\)\s*$/.exec(first);
  if (!at) return `${position.file} ${message}`;
  const text = [first.slice(0, at.index), ...rest].join("\n");
  return `${position.file}:${at[1]}:${at[2]} ${text}`;
}

/**
 * @internal The lines a thrown build error should print.
 *
 * `Bun.build()` throws an `AggregateError` whose message is only "Bundle failed"; the reasons are
 * its `errors`. Printing the error alone told a developer that the bundle failed and nothing about
 * why, while the server went on serving the last good one.
 *
 * @param error - Whatever a build routine threw.
 * @returns One line per reason, or the error itself when it carries none.
 */
export function _describeBuildFailure(error: unknown): string[] {
  const reasons = (error as { errors?: unknown } | null)?.errors;
  if (Array.isArray(reasons) && reasons.length > 0) return reasons.map(_describeBuildLog);
  return [String(error)];
}

/**
 * @internal Run every registered build routine and merge the outcomes.
 *
 * Routines run concurrently — they write to separate output directories — and
 * one failing (or throwing) neither hides the others nor stops them. Logs are
 * tagged with the package name so a failure points at the build that produced it.
 */
export async function runDevBuildHooks(): Promise<BuildResult> {
  const results = await Promise.all(
    Array.from(_hooks, async ([name, fn]): Promise<BuildResult> => {
      try {
        const result = await fn();
        return {
          success: result.success,
          logs: (result.logs ?? []).map((l) => `[${name}] ${_describeBuildLog(l)}`),
          ...(result.skipped === true ? { skipped: true } : {}),
        };
      } catch (error) {
        return {
          success: false,
          logs: _describeBuildFailure(error).map((line) => `[${name}] ${line}`),
        };
      }
    }),
  );

  return {
    success: results.every((result) => result.success),
    logs: results.flatMap((result) => result.logs ?? []),
    // Only when *every* routine skipped: one bundle rebuilding is a rebuild.
    skipped: results.length > 0 && results.every((result) => result.skipped === true),
  };
}
