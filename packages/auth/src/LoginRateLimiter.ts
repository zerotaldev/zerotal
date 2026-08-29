/**
 * Login lockout — throttles failed authentication attempts per (identifier + IP).
 * After `maxAttempts` failures within the
 * decay window the actor is locked out until the window resets, and a `Lockout`
 * event is emitted (once per lockout) for alerting / intrusion detection.
 *
 * Counters are kept in an in-memory sliding window (same approach as core's
 * ThrottleMiddleware). Wire it into your login controller:
 *
 * @example
 * ```ts
 * import { Auth, loginThrottle } from "@zerotal/auth";
 *
 * async login(http: HttpContext) {
 *   const { email, password } = await http.input();
 *   const wait = loginThrottle.ensureNotLocked(http, email);
 *   if (wait !== null) {
 *     return http.response = Response.json(
 *       { message: `Too many attempts. Try again in ${wait}s.` }, { status: 429 });
 *   }
 *   if (await Auth.attempt({ email, password })) {
 *     loginThrottle.clearFor(http, email);   // reset on success
 *     return http.redirect("/dashboard");
 *   }
 *   loginThrottle.recordFailure(http, email); // count the miss
 *   return http.redirect("/login");
 * }
 * ```
 */
import { FrameworkEvents } from "@zerotal/core";
import { Lockout } from "./events.ts";
import type { HttpContext } from "@zerotal/core";

export interface LoginThrottleOptions {
  /** Failures allowed within the window before lockout. Default: 5. */
  maxAttempts?: number | undefined;
  /** Window length in seconds; also the lockout duration. Default: 60. */
  decaySeconds?: number | undefined;
}

interface Bucket {
  count: number;
  resetsAt: number; // unix ms
}

export class LoginRateLimiter {
  private readonly _store = new Map<string, Bucket>();
  private readonly _max: number;
  private readonly _decayMs: number;
  /** Keys already announced via a Lockout event this window (avoid duplicate events). */
  private readonly _announced = new Set<string>();

  constructor(opts: LoginThrottleOptions = {}) {
    this._max = opts.maxAttempts ?? 5;
    this._decayMs = (opts.decaySeconds ?? 60) * 1000;
  }

  /**
   * Throttle key for an identifier + IP pair (identifier is lower-cased).
   * @category Key-based API
   */
  static key(identifier: string, ip: string): string {
    return `login|${identifier.toLowerCase()}|${ip}`;
  }

  // ── Low-level, key-based API ──────────────────────────────────────────────────

  /**
   * Failed attempts recorded for a key in the current (un-expired) window.
   * @category Key-based API
   */
  attempts(key: string): number {
    return this._live(key)?.count ?? 0;
  }

  /**
   * True once recorded failures reach the configured maximum.
   * @category Key-based API
   */
  tooManyAttempts(key: string): boolean {
    return this.attempts(key) >= this._max;
  }

  /**
   * Record one failed attempt; returns the new attempt count.
   * @category Key-based API
   */
  hit(key: string): number {
    const now = Date.now();
    const existing = this._live(key);
    if (existing) {
      existing.count++;
      return existing.count;
    }
    this._store.set(key, { count: 1, resetsAt: now + this._decayMs });
    this._announced.delete(key);
    return 1;
  }

  /**
   * Seconds until the key's window resets (0 when not currently limited).
   * @category Key-based API
   */
  availableIn(key: string): number {
    const bucket = this._live(key);
    if (!bucket) return 0;
    return Math.max(0, Math.ceil((bucket.resetsAt - Date.now()) / 1000));
  }

  /**
   * Clear a key's counter — call after a successful login.
   * @category Key-based API
   */
  clear(key: string): void {
    this._store.delete(key);
    this._announced.delete(key);
  }

  /**
   * Drop all counters (test helper).
   * @category Key-based API
   */
  reset(): void {
    this._store.clear();
    this._announced.clear();
  }

  // ── High-level, context-keyed API ─────────────────────────────────────────────

  /**
   * Guard a login attempt. Returns `null` when allowed, or the number of seconds
   * until retry when locked out — emitting a {@link Lockout} event once per
   * lockout window.
   *
   * @param ctx - Request context (the client IP is derived from it).
   * @param identifier - The login identifier being throttled, e.g. the email.
   * @returns `null` when allowed, otherwise seconds until retry.
   * @category Context API
   */
  ensureNotLocked(ctx: HttpContext, identifier: string): number | null {
    const key = LoginRateLimiter.key(identifier, _ip(ctx));
    if (this.tooManyAttempts(key)) {
      if (!this._announced.has(key)) {
        this._announced.add(key);
        FrameworkEvents.emit(new Lockout("web", identifier, ctx));
      }
      return this.availableIn(key);
    }
    return null;
  }

  /**
   * Record a failed login for the (identifier + IP) derived from the context.
   * @category Context API
   */
  recordFailure(ctx: HttpContext, identifier: string): number {
    return this.hit(LoginRateLimiter.key(identifier, _ip(ctx)));
  }

  /**
   * Clear failed-login counters for the (identifier + IP) — call on success.
   * @category Context API
   */
  clearFor(ctx: HttpContext, identifier: string): void {
    this.clear(LoginRateLimiter.key(identifier, _ip(ctx)));
  }

  /** @internal Return the live bucket for a key, evicting it if its window has elapsed. */
  private _live(key: string): Bucket | undefined {
    const bucket = this._store.get(key);
    if (!bucket) return undefined;
    if (Date.now() >= bucket.resetsAt) {
      this._store.delete(key);
      this._announced.delete(key);
      return undefined;
    }
    return bucket;
  }
}

/** @internal Resolve the client IP from the context, with proxy-header fallbacks. */
function _ip(ctx: HttpContext): string {
  return (
    ctx.ip() ??
    ctx.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    ctx.header("x-real-ip") ??
    "unknown"
  );
}

/** Shared default login limiter (5 attempts / 60s). Import and use directly. */
export const loginThrottle = new LoginRateLimiter();
