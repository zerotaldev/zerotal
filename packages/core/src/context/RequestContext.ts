/**
 * Ambient access to the current request's `HttpContext` through
 * AsyncLocalStorage, so deeply nested code can reach the request without it
 * being threaded through every call.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { TransactionContext } from "../contracts/index.ts";
import { ContextOutsideRequestError } from "../errors/index.ts";

// One ALS instance for the entire process lifetime.
const storage = new AsyncLocalStorage<HttpContext>();

/**
 * Static accessor for the request-scoped `HttpContext` stored in AsyncLocalStorage.
 *
 * @remarks
 * A boundary is opened once per request via {@link RequestContext.run} (in the
 * `Bun.serve()` fetch handler). Inside it, any code — however deeply nested —
 * reaches the current request with {@link RequestContext.get} (throws off-request)
 * or {@link RequestContext.tryGet} (returns `undefined` off-request).
 *
 * @example
 * ```ts
 * const ctx = RequestContext.tryGet();
 * if (ctx) console.log(`handling ${ctx.request.url}`);
 * ```
 */
export class RequestContext {
  // ── Entry point ───────────────────────────────────────────────────────
  /**
   * Establish a per-request ALS boundary.
   *
   * MUST be called at the very top of the Bun.serve() fetch handler —
   * synchronously, before any await — to avoid the Bun #24199 edge case
   * where ALS context is lost if await happens before run() is called.
   *
   * The callback runs inside the boundary. Everything called from within
   * the callback (including deeply nested async code) can access ctx via
   * RequestContext.get() with no argument passing.
   */
  static run<T>(ctx: HttpContext, callback: () => T): T {
    return storage.run(ctx, callback);
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  /**
   * Returns the current HttpContext. Throws if called outside a request.
   *
   * @throws {ContextOutsideRequestError} When called outside a request boundary opened by {@link RequestContext.run}.
   */
  static get(): HttpContext {
    const ctx = storage.getStore();
    if (!ctx) throw new ContextOutsideRequestError();
    return ctx;
  }

  /**
   * Returns the current HttpContext or undefined.
   * Use this for code that runs in both request and non-request contexts
   * (CLI commands, queue workers, scheduled jobs).
   */
  static tryGet(): HttpContext | undefined {
    return storage.getStore();
  }

  // ── Typed shortcuts — facades use these ──────────────────────────────

  /** The current request. Throws if called outside a request. */
  static request(): Request {
    return this.get().request;
  }
  /** The current request's unique id. Throws if called outside a request. */
  static requestId(): string {
    return this.get().requestId;
  }
  /** Elapsed milliseconds since the current request started. Throws if outside a request. */
  static took(): number {
    return this.get().took;
  }
  /** The current request's locale, defaulting to `"en"`. Throws if outside a request. */
  static locale(): string {
    return this.get().locale ?? "en";
  }

  /** The active database transaction for the current request, or `undefined`. */
  static transaction(): TransactionContext | undefined {
    return this.tryGet()?._transaction;
  }

  // ── Per-request memoisation ───────────────────────────────────────────

  /**
   * Run `factory` at most once per request for a given `key`, and hand every
   * later caller the same answer.
   *
   * The N+1 detector tells you a query ran too many times; the fix is almost
   * always "ask once per request", and this is that. Outside a request it is a
   * pass-through — a queue worker or a CLI command has no request to scope to,
   * and silently sharing a value across jobs would be worse than not caching.
   *
   * Two details are the whole point, and both were learned the expensive way by
   * everyone who hand-rolls this:
   *
   * - **The promise is cached, not the resolved value.** Cache after the
   *   `await` and a `Promise.all` of ten readers all miss, because none of them
   *   has resolved when the others look. Caching the promise makes the first
   *   caller's in-flight work the answer for the other nine.
   * - **A rejected promise is evicted.** Leave it in and one transient failure
   *   poisons every later read in the same request, including the retry.
   *
   * @param key - Unique within the request. Include the arguments: `user:${id}`.
   * @param factory - Runs on the first call for this key.
   *
   * @example
   * const settings = await RequestContext.remember(
   *   `household:${id}:settings`,
   *   () => Settings.query().where("household_id", id).first(),
   * );
   */
  static async remember<T>(key: string, factory: () => Promise<T> | T): Promise<T> {
    const ctx = this.tryGet();
    if (!ctx) return factory();

    const cacheKey = `memo:${key}`;
    const hit = ctx.getInternal<Promise<T>>(cacheKey);
    if (hit) return hit;

    // Store the promise synchronously, before the first await — that is what
    // makes concurrent callers share one round trip instead of racing.
    const pending = (async () => factory())();
    ctx.setInternal(cacheKey, pending);

    try {
      return await pending;
    } catch (error) {
      ctx.deleteInternal(cacheKey);
      throw error;
    }
  }

  /**
   * Drop a memoised value so the next {@link remember} recomputes it.
   *
   * For the case a write invalidates a read taken earlier in the same request.
   */
  static forget(key: string): void {
    this.tryGet()?.deleteInternal(`memo:${key}`);
  }
}
