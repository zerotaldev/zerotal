/**
 * The named rate-limiter registry and its fluent definition builder. Limiters
 * are defined once at boot (`RateLimiter.for('api').limit(…).register()`) and
 * later attached to routes or checked manually as `ThrottleMiddleware`.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { ThrottleMiddleware } from "./ThrottleMiddleware.ts";
import type { ThrottleOptions } from "./ThrottleMiddleware.ts";

/**
 * Fluent rate-limiter definition.
 * Build one via `RateLimiter.for('name')` then register with `.register()`.
 */
export class LimiterDefinition {
  private _max = 60;
  private _window = 60;
  private _keyFn?: (ctx: HttpContext) => string;

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

  /** Custom key resolver — defaults to client IP. */
  by(fn: (ctx: HttpContext) => string): this {
    this._keyFn = fn;
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
    this._keyFn = (ctx) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id?: number } | undefined;
      return user?.id !== undefined ? `user:${user.id}` : `ip:${_resolveIp(ctx)}`;
    };
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
    this._keyFn = (ctx) => {
      const key = ctx.header(header);
      return key ? `apikey:${key}` : `ip:${_resolveIp(ctx)}`;
    };
    return this;
  }

  /**
   * Key by client IP address (explicitly named; this is already the default).
   * Useful to make intent explicit when combining with other `.by*()` calls
   * through the fluent API.
   */
  byIp(): this {
    this._keyFn = (ctx) => `ip:${_resolveIp(ctx)}`;
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
    if (this._keyFn) options.keyResolver = this._keyFn;
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

/** Resolve the best available client IP from the context. */
function _resolveIp(ctx: HttpContext): string {
  return (
    ctx.ip() ??
    ctx.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    ctx.header("x-real-ip") ??
    "unknown"
  );
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
