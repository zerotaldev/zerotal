/**
 * The framework's IoC container: registers bindings (transient, singleton,
 * scoped, value), resolves them with auto-wiring and cycle detection, and
 * manages per-request scopes through AsyncLocalStorage.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Binding,
  BindingToken,
  ContainerBindings,
  Factory,
  SingletonBinding,
  TransientBinding,
  ScopedBinding,
  ValueBinding,
} from "./types.ts";
import { ScopedResolver } from "./ScopedResolver.ts";
import { ContextualBindingBuilder } from "./ContextualBindingBuilder.ts";
import { injectRegistry } from "./inject.ts";
import {
  BindingNotFoundError,
  ScopedOutsideRequestError,
  SyncResolutionError,
  CircularDependencyError,
} from "../errors/ContainerErrors.ts";

/**
 * Registers and resolves bindings, with auto-wiring, scopes, and contextual overrides.
 *
 * The container is the framework's IoC core. Register how a token is built with
 * {@link bind} (transient), {@link singleton}, {@link scoped}, or {@link value},
 * then resolve it with {@link make}. Classes with declared dependencies
 * (`@inject()`) are auto-wired without an explicit binding.
 *
 * @remarks
 * Resolution is async-first: prefer {@link make} everywhere and reserve
 * {@link makeSync} for Facade accessors where the singleton has already been
 * pre-resolved. Scoped bindings only resolve inside a request scope opened by
 * {@link runScoped}; resolving one elsewhere throws {@link ScopedOutsideRequestError}.
 *
 * @example
 * ```ts
 * class Config {}
 * class Db {}
 *
 * const container = Container.createEmpty();
 *
 * container.bind(Db, () => new Db());                 // new instance each make()
 * container.singleton(Config, () => new Config());    // built once, cached
 * container.value("appName", "zerotal");               // pre-built value
 *
 * const db = await container.make(Db);
 * const config = await container.make(Config);
 * ```
 */
export class Container {
  // ── Internal state ────────────────────────────────────────────────────
  registry = new Map<unknown, Binding<unknown>>();
  private aliases = new Map<unknown, unknown>();
  private contextual = new Map<unknown, Map<unknown, Binding<unknown>>>();
  private resolvingHooks = new Map<unknown, Array<(i: unknown) => void>>();
  private deferred = new Map<unknown, new (app: unknown) => unknown>();
  // Pending singleton resolutions — prevents concurrent double-factory-call
  private pending = new Map<unknown, Promise<unknown>>();
  // Per-request scoped resolver, stored in AsyncLocalStorage so concurrent
  // requests each see their own isolated instance with no shared mutable state.
  private readonly _scopedStore = new AsyncLocalStorage<ScopedResolver>();
  /** @internal Set by `Application.boot()`; used to boot deferred providers. */
  _app: import("../application/Application.ts").Application | undefined = undefined;

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register a transient binding — the factory runs on every resolution.
   *
   * @category Binding
   * @example
   * ```ts
   * container.bind(Uuid, () => new Uuid(crypto.randomUUID()));
   * const a = await container.make(Uuid);
   * const b = await container.make(Uuid); // a !== b
   * ```
   */
  bind<T>(token: BindingToken<T>, factory: Factory<T>): this {
    this.registry.set(token, { kind: "transient", factory } satisfies TransientBinding<T>);
    return this;
  }

  /**
   * Register a singleton binding — resolved once and cached for the process lifetime.
   *
   * @remarks
   * The factory receives the container so it can resolve its own dependencies.
   * Concurrent first resolutions share a single in-flight promise, so the
   * factory runs exactly once even under parallel `make()` calls.
   *
   * @category Binding
   * @example
   * ```ts
   * container.singleton("config", (c) => new ConfigManager());
   * const config = await container.make("config"); // same instance every time
   * ```
   */
  singleton<T>(token: BindingToken<T>, factory: Factory<T>): this {
    this.registry.set(token, {
      kind: "singleton",
      factory,
      instance: undefined,
      resolved: false,
    } satisfies SingletonBinding<T>);
    return this;
  }

