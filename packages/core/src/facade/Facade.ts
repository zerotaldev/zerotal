/**
 * The facade factory: wraps a named container binding in a Proxy so it can be
 * used like a static object while still resolving lazily from the live
 * container on every access.
 */
import type { Application } from "../application/Application.ts";
import { currentApp } from "../application/currentApp.ts";
import type { ContainerBindings } from "../container/types.ts";
import {
  FacadeAccessedBeforeBootError,
  FacadeBindingMissingError,
} from "../errors/ContainerErrors.ts";

/**
 * Create a typed facade over a named container binding.
 *
 * The returned object delegates every property access to the live instance
 * resolved from the container **on each access** — lazy, never cached at
 * module load time.  This means:
 *
 *  - Importing `Config` before `Application.boot()` is safe.
 *  - The binding is always the most recently registered singleton.
 *
 * Prerequisites:
 *  - `Application.create()` must have been called.
 *  - The singleton must have been pre-resolved (e.g. via `make()` in
 *    `onBooting()`) because `makeSync()` only works for resolved singletons.
 *
 * Methods are automatically bound to the live instance so `this` is correct
 * inside them regardless of how the caller stores the reference.
 *
 * @param key  The container binding name the facade resolves on each access.
 * @returns A proxy typed as the bound instance; every access resolves live.
 * @throws {FacadeAccessedBeforeBootError} If accessed before the application is
 * created (e.g. at module scope on import).
 * @throws {FacadeBindingMissingError} If the application exists but no binding is
 * registered for `key` (a missing ServiceProvider).
 *
 * @example
 * ```ts
 * // packages/core/src/facade/facades/Config.ts
 * export const Config = createFacade('config');
 *
 * // Anywhere in the application (after boot):
 * Config.get('app.name');
 * await Events.emit(new UserRegistered(id));
 * ```
 */
/**
 * Properties the language itself probes, which must never resolve the binding.
 *
 * Returning a facade from an `async` function makes the runtime read `.then` to
 * decide whether it is a thenable. Answering that with a container lookup meant
 * a facade could not be returned from an async function at all without throwing
 * — from inside promise resolution, with a stack pointing at the proxy rather
 * than at the caller. `Symbol.toPrimitive` and friends are the same trap for
 * string coercion and inspection.
 */
const _PROBES: Array<string | symbol> = [
  "then",
  "catch",
  "finally",
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  "inspect",
  "constructor",
  "nodejs.util.inspect.custom",
];

export function createFacade<K extends keyof ContainerBindings>(key: K): ContainerBindings[K] {
  return new Proxy({} as ContainerBindings[K], {
    get(_target, prop: string | symbol) {
      // A probe is the runtime asking what this object *is*, not the application
      // asking the binding to do something. Answer "nothing special" without
      // touching the container.
      if (_PROBES.includes(prop)) return undefined;

      // Distinguish "app not created yet" (module-scope misuse) from "binding not
      // registered" (a missing ServiceProvider) — they need very different fixes.
      let app: Application;
      try {
        app = currentApp();
      } catch {
        throw new FacadeAccessedBeforeBootError(String(key));
      }
      let instance: ContainerBindings[K];
      try {
        instance = app.container.makeSync(key);
      } catch {
        throw new FacadeBindingMissingError(String(key));
      }
      const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(instance);
      }
      return value;
    },
  });
}
