/**
 * The named rate-limiter registry and its fluent definition builder. Limiters
 * are defined once at boot (`RateLimiter.for('api').limit(…).register()`) and
 * later attached to routes or checked manually as `ThrottleMiddleware`.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { ThrottleMiddleware, _clientIp, _markIpDerived } from "./ThrottleMiddleware.ts";
import type { ThrottleOptions } from "./ThrottleMiddleware.ts";

/**
 * Fluent rate-limiter definition.
 * Build one via `RateLimiter.for('name')` then register with `.register()`.
 */
export class LimiterDefinition {
  private _max = 60;
  private _window = 60;
  private _trustedProxies?: number;

  /**
   * How this limiter keys its buckets, recorded rather than resolved.
   *
   * The built-in strategies all fall back to the client address, and resolving that
   * needs `trustedProxies` — which the fluent API may not have been told yet when
   * `.byIp()` runs. Keeping the *decision* here and building the resolver in
   * {@link toMiddlewareClass} means `.byIp().trustedProxies(1)` and
   * `.trustedProxies(1).byIp()` mean the same thing, which is the only defensible
   * answer for a builder.
   */
  private _key: KeyStrategy = { kind: "default" };

  constructor(private readonly _name: string) {}

  /** Maximum number of requests in the window. */
  limit(max: number): this {
    this._max = max;
    return this;
  }

  /** Window duration in seconds. */
  every(seconds: number): this {
    this._window = seconds;
    return this;
  }

  /**
   * Number of trusted reverse proxies in front of this server.
   *
   * Needed by every strategy that can fall back to the client address, which is all
   * the built-in ones. Without it the address used is the socket's — the *proxy's*,
   * behind a reverse proxy, so every visitor shares one bucket and the limiter
   * inverts into the thing it was installed to prevent.
   *
   * @param count - How many proxies sit in front; see {@link ThrottleOptions.trustedProxies}.
   *
   * @example
   * RateLimiter.for("login").limit(5).every(60).trustedProxies(1).register();
   */
  trustedProxies(count: number): this {
    this._trustedProxies = count;
    return this;
  }

  /**
   * Custom key resolver — defaults to client IP.
   *
   * Whatever this returns is the bucket. If it derives from the client address,
   * resolve that with `ctx.ip()` plus your own proxy handling, or prefer
   * {@link byIp}, which honours {@link trustedProxies} for you.
   */
  by(fn: (ctx: HttpContext) => string): this {
    this._key = { kind: "custom", fn };
    return this;
  }

  /**
   * Key by the authenticated user's ID.
   * Unauthenticated requests fall back to the client IP so they are still
   * rate-limited independently from each other.
   *
   * @example
   * RateLimiter.for('api').limit(1000).every(3600).byUser().register();
   */
  byUser(): this {
    this._key = { kind: "user" };
    return this;
  }

  /**
   * Key by an API key header value.
   * Requests that omit the header fall back to client IP.
   *
   * @example
   * RateLimiter.for('api').limit(500).every(60).byApiKey('x-api-key').register();
   */
  byApiKey(header = "x-api-key"): this {
    this._key = { kind: "apiKey", header };
    return this;
  }

  /**
   * Key by client IP address (explicitly named; this is already the default).
   * Useful to make intent explicit when combining with other `.by*()` calls
   * through the fluent API.
   */
  byIp(): this {
    this._key = { kind: "ip" };
    return this;
  }

  /** Register this limiter with the global RateLimiter registry. */
  register(): this {
    RateLimiter._register(this._name, this);
    return this;
  }