  /**
   * Register a scoped binding — resolved once per request scope.
   *
   * @remarks
   * Resolving a scoped token outside a request scope (see {@link runScoped})
   * throws {@link ScopedOutsideRequestError}.
   *
   * @category Binding
   */
  scoped<T>(token: BindingToken<T>, factory: Factory<T>): this {
    this.registry.set(token, { kind: "scoped", factory } satisfies ScopedBinding<T>);
    return this;
  }

  /**
   * Register an already-constructed value under `token`.
   *
   * @remarks
   * Value bindings are the only kind (besides an already-resolved singleton)
   * that {@link makeSync} can return.
   *
   * @category Binding
   */
  value<T>(token: BindingToken<T>, instance: T): this {
    this.registry.set(token, { kind: "value", instance } satisfies ValueBinding<T>);
    return this;
  }

  /**
   * Make resolving `from` resolve `to` instead. Alias chains are followed transitively.
   *
   * @category Binding
   * @example
   * ```ts
   * container.singleton(FileLogger, () => new FileLogger());
   * container.alias("log", FileLogger);
   * const log = await container.make("log"); // resolves FileLogger
   * ```
   */
  alias(from: unknown, to: unknown): this {
    this.aliases.set(from, to);
    return this;
  }

  /**
   * Register a hook fired with each freshly constructed instance of `token`.
   *
   * @remarks
   * The hook runs after construction on every fresh instance — so once per
   * process for a singleton, and on each resolution for a transient. It does not
   * fire for an already-cached singleton or value.
   *
   * @category Lifecycle hooks
   * @example
   * ```ts
   * container.resolving(Mailer, (mailer) => mailer.setFrom("noreply@example.com"));
   * ```
   */
  resolving<T>(token: BindingToken<T>, hook: (instance: T) => void): this {
    const existing = this.resolvingHooks.get(token) ?? [];
    existing.push(hook as (instance: unknown) => void);
    this.resolvingHooks.set(token, existing);
    return this;
  }

  /**
   * Begin a contextual binding so `consumer` receives a tailored dependency.
   *
   * @category Binding
   * @example
   * ```ts
   * // ReportService gets a FixedClock; everyone else gets the default Clock.
   * container.singleton(Clock, () => new SystemClock());
   * container.for(ReportService).give(Clock, () => new FixedClock());
   * ```
   */
  for<C>(consumer: BindingToken<C>): ContextualBindingBuilder<C> {
    return new ContextualBindingBuilder(this, consumer);
  }

  /**
   * Defer a provider so it boots lazily the first time `token` is resolved.
   *
   * @remarks
   * Booting the provider (its `onRegister`/`onBooting`/`onBooted` hooks) only
   * runs when {@link Container._app} is set, i.e. inside a real application boot.
   *
   * @category Binding
   */
  defer(token: unknown, provider: new (app: unknown) => unknown): this {
    this.deferred.set(token, provider);
    return this;
  }

  // ── Resolution — public surface ───────────────────────────────────────

  /**
   * Resolve a binding asynchronously.
   * This is the primary resolution method. Always use this over makeSync()
   * unless you have pre-resolved the singleton during onBooting().
   *
   * @param token - The class, abstract class, or registry key to resolve.
   * @param consumer - Optional resolving consumer, used to apply a contextual
   *   override registered via {@link for}.
   * @returns The resolved instance.
   * @throws {BindingNotFoundError} When no binding exists and the token cannot be auto-wired.
   * @throws {CircularDependencyError} When resolving `token` re-enters itself through its dependency chain.
   * @throws {ScopedOutsideRequestError} When `token` is a scoped binding resolved outside a request scope.
   * @category Resolution
   * @example
   * ```ts
   * const users = await container.make(UserService);
   * const config = await container.make("config");
   * ```
   */
  async make<T>(token: BindingToken<T>, consumer?: unknown): Promise<T> {
    return this._make<T>(token, consumer, []);
  }

