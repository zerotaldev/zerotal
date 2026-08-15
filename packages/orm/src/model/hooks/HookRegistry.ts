import { AsyncLocalStorage } from "node:async_hooks";
import { currentOrmContext } from "../OrmContext.ts";
import type { ClassRef } from "../../support/classRef.ts";

/**
 * The set of model lifecycle points a hook can attach to. Each fires once per
 * persistence operation; `beforeSave`/`afterSave` wrap both inserts and updates,
 * and `afterFind` fires when a row is hydrated from the database.
 */
export type HookName =
  | "beforeCreate"
  | "afterCreate"
  | "beforeSave"
  | "afterSave"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "afterFind";

type HookFn<T> = (model: T) => Promise<void> | void;

function _registry(): Map<ClassRef, Map<HookName, HookFn<unknown>[]>> {
  return currentOrmContext().hooks as unknown as Map<ClassRef, Map<HookName, HookFn<unknown>[]>>;
}

/**
 * AsyncLocalStorage carrying a boolean that, when `true`, mutes all hook
 * and observer execution for the duration of the callback.
 *
 * Set by `_suppressHooks()` — used by factories to silence observers during
 * seeding. Opt out by calling `.dispatchEvents()` on the factory.
 */
const _suppressCtx = new AsyncLocalStorage<true>();

/**
 * Run `fn` with all model hooks and observers silenced.
 * Used internally by Factory when `dispatchEvents()` has NOT been called.
 */
export function _suppressHooks<T>(fn: () => Promise<T>): Promise<T> {
  return _suppressCtx.run(true, fn);
}

/**
 * Central store of per-model lifecycle hook callbacks, keyed by model class and
 * {@link HookName}. Hooks registered on a parent class also run for subclasses
 * (the prototype chain is walked in base-to-derived order).
 *
 * Registration is driven by higher-level APIs (model `beforeCreate()` etc. and the
 * observer bridge in {@link registerObserver}); most application code never calls
 * this class directly.
 *
 * @internal
 */
export class HookRegistry {
  /**
   * Optional post-run callback, invoked after a hook's functions run (and only when hooks
   * are not suppressed). BaseModel sets this to dispatch model events (`dispatchesEvents`).
   */
  static onAfterRun: ((ModelClass: ClassRef, hook: HookName, model: unknown) => void) | undefined;

  /**
   * Append a hook callback for a model class at a given lifecycle point.
   *
   * @param ModelClass - The model constructor the hook belongs to.
   * @param hook - Which lifecycle point to fire on.
   * @param fn - Callback receiving the model instance; may be async.
   */
  static register<T>(ModelClass: ClassRef, hook: HookName, fn: HookFn<T>): void {
    const registry = _registry();
    if (!registry.has(ModelClass)) {
      registry.set(ModelClass, new Map());
    }
    const hooks = registry.get(ModelClass)!;
    if (!hooks.has(hook)) hooks.set(hook, []);
    hooks.get(hook)!.push(fn as HookFn<unknown>);
  }

  /**
   * Run every registered callback for `hook` on `ModelClass`, awaiting each in
   * turn, walking the prototype chain base-to-derived. No-op while hooks are
   * suppressed (see {@link _suppressHooks}); otherwise invokes `onAfterRun` afterward.
   *
   * @param ModelClass - The model constructor whose hooks (and inherited hooks) to run.
   * @param hook - Which lifecycle point is firing.
   * @param model - The model instance passed to each callback.
   */
  static async run<T>(ModelClass: ClassRef, hook: HookName, model: T): Promise<void> {
    if (_suppressCtx.getStore()) return;

    // Walk the prototype chain to collect inherited hooks
    const chain: ClassRef[] = [];
    let cur: ClassRef | null = ModelClass;
    while (cur && cur !== Function.prototype) {
      chain.unshift(cur);
      cur = Object.getPrototypeOf(cur) as ClassRef | null;
    }

    const registry = _registry();
    for (const cls of chain) {
      const fns = registry.get(cls)?.get(hook);
      if (fns) {
        for (const fn of fns) {
          await fn(model as unknown);
        }
      }
    }

    HookRegistry.onAfterRun?.(ModelClass, hook, model as unknown);
  }
}
