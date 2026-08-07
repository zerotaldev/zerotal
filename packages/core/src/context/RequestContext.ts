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
}
