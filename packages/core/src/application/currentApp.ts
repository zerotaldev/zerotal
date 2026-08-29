/**
 * The single ambient lookup in the framework: `currentApp()`.
 *
 * Everything that "feels global" — facades, `config()`, `Router.get(...)` sugar —
 * is a thin window onto one owned, instance-scoped {@link Application}, reached
 * through exactly one door. There is one process **default** application (set by
 * {@link Application.create}), overridable within an {@link withApp} scope so two
 * apps can coexist in one process (embedded test harnesses, multi-tenant control
 * planes, migrating against a second app's config).
 *
 * The accessor consults the {@link withApp} scope first, then the process
 * default. This is the only ambient app reference in the framework.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Application } from "./Application.ts";

/** The process-default application. Set by {@link Application.create}; cleared on reset. */
let _default: Application | undefined;

/**
 * Per-scope override. Code running inside {@link withApp} sees that app as the
 * current one, so ambient lookups resolve to it instead of the process default.
 */
const _scope = new AsyncLocalStorage<Application>();

/** @internal Set (or clear) the process-default application. Called by the application lifecycle. */
export function setDefaultApp(app: Application | undefined): void {
  _default = app;
}

/** @internal The process-default application, or `undefined` when none has been created. */
export function defaultApp(): Application | undefined {
  return _default;
}

/**
 * The current application — the framework's one ambient accessor.
 *
 * Resolution order: the {@link withApp} scope override, then the process default.
 *
 * @throws {Error} when no application is available (none created and not inside a
 * {@link withApp} scope).
 */
export function currentApp(): Application {
  const app = _scope.getStore() ?? _default;
  if (!app) {
    throw new Error(
      "No current application. Call Application.create() first, or run inside withApp(app, …).",
    );
  }
  return app;
}

/**
 * The current application, or `undefined` when none is available. Safe off-app (CLI bootstrap, tests).
 *
 * @internal
 */
export function tryCurrentApp(): Application | undefined {
  return _scope.getStore() ?? _default;
}

/**
 * Run `fn` with `app` as the current application for the duration of the call —
 * and everything it `await`s — overriding the process default within this scope.
 * The override is confined to the async context, so concurrent scopes never leak
 * into one another.
 *
 * @example
 * ```ts
 * // Run a migration against a second app's config without disturbing the default.
 * await withApp(secondApp, () => secondApp.container.make("db"));
 * ```
 *
 * @internal
 */
export function withApp<T>(app: Application, fn: () => T): T {
  return _scope.run(app, fn);
}
