/**
 * Global DI helpers — `make()` resolves from the container, `app()` returns the
 * running application kernel. Thin wrappers over the {@link App} facade so app
 * code can resolve dependencies without importing `Application` directly.
 */
import type { Application } from "../application/Application.ts";
import { currentApp } from "../application/currentApp.ts";
import { App } from "../facade/facades/App.ts";
import type { BindingToken } from "../container/types.ts";

/**
 * Resolve a binding — or auto-wire a class via its `@inject()`
 * metadata — from the application container.
 *
 * @example
 * const users = await make(UsersService);
 * const events = await make("events");
 */
export function make<T>(token: BindingToken<T>): Promise<T> {
  return App.make(token);
}

/**
 * Return the running {@link Application} kernel, or — when passed a token —
 * resolve it from the container (`app(Token)`).
 *
 * @example
 * app().bind((c) => c.singleton(Clock, () => new SystemClock())); // kernel
 * const users = await app(UsersService);                          // resolve
 */
export function app(): Application;
export function app<T>(token: BindingToken<T>): Promise<T>;
export function app<T>(token?: BindingToken<T>): Application | Promise<T> {
  return token === undefined ? currentApp() : App.make(token);
}
