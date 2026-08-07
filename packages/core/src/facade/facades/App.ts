/**
 * The `App` facade — static-style access to the running {@link Application}
 * kernel and its IoC container.
 *
 * Resolves the live application singleton on every call, so it holds no
 * module-level state and is safe to import anywhere. Every method throws if
 * accessed before `Application.create()` (and, for resolution, `boot()`) has
 * run, mirroring the behaviour of the other framework facades.
 *
 * Registration methods (`bind` / `singleton` / `scoped` / `value` / `alias` /
 * `forget`) are **boot-time only**: once `boot()` completes the container is
 * locked and they throw {@link ContainerLockedError}, because mutating the
 * process-global container at request time would leak state across concurrent
 * requests. Register during boot (bootstrap `app.bind()`, a `ServiceProvider`,
 * or the `app/services` convention) and use a `scoped` binding for per-request
 * state.
 */
import type { Application } from "../../application/Application.ts";
import { currentApp } from "../../application/currentApp.ts";
import type { Container } from "../../container/Container.ts";
import type { BindingToken, ContainerBindings, Factory } from "../../container/types.ts";
import { ContainerLockedError } from "../../errors/ContainerErrors.ts";

/**
 * Return the live container, throwing {@link ContainerLockedError} when the
 * application has already booted. Used to gate every registration method.
 */
function _unlockedContainer(method: string): Container {
  const app = currentApp();
  if (app.booted) throw new ContainerLockedError(method);
  return app.container;
}

/**
 * Static facade for the application container.
 *
 * @example
 * ```ts
 * // Auto-wire a service class (resolves its @inject() graph):
 * const users = await App.make(UsersService);
 *
 * // Resolve a named binding:
 * const events = await App.make("events");
 *
 * // Register during boot (bootstrap/app.ts or a provider):
 * App.singleton(Clock, () => new SystemClock());
 * ```
 */
export const App = {
  // ── Introspection ─────────────────────────────────────────────────────

  /** The live IoC container of the running application. */
  get container(): Container {
    return currentApp().container;
  },

  /** The running {@link Application} instance. */
  instance(): Application {
    return currentApp();
  },

  /** The runtime environment: "web" | "console" | "worker" | "test" | "repl". */
  environment(): Application["environment"] {
    return currentApp().environment;
  },

  /** Whether the configured `app.env` is a production environment. */
  isProduction(): boolean {
    return ["production", "prod"].includes(_appEnv());
  },

  /** Whether the configured `app.env` is a local/development environment. */
  isLocal(): boolean {
    return ["local", "development", "dev"].includes(_appEnv());
  },

  // ── Resolution ────────────────────────────────────────────────────────

  /**
   * Resolve a binding — or auto-wire a class via its `@inject()`
   * metadata — from the container asynchronously. This is the primary
   * resolution method.
   */
  make<T>(token: BindingToken<T>, consumer?: unknown): Promise<T> {
    return currentApp().container.make(token, consumer);
  },

  /**
   * Resolve a binding synchronously. Only works for value bindings and
   * already-resolved singletons; throws otherwise. Prefer {@link App.make}.
   */
  makeSync<T>(token: BindingToken<T>): T {
    return currentApp().container.makeSync(token);
  },

  /**
   * Construct a class by auto-wiring its dependencies, ignoring any registered
   * binding for that token. Returns a brand-new instance every call.
   */
  build<T>(ctor: new (...args: unknown[]) => T): Promise<T> {
    return currentApp().container.build(ctor);
  },

  /**
   * Resolve a named binding without throwing — returns `undefined` when the
   * token is not registered or cannot be resolved synchronously.
   */
  tryMake<K extends keyof ContainerBindings>(token: K): ContainerBindings[K] | undefined {
    return currentApp().container.tryMake(token);
  },

  /** Whether a token is registered in the container. */
  bound(token: BindingToken): boolean {
    const container = currentApp().container;
    return container.registry.has(container._resolveAlias(token));
  },

  // ── Registration (boot-time only) ─────────────────────────────────────

  /** Register a transient binding — the factory runs on every resolution. */
  bind<T>(token: BindingToken<T>, factory: Factory<T>): Container {
    return _unlockedContainer("bind").bind(token, factory);
  },

  /** Register a singleton binding — resolved once and cached for the process lifetime. */
  singleton<T>(token: BindingToken<T>, factory: Factory<T>): Container {
    return _unlockedContainer("singleton").singleton(token, factory);
  },

  /** Register a request-scoped binding — resolved once per request scope. */
  scoped<T>(token: BindingToken<T>, factory: Factory<T>): Container {
    return _unlockedContainer("scoped").scoped(token, factory);
  },

  /** Register an already-constructed value under `token`. */
  value<T>(token: BindingToken<T>, instance: T): Container {
    return _unlockedContainer("value").value(token, instance);
  },

  /** Make resolving `from` resolve `to` instead. */
  alias(from: unknown, to: unknown): Container {
    return _unlockedContainer("alias").alias(from, to);
  },

  /** Remove a binding. Returns `true` if a binding existed for the token. */
  forget(token: BindingToken): boolean {
    return _unlockedContainer("forget").forget(token);
  },
} as const;

/** Read the configured `app.env`, defaulting to "development" when unavailable. */
function _appEnv(): string {
  const config = currentApp().container.tryMake("config");
  return config?.get<string>("app.env", "development") ?? "development";
}