  /**
   * Resolve a binding synchronously.
   * Only works for: value bindings, and singleton bindings already resolved.
   * Throws SyncResolutionError for everything else.
   * Use this exclusively in Facade accessors — after onBooting() has run.
   *
   * @throws {BindingNotFoundError} When no binding is registered for the token.
   * @throws {SyncResolutionError} When the binding is a not-yet-resolved singleton, or is transient/scoped (which cannot resolve synchronously).
   * @category Resolution
   */
  makeSync<T>(token: BindingToken<T>): T {
    const canonical = this._resolveAlias(token);
    const binding = this.registry.get(canonical);

    if (!binding) {
      throw new BindingNotFoundError(
        typeof canonical === "function" ? canonical.name : String(canonical),
      );
    }

    if (binding.kind === "value") return binding.instance as T;

    if (binding.kind === "singleton") {
      if (binding.resolved) return binding.instance as T;
      throw new SyncResolutionError(
        `Singleton '${String(canonical)}' has not been resolved yet. ` +
          `Pre-resolve it in a ServiceProvider's onBooting() method before making sync calls.`,
      );
    }

    throw new SyncResolutionError(
      `'${String(canonical)}' cannot be resolved synchronously. ` +
        `Use make() instead, or pre-resolve in a ServiceProvider.`,
    );
  }

  /**
   * Construct a class by auto-wiring its declared dependencies (`@inject()`),
   * bypassing any registered binding for that token.
   *
   * Used by the `app/services` convention to build a fresh instance inside a
   * singleton/scoped factory without the factory shadowing auto-wiring.
   *
   * @throws {CircularDependencyError} When the class's dependency graph contains a cycle.
   * @category Resolution
   */
  async build<T>(ctor: new (...args: unknown[]) => T): Promise<T> {
    return this._autoWire<T>(ctor, []);
  }

  /**
   * Remove a binding. Returns `true` if a binding existed for the token.
   * Follows the alias chain so `forget(alias)` removes the canonical binding.
   *
   * @category Resolution
   */
  forget(token: BindingToken): boolean {
    return this.registry.delete(this._resolveAlias(token));
  }

  /**
   * Report whether a binding — or a deferred provider — exists for `token`,
   * **without constructing anything**. Follows the alias chain.
   *
   * Used by the boot-time doctor to verify that every token a provider names in
   * `static provides` is actually wired.
   *
   * @category Resolution
   */
  bound(token: BindingToken): boolean {
    const canonical = this._resolveAlias(token);
    return this.registry.has(canonical) || this.deferred.has(canonical);
  }

  /**
   * Report whether `token` resolves through a deferred provider (booted lazily
   * on first `make()`), as opposed to an eagerly-registered binding. Follows the
   * alias chain.
   *
   * @category Resolution
   */
  isDeferred(token: BindingToken): boolean {
    return this.deferred.has(this._resolveAlias(token));
  }

  // ── Resolution — private implementation ──────────────────────────────

  /**
   * Internal recursive resolver. _chain is an immutable array that travels
   * down the call chain to detect circular dependencies.
   * NEVER stored on the instance — safe under concurrent async calls.
   */
  private async _make<T>(
    token: BindingToken<T>,
    consumer: unknown,
    _chain: readonly unknown[],
  ): Promise<T> {
    // Step 1: Resolve alias to canonical token
    const canonical = this._resolveAlias(token);

    // Step 2: Boot deferred provider if this token has one pending
    if (this.deferred.has(canonical)) {
      await this._bootDeferredProvider(canonical);
    }

    // Step 3: Check for contextual override for this specific consumer
    const binding =
      consumer !== undefined
        ? (this.contextual.get(this._resolveAlias(consumer as BindingToken))?.get(canonical) ??
          this.registry.get(canonical))
        : this.registry.get(canonical);

    if (binding) {
      return this._resolveBinding<T>(binding as Binding<T>, canonical, _chain);
    }

    // Step 4: Attempt auto-wiring via @inject() metadata
    const ctor = canonical as new (...args: unknown[]) => T;
    if (typeof canonical === "function" && injectRegistry.has(ctor)) {
      return this._autoWire<T>(ctor, _chain);
    }

    throw new BindingNotFoundError(
      typeof canonical === "function" ? canonical.name : String(canonical),
    );
  }