  /**
   * Build a dedicated `ThrottleMiddleware` **subclass** for this definition.
   *
   * A subclass rather than a bare instance for two reasons. First, routes and
   * `Pipeline.through()` take middleware *classes* and call `new PipeClass()`; handing them an
   * instance threw `TypeError: ThrottleMiddleware is not a constructor` on every request.
   * Second, hit counters are keyed on the concrete class, so giving each named limiter its own
   * subclass is what keeps `login` and `api` counting into separate buckets.
   */
  toMiddlewareClass(): new () => ThrottleMiddleware {
    const options: ThrottleOptions = {
      maxAttempts: this._max,
      windowSeconds: this._window,
    };
    if (this._trustedProxies !== undefined) options.trustedProxies = this._trustedProxies;

    // `default` deliberately sets no resolver: ThrottleMiddleware's own is already
    // proxy-aware, and every resolver set here has to be too.
    const resolver = _resolverFor(this._key, this._trustedProxies);
    if (resolver) options.keyResolver = resolver;
    return ThrottleMiddleware.with(options);
  }

  /**
   * Build a `ThrottleMiddleware` instance from this definition.
   *
   * Prefer {@link toMiddlewareClass} for anything that goes into a route or a pipeline. This
   * remains for the imperative API (`RateLimiter.tooManyAttempts`, `resetFor`), which needs a
   * live object; it shares counters with the class because both are the same subclass.
   */
  toMiddleware(): ThrottleMiddleware {
    const Cls = this.toMiddlewareClass();
    return new Cls();
  }
}

/** How a limiter decides which bucket a request belongs to. */
type KeyStrategy =
  | { kind: "default" }
  | { kind: "ip" }
  | { kind: "user" }
  | { kind: "apiKey"; header: string }
  | { kind: "custom"; fn: (ctx: HttpContext) => string };

/**
 * Build the key resolver for a strategy, or `undefined` to let `ThrottleMiddleware`
 * use its own.
 *
 * Every branch that can end up keying on an address goes through `_clientIp` with the
 * proxy count, and is marked so `zt doctor` still audits it. The previous versions
 * used a private helper that read the socket address and fell back to the *leftmost*
 * `X-Forwarded-For` entry with no proxy count at all — so behind a reverse proxy
 * every visitor keyed on the proxy's own address and shared a single bucket. A named
 * `login` limiter of five attempts a minute was five attempts a minute across the
 * entire user base, and one attacker locked everybody out.
 *
 * @param strategy - What the builder recorded.
 * @param trustedProxies - How many proxies sit in front, if the builder was told.
 */
function _resolverFor(
  strategy: KeyStrategy,
  trustedProxies: number | undefined,
): ((ctx: HttpContext) => string) | undefined {
  switch (strategy.kind) {
    case "default":
      return undefined;

    case "ip":
      return _markIpDerived((ctx) => `ip:${_clientIp(ctx, trustedProxies)}`);

    case "user":
      // Marked, because the *unauthenticated* half of this keys on an address —
      // which is the half a rate limiter on a login form exists for.
      return _markIpDerived((ctx) => {
        const user = (ctx as unknown as Record<string, unknown>).user as
          { id?: number } | undefined;
        return user?.id !== undefined ? `user:${user.id}` : `ip:${_clientIp(ctx, trustedProxies)}`;
      });

    case "apiKey": {
      const { header } = strategy;
      return _markIpDerived((ctx) => {
        const key = ctx.header(header);
        return key ? `apikey:${key}` : `ip:${_clientIp(ctx, trustedProxies)}`;
      });
    }

    case "custom":
      // Unmarked on purpose: an app-supplied resolver is the app's to reason about,
      // and most of them key on something no proxy can affect.
      return strategy.fn;
  }
}

/**
 * Named rate-limiter registry.
 *
 * @example
 * // In a ServiceProvider (boot time):
 * RateLimiter.for('api')
 *   .limit(120).every(60)
 *   .by(ctx => String(ctx.user?.id ?? ctx.request.headers.get('x-forwarded-for')))
 *   .register();
 *
 * RateLimiter.for('login').limit(5).every(60).register();
 *
 * // On a route:
 * Router.post('/login', AuthController, 'login', [
 *   RateLimiter.middleware('login'),
 * ]);
 *
 * // Manual check:
 * if (RateLimiter.tooManyAttempts('login', ctx)) {
 *   ctx.response = Response.json({ message: 'Too Many Requests' }, { status: 429 });
 *   return;
 * }
 */
