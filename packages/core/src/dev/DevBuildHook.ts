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
          logs: (result.logs ?? []).map((l) => `[${name}] ${l}`),
          ...(result.skipped === true ? { skipped: true } : {}),
        };
      } catch (error) {
        return { success: false, logs: [`[${name}] ${error}`] };
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
