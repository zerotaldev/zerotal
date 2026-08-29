/**
 * Rate-limiting middleware backed by an in-memory sliding-window counter.
 * Returns `429 Too Many Requests` (with `Retry-After` and `X-RateLimit-*`
 * headers) once a client exceeds its allowance within the window.
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware, deepMerge } from "./BaseMiddleware.ts";
import { withHeaders } from "../http/withHeaders.ts";
import { negotiate } from "../http/negotiate.ts";
import { config } from "../helpers/config.ts";

export interface ThrottleOptions {
  /** Maximum number of requests allowed within the window. */
  maxAttempts: number;
  /** Time window in seconds. Defaults to 60. */
  windowSeconds?: number | undefined;
  /**
   * Custom key resolver — defaults to client IP address.
   * Use this to rate-limit by user ID, API key, route, etc.
   */
  keyResolver?: ((ctx: HttpContext) => string) | undefined;
  /**
   * Number of trusted reverse proxies in front of this server.
   *
   * `X-Forwarded-For` is client-writable, so it is only consulted when you state how many
   * proxies sit in front of the app — the count is what says which entry is not
   * attacker-controlled. Without it the unspoofable socket address is used.
   *
   * - `undefined` (default) / `0` — no trusted proxy; key on the socket address
   * - `1` — one trusted proxy; the client IP is the second-to-last XFF entry
   * - `n` — the client IP is `n` entries from the right
   *
   * @example
   * // Behind one load balancer:
   * ThrottleMiddleware.with({ maxAttempts: 60, trustedProxies: 1 })
   */
  trustedProxies?: number | undefined;
}

interface HitRecord {
  count: number;
  resetsAt: number; // unix ms
}

/**
 * Rate-limiting middleware using an in-memory sliding window counter.
 *
 * Returns 429 Too Many Requests with Retry-After and X-RateLimit-* headers
 * when a client exceeds the configured threshold within the time window.
 *
 * @example
 * // Global: 120 req / min
 * app.use([ThrottleMiddleware.with({ maxAttempts: 120, windowSeconds: 60 })]);
 *
 * // Per-route: 5 login attempts / min
 * Router.post('/login', AuthController, 'login', [
 *   ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 }),
 * ]);
 *
 * // By authenticated user ID
 * ThrottleMiddleware.with({
 *   maxAttempts: 1000,
 *   windowSeconds: 3600,
 *   keyResolver: (ctx) => String(ctx.user?.id ?? _clientIp(ctx.request)),
 * })
 */
export class ThrottleMiddleware extends BaseMiddleware<ThrottleOptions> {
  protected options: ThrottleOptions = {
    maxAttempts: 60,
    windowSeconds: 60,
  };

  constructor(options: Partial<ThrottleOptions> = {}) {
    super();
    // App-level defaults from config('app.throttle') layer over the built-ins; explicit
    // options (constructor arg or .with(...)) win over both. Without this read, an operator
    // who hardened `app.throttle` in config got the built-in 60/60 and no indication why.
    this.options = deepMerge(
      this.options,
      config.safe("app.throttle", {} as Partial<ThrottleOptions>),
    );
    this.options = deepMerge(this.options, options);
  }

  /**
   * The hit counters for this middleware class.
   *
   * This **must not** be per-instance. The pipeline constructs a fresh pipe for every request
   * unless the class is container-registered, and middleware never is — so an instance field
   * was reset on each request and the limiter counted to 1 forever, silently allowing unlimited
   * traffic through every `ThrottleMiddleware` and `RateLimiter` (including login throttles).
   *
   * The store is keyed on the concrete class, so each `ThrottleMiddleware.with({...})` call
   * site — which returns its own anonymous subclass — keeps an isolated bucket, exactly as the
   * per-instance field intended. `reset()` and `resetKey()` operate on the same shared map.
   */
  private get _store(): Map<string, HitRecord> {
    return _storeFor(this.constructor as ThrottleClass);
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const max = this.options.maxAttempts;
    const windowMs = (this.options.windowSeconds ?? 60) * 1000;
    const keyFn =
      this.options.keyResolver ?? ((context) => _clientIp(context, this.options.trustedProxies));

    const key = keyFn(http);
    const now = Date.now();
    const store = this._store;
    const existing = store.get(key);

    let record: HitRecord;

    if (!existing || now >= existing.resetsAt) {
      record = { count: 1, resetsAt: now + windowMs };
      store.set(key, record);
      _pruneStore(store, now);
    } else {
      record = existing;
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetsAt - now) / 1000);