export class RateLimiter {
  private static _definitions = new Map<string, LimiterDefinition>();
  // Per-named-limiter ThrottleMiddleware subclasses (keyed by name). One class per limiter
  // keeps their hit counters isolated, since the store is keyed on the concrete class.
  private static _middlewareClasses = new Map<string, new () => ThrottleMiddleware>();
  // A live instance of each class, for the imperative tooManyAttempts()/resetFor() API.
  // Shares counters with the class above — same constructor, same bucket.
  private static _middlewares = new Map<string, ThrottleMiddleware>();

  /** @internal Called by `LimiterDefinition.register()`. */
  static _register(name: string, definition: LimiterDefinition): void {
    const Cls = definition.toMiddlewareClass();
    RateLimiter._definitions.set(name, definition);
    RateLimiter._middlewareClasses.set(name, Cls);
    RateLimiter._middlewares.set(name, new Cls());
  }

  /**
   * Start building a named limiter.
   * Call `.register()` at the end to make it available globally.
   *
   * @example
   * RateLimiter.for('api').limit(100).every(60).register();
   */
  static for(name: string): LimiterDefinition {
    return new LimiterDefinition(name);
  }

  /**
   * Get the ThrottleMiddleware for a registered named limiter.
   * Throws if the limiter was never registered.
   *
   * @example
   * Router.post('/login', AuthController, 'login', [RateLimiter.middleware('login')]);
   */
  static middleware(name: string): new () => ThrottleMiddleware {
    const Cls = RateLimiter._middlewareClasses.get(name);
    if (!Cls) throw new Error(`[Zerotal] RateLimiter "${name}" has not been registered.`);
    return Cls;
  }

  /**
   * The live `ThrottleMiddleware` instance backing a registered limiter.
   *
   * Only needed when you want to call `handle()`/`reset()` directly. Route and pipeline
   * registration wants {@link middleware}, which returns the class.
   *
   * @internal
   */
  static _instance(name: string): ThrottleMiddleware {
    const middleware = RateLimiter._middlewares.get(name);
    if (!middleware) throw new Error(`[Zerotal] RateLimiter "${name}" has not been registered.`);
    return middleware;
  }

  /**
   * Manually record a hit and check whether the limit is exceeded.
   * Returns `true` when the caller should be throttled.
   *
   * Unlike the middleware, this does NOT automatically send a 429 response —
   * the caller decides how to handle the throttle condition.
   *
   * @example
   * if (RateLimiter.tooManyAttempts('login', ctx)) {
   *   ctx.response = Response.json({ message: 'Too Many Requests' }, { status: 429 });
   *   return;
   * }
   */
  static async tooManyAttempts(name: string, ctx: HttpContext): Promise<boolean> {
    const middleware = RateLimiter._middlewares.get(name);
    if (!middleware) throw new Error(`[Zerotal] RateLimiter "${name}" has not been registered.`);

    let throttled = false;
    await middleware.handle(ctx, async () => {
      // Reaching this callback means the request was not throttled.
      ctx.response = new Response("ok");
      return ctx.response;
    });
    throttled = ctx.response?.status === 429;
    // Discard the synthetic "ok" response so the real handler can set its own.
    ctx.response = undefined;
    return throttled;
  }

  /**
   * Reset the rate-limit counter for a specific key within a named limiter.
   *
   * Use this after a successful action to allow the actor to start fresh —
   * e.g. clear failed login attempts after a successful authentication.
   *
   * @example
   * // In your LoginController:
   * await RateLimiter.resetFor('login', ctx);
   */
  static resetFor(name: string, ctx: HttpContext): void {
    const middleware = RateLimiter._middlewares.get(name);
    if (!middleware) throw new Error(`[Zerotal] RateLimiter "${name}" has not been registered.`);
    middleware.resetKey(ctx);
  }

  /** Remove all registered limiters (useful in tests). */
  static clear(): void {
    RateLimiter._definitions.clear();
    RateLimiter._middlewares.clear();
  }
}
