/**
 * The registry of generated-type files that `bun zt route:types` refreshes.
 *
 * Route names are not the only thing a Zerotal app generates from its own
 * filesystem — `@zerotal/inertia` emits a page registry that gives
 * `Inertia.render(name, props)` its typed page names. Both answer the same
 * question ("what does the tree contain, as types?"), both go stale the moment
 * a file is added, and `route:types` is the command whose name says it fixes
 * that. It used to fix only half of it: adding a page and running `route:types`
 * left the page registry stale, and the resulting error —
 *
 *   TS2345: Argument of type '"ops/orders"' is not assignable to 'PageName'
 *
 * — reads as "you typed the name wrong" rather than "nothing has regenerated
 * the registry since you added the file", which sends you looking at the name.
 *
 * A view package registers its routine here from provider boot, so
 * `@zerotal/core` never imports `@zerotal/inertia` (which would be circular).
 * This mirrors `registerDevBuildHook` in `../dev/DevBuildHook.ts`, for the same
 * reason and with the same shape.
 */

/**
 * What one generator wrote, for the command's summary output.
 *
 * @internal Part of the {@link registerTypeGenerator} contract, like
 * {@link TypeGeneratorFn} — framework-package plumbing, not app-facing API.
 */
export interface TypeGeneratorResult {
  /** The file written, relative to the project root. */
  file: string;
  /** What it contains, phrased for a summary line (e.g. `12 pages`). */
  summary: string;
  /**
   * Whether the file on disk differed from what the routine produced. Drives
   * `route:types --check`, and lets the command say "Unchanged" rather than
   * claiming a write it did not need to make.
   */
  changed: boolean;
}

/**
 * A generated-types routine. `check` asks it to compare against disk and report,
 * without writing — the CI gate that keeps a committed generated file honest.
 *
 * @internal
 */
export type TypeGeneratorFn = (options: { check: boolean }) => Promise<TypeGeneratorResult>;

const _generators = new Map<string, TypeGeneratorFn>();

/**
 * @internal Exported for view packages to wire their codegen into `route:types`.
 *
 * Register a generated-types routine under a package name. Registering the same
 * name twice replaces the earlier routine, so a provider may safely register on
 * every boot.
 */
export function registerTypeGenerator(name: string, fn: TypeGeneratorFn): void {
  _generators.set(name, fn);
}

/** @internal Forget every registered routine (tests only). */
export function _resetTypeGenerators(): void {
  _generators.clear();
}

/**
 * @internal Run every registered routine, in registration order.
 *
 * One routine throwing does not stop the others — a broken page registry should
 * not cost you your route types — but the error is returned rather than
 * swallowed, so the command can report it and exit non-zero.
 */
export async function _runTypeGenerators(options: {
  check: boolean;
}): Promise<{ name: string; result?: TypeGeneratorResult; error?: unknown }[]> {
  const outcomes: { name: string; result?: TypeGeneratorResult; error?: unknown }[] = [];
  for (const [name, fn] of _generators) {
    try {
      outcomes.push({ name, result: await fn(options) });
    } catch (error) {
      outcomes.push({ name, error });
    }
  }
  return outcomes;
}