  private async _resolveBinding<T>(
    binding: Binding<T>,
    token: unknown,
    _chain: readonly unknown[],
  ): Promise<T> {
    let instance: T;

    switch (binding.kind) {
      case "value":
        instance = binding.instance;
        break;

      case "singleton":
        if (binding.resolved) {
          instance = binding.instance!;
        } else {
          instance = await this._resolveWithLock(binding, this._guardCycle(token, _chain));
        }
        break;

      case "scoped": {
        const scoped = this._scopedStore.getStore();
        if (!scoped) {
          throw new ScopedOutsideRequestError(
            `Attempted to resolve a scoped binding outside of a request. ` +
              `Scoped bindings are only available inside Bun.serve() fetch handlers.`,
          );
        }
        const nextChain = this._guardCycle(token, _chain);
        instance = await scoped.resolve<T>(token, () => binding.factory(this._chained(nextChain)));
        break;
      }

      case "transient":
        instance = await Promise.resolve(
          binding.factory(this._chained(this._guardCycle(token, _chain))),
        );
        break;
    }

    // Fire resolving() hooks after construction
    const hooks = this.resolvingHooks.get(token);
    if (hooks) hooks.forEach((hook) => hook(instance));

    return instance;
  }

  /**
   * Singleton concurrency lock.
   * If two concurrent make() calls both find resolved=false, only one runs
   * the factory. The second waits on the same promise via this.pending.
   */
  private async _resolveWithLock<T>(
    binding: SingletonBinding<T>,
    _chain: readonly unknown[],
  ): Promise<T> {
    if (this.pending.has(binding)) {
      return this.pending.get(binding) as Promise<T>;
    }

    const promise = Promise.resolve(binding.factory(this._chained(_chain)))
      .then((instance) => {
        binding.instance = instance;
        binding.resolved = true;
        return instance;
      })
      .finally(() => {
        // Always clear the lock — a factory that rejects must be retryable on
        // the next make() instead of caching the rejection forever.
        this.pending.delete(binding);
      });

    this.pending.set(binding, promise);
    return promise;
  }

  /**
   * Throw {@link CircularDependencyError} when `token` is already being
   * resolved somewhere up the current chain, otherwise return the extended
   * chain (a NEW array — `_chain` is never mutated, keeping resolution safe
   * under concurrent async calls).
   */
  private _guardCycle(token: unknown, _chain: readonly unknown[]): readonly unknown[] {
    if (_chain.includes(token)) {
      const errorChain = [..._chain, token].map((entry) =>
        typeof entry === "function" ? entry.name : String(entry),
      );
      throw new CircularDependencyError(errorChain);
    }
    return [..._chain, token];
  }

  /**
   * A lightweight view of this container whose `make()` threads the current
   * resolution chain. Passed to binding factories so that factories which
   * `await container.make(...)` participate in cycle detection — two factories
   * awaiting each other throw {@link CircularDependencyError} instead of
   * deadlocking. Everything else delegates to the real container via the
   * prototype chain; no state lives on the view itself.
   */
  private _chained(chain: readonly unknown[]): Container {
    const chained = Object.create(this) as Container;
    chained.make = <T>(token: BindingToken<T>, consumer?: unknown): Promise<T> =>
      this._make<T>(token, consumer, chain);
    return chained;
  }

  /**
   * Auto-wire a class by reading its @inject() metadata.
   * _chain is immutable — each recursive call creates a new array.
   * No instance-level stack → safe under concurrent async resolution.
   */
  private async _autoWire<T>(
    token: new (...args: unknown[]) => T,
    _chain: readonly unknown[],
  ): Promise<T> {
    // Cycle check + build next chain — new array, never mutates _chain
    const nextChain = this._guardCycle(token, _chain);

    const deps: BindingToken[] = (injectRegistry.get(token) as BindingToken[] | undefined) ?? [];

    // Resolve all dependencies in parallel, each carrying nextChain
    const resolvedDeps = await Promise.all(deps.map((dep) => this._make(dep, token, nextChain)));

    const instance = new token(...resolvedDeps);

    const hooks = this.resolvingHooks.get(token);
    if (hooks) hooks.forEach((hook) => hook(instance));

    return instance;
  }