    if (record.count > max) {
      await negotiate(http)({
        web: () => {
          http.response = new Response(
            `<!DOCTYPE html>\n<html><head><title>429 Too Many Requests</title></head>` +
              `<body><h1>429 Too Many Requests</h1>` +
              `<p>You have exceeded the request limit. Please retry after ${resetSeconds} seconds.</p>` +
              `</body></html>`,
            { status: 429, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        },
        json: () => {
          http.response = Response.json({ message: "Too Many Requests" }, { status: 429 });
        },
        cli: (cli) => cli.text(`Rate limit exceeded. Retry after ${resetSeconds}s.`, 429),
      });

      // Apply rate-limit headers uniformly regardless of channel
      if (http.response) {
        http.response = withHeaders(http.response, {
          "Retry-After": String(resetSeconds),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(record.resetsAt / 1000)),
        });
      }

      return http.response;
    }

    const response = await next();

    // Attach informational headers to every successful response.
    if (response) {
      return withHeaders(response, {
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.floor(record.resetsAt / 1000)),
      });
    }
  }

  /** Reset all counters — useful in tests. */
  reset(): void {
    this._store.clear();
  }

  /**
   * Reset the counter for a single key derived from the given context.
   * Used by `RateLimiter.resetFor()` to clear a specific actor's bucket
   * (e.g. after a successful login clears failed-attempt counters).
   */
  resetKey(ctx: HttpContext): void {
    const keyFn =
      this.options.keyResolver ?? ((context) => _clientIp(context, this.options.trustedProxies));
    this._store.delete(keyFn(ctx));
  }
}

/**
 * Hard cap on distinct keys held per middleware class.
 *
 * The key is derived from client-controlled input (the peer address, a forwarded header, an
 * API key, or an app-supplied `keyResolver`), so an unbounded map is a memory-exhaustion
 * vector: a few million requests with unique keys is a few million retained records. On
 * overflow the map is swept of expired records first, and only genuinely live buckets are
 * evicted — oldest-reset first — so an attacker cannot cheaply flush a legitimate client's
 * counter by flooding new keys.
 */
const _MAX_KEYS = 100_000;

/** Identity of a concrete throttle class — used only as a `WeakMap` key. */
type ThrottleClass = abstract new (...args: never[]) => ThrottleMiddleware;

/** Per-class hit counters. Keyed on the class so `.with()` subclasses stay isolated. */
const _stores = new WeakMap<ThrottleClass, Map<string, HitRecord>>();

function _storeFor(cls: ThrottleClass): Map<string, HitRecord> {
  let store = _stores.get(cls);
  if (!store) {
    store = new Map<string, HitRecord>();
    _stores.set(cls, store);
  }
  return store;
}

/**
 * Keep the store bounded. Called after each insert; O(1) in the common case because the
 * size check short-circuits until the cap is actually reached.
 */
export function _pruneStore(store: Map<string, HitRecord>, now: number): void {
  if (store.size <= _MAX_KEYS) return;
  for (const [key, record] of store) {
    if (now >= record.resetsAt) store.delete(key);
  }
  if (store.size <= _MAX_KEYS) return;
  // Still over after sweeping expired entries: drop the buckets that reset soonest, since
  // those are closest to being discarded anyway.
  const live = [...store.entries()].sort((a, b) => a[1].resetsAt - b[1].resetsAt);
  for (let i = 0; i < live.length - _MAX_KEYS; i++) store.delete(live[i]![0]);
}

function _clientIp(ctx: HttpContext, trustedProxies?: number): string {
  // Default (undefined) and an explicit 0 both mean "not behind a trusted proxy": read the raw
  // socket address, which cannot be spoofed.
  //
  // This used to fall through to the leftmost X-Forwarded-For entry when `trustedProxies` was
  // undefined — and undefined is the default. Because the header was consulted *before* the
  // socket address, even a direct connection could pick its own bucket, so rotating
  // `X-Forwarded-For: 1.2.3.<n>` defeated every limiter built on this, including the documented
  // login throttle. Trusting a forwarded header is now strictly opt-in, which matches how
  // RateLimiter._resolveIp and LoginRateLimiter._ip already behaved.
  if (trustedProxies === undefined || trustedProxies === 0) {
    return ctx.ip() ?? ctx.header("x-real-ip") ?? "unknown";
  }

  // Behind one or more *trusted* reverse proxies — parse X-Forwarded-For.
  const forwardedFor = ctx.header("x-forwarded-for");
  if (!forwardedFor) return ctx.ip() ?? ctx.header("x-real-ip") ?? "unknown";

  const addresses = forwardedFor.split(",").map((entry) => entry.trim());

  // trustedProxies > 0: client IP is that many entries from the right.
  const clientIndex = addresses.length - 1 - trustedProxies;
  return (clientIndex >= 0 ? addresses[clientIndex] : addresses[0]) ?? "unknown";
}
