import { HookRegistry, type HookName } from "./hooks/HookRegistry.ts";
import type { ClassRef } from "../support/classRef.ts";

/**
 * Observer interface — implement any subset of lifecycle methods to react to a
 * model's create / update / save / delete / retrieve events in one cohesive class.
 *
 * @remarks
 * Each method name maps to an internal {@link HookName}: `creating`→`beforeCreate`,
 * `created`→`afterCreate`, `updating`→`beforeUpdate`, `updated`→`afterUpdate`,
 * `saving`→`beforeSave`, `saved`→`afterSave`, `deleting`→`beforeDelete`,
 * `deleted`→`afterDelete`, and `retrieved`→`afterFind`. Methods may be async;
 * a `before*` method that throws aborts the operation.
 *
 * @typeParam T - The model type the observer watches.
 *
 * @example
 * export class UserObserver implements ModelObserver<User> {
 *   creating(user: User) { user.uuid = crypto.randomUUID(); }
 *   created(user: User)  { Log.info('User created', { id: user.id }); }
 *   deleting(user: User) { Log.info('Deleting user', { id: user.id }); }
 * }
 *
 * // Register once at boot (in a ServiceProvider)
 * User.observe(UserObserver);
 */
export interface ModelObserver<T = unknown> {
  creating?(model: T): Promise<void> | void;
  created?(model: T): Promise<void> | void;
  updating?(model: T): Promise<void> | void;
  updated?(model: T): Promise<void> | void;
  saving?(model: T): Promise<void> | void;
  saved?(model: T): Promise<void> | void;
  deleting?(model: T): Promise<void> | void;
  deleted?(model: T): Promise<void> | void;
  retrieved?(model: T): Promise<void> | void;
}

type ObserverClass<T> = new () => ModelObserver<T>;

// Maps observer lifecycle method names to internal HookName
const _methodToHook: Record<keyof ModelObserver, HookName> = {
  creating: "beforeCreate",
  created: "afterCreate",
  updating: "beforeUpdate",
  updated: "afterUpdate",
  saving: "beforeSave",
  saved: "afterSave",
  deleting: "beforeDelete",
  deleted: "afterDelete",
  retrieved: "afterFind",
};

/**
 * Register an observer class for a model: instantiate it once and wire each
 * implemented lifecycle method to its corresponding hook.
 *
 * Called by `BaseModel.observe(ObserverClass)`; app code normally uses that
 * rather than calling this directly.
 *
 * @param ModelClass - The model constructor to observe.
 * @param ObserverClass - An observer class (zero-arg constructor) implementing any subset of {@link ModelObserver}.
 * @internal
 */
export function registerObserver<T>(ModelClass: ClassRef, ObserverClass: ObserverClass<T>): void {
  const instance = new ObserverClass();

  for (const [method, hook] of Object.entries(_methodToHook) as [keyof ModelObserver, HookName][]) {
    const fn = instance[method] as ((m: T) => Promise<void> | void) | undefined;
    if (typeof fn === "function") {
      HookRegistry.register<T>(ModelClass, hook, fn.bind(instance));
    }
  }
}