  private async _bootDeferredProvider(token: unknown): Promise<void> {
    const ProviderClass = this.deferred.get(token);
    if (!ProviderClass) return;

    // Remove from deferred map so this only runs once
    this.deferred.delete(token);

    const app = this._app;
    if (!app) return; // no app context — skip (unit test scenario)

    const provider = new (
      ProviderClass as new (
        app: unknown,
      ) => import("../provider/ServiceProvider.ts").ServiceProvider
    )(app);

    provider.onRegister();
    await provider.onBooting();
    await provider.onBooted();

    // Track so stop() can call onStopping/onStopped
    app._activeProviders.push(provider);
  }

  // ── Scoped resolver lifecycle ─────────────────────────────────────────

  /**
   * Run `callback` inside a fresh request scope.
   *
   * A new `ScopedResolver` is created for the duration of the call and stored
   * in `AsyncLocalStorage` so every `container.make()` for a scoped binding
   * resolves against **this** scope — even across `await` boundaries and even
   * when multiple requests are in flight concurrently.  The resolver is flushed
   * (cache cleared) in a `finally` block, and the ALS entry is garbage-collected
   * automatically when the async context exits.  There is no shared mutable
   * state on the container and therefore no possibility of cross-request leaks.
   *
   * @param callback  Receives the resolver so the caller can pass it to
   *                  `HttpContext` (and therefore to `afterResponse()` hooks).
   * @category Scopes
   * @example
   * ```ts
   * await container.runScoped(async (scoped) => {
   *   // scoped bindings resolve to per-request instances inside here
   *   const session = await container.make(RequestSession);
   *   return handle(session);
   * });
   * ```
   */
  runScoped<T>(callback: (scoped: ScopedResolver) => Promise<T>): Promise<T> {
    const scoped = new ScopedResolver(this);
    return this._scopedStore.run(scoped, () => callback(scoped).finally(() => scoped.flush()));
  }

  /**
   * Create a bare `ScopedResolver` without entering an ALS context.
   * Useful in unit tests that call `scoped.resolve()` directly and do not
   * need `container.make()` to route through the ALS store.
   *
   * @category Scopes
   */
  createScopedResolver(): ScopedResolver {
    return new ScopedResolver(this);
  }

  // ── Contextual binding internals ──────────────────────────────────────

  /** @internal Record a contextual binding for `consumer`; called by `ContextualBindingBuilder`. */
  _setContextual(consumer: unknown, dependency: unknown, binding: Binding<unknown>): void {
    if (!this.contextual.has(consumer)) {
      this.contextual.set(consumer, new Map());
    }
    this.contextual.get(consumer)!.set(dependency, binding);
  }

  /** @internal Follow the alias chain to the canonical token, guarding against cycles. */
  _resolveAlias(token: unknown): unknown {
    let current = token;
    const visited = new Set<unknown>();
    while (this.aliases.has(current)) {
      if (visited.has(current)) break;
      visited.add(current);
      current = this.aliases.get(current);
    }
    return current;
  }

  /**
   * Attempt to resolve a binding synchronously.
   * Returns undefined instead of throwing if the key is not registered.
   * Used by providers to check whether CommandRunner exists
   * (it only does in console mode, not web mode).
   *
   * @category Resolution
   */
  tryMake<K extends keyof ContainerBindings>(token: K): ContainerBindings[K] | undefined {
    if (!this.registry.has(token as unknown)) return undefined;
    try {
      return this.makeSync(token) as ContainerBindings[K];
    } catch {
      return undefined;
    }
  }

  // ── Static factory ─────────────────────────────────────────────────────

  /**
   * Create a fresh container with no bindings registered.
   *
   * @category Binding
   */
  static createEmpty(): Container {
    return new Container();
  }
}
