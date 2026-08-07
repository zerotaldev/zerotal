/**
 * The request-scoped resolver: caches scoped bindings for the lifetime of a
 * single request and reference-counts them so the cache is flushed only once
 * every outstanding reference (including pending afterResponse hooks) is gone.
 */
import type { Factory } from "./types.ts";
import type { Container } from "./Container.ts";
import { ScopedAfterFlushError } from "../errors/ContainerErrors.ts";

/**
 * Per-request cache of scoped bindings, flushed when the last reference is released.
 */
export class ScopedResolver {
  private _cache = new Map<unknown, unknown>();
  private _pending = new Map<unknown, Promise<unknown>>();
  private _refCount = 1; // starts at 1 — the request itself holds a reference
  private _flushed = false;

  constructor(private readonly _container?: Container) {}

  /**
   * Resolve a scoped binding, caching the instance for the rest of the request.
   * Concurrent calls for the same token share a single in-flight promise.
   *
   * @throws {ScopedAfterFlushError} If the scope has already been flushed.
   */
  async resolve<T>(token: unknown, factory: Factory<T>): Promise<T> {
    if (this._flushed) {
      throw new ScopedAfterFlushError(
        `Attempted to resolve a scoped binding after the request scope was flushed. ` +
          `Ensure afterResponse() is called before the response pipeline resolves.`,
      );
    }

    if (this._cache.has(token)) {
      return this._cache.get(token) as T;
    }

    if (this._pending.has(token)) {
      return this._pending.get(token) as Promise<T>;
    }

    const promise = Promise.resolve(factory(this._container!)).then((instance) => {
      this._cache.set(token, instance);
      this._pending.delete(token);
      return instance;
    });

    this._pending.set(token, promise);
    return promise;
  }

  // ── Reference counting ────────────────────────────────────────────────

  /**
   * Acquire a reference. Called synchronously by HttpContext.afterResponse()
   * at registration time — before any await — so the request's finally block
   * cannot flush the scope before the callback has a chance to run.
   */
  acquire(): void {
    if (this._flushed) {
      throw new ScopedAfterFlushError(
        `Cannot acquire a reference on a flushed ScopedResolver. ` +
          `afterResponse() must be called before the response pipeline resolves.`,
      );
    }
    this._refCount++;
  }

  /**
   * Release a reference. When _refCount reaches 0, _doFlush() runs.
   * Called by afterResponse() callback finally blocks and by flush().
   */
  release(): void {
    this._refCount = Math.max(0, this._refCount - 1);
    if (this._refCount === 0) this._doFlush();
  }

  /**
   * Called by Application.ts in the fetch handler's finally block.
   * Releases the request's own reference (the initial 1).
   * If afterResponse() callbacks are pending they hold their own references,
   * so _doFlush() will not run until all of them have released.
   */
  flush(): void {
    this.release();
  }

  // ── Internal cleanup ──────────────────────────────────────────────────
  private _doFlush(): void {
    if (this._flushed) return;
    this._flushed = true;
    this._cache.clear();
    this._pending.clear();
    // The AsyncLocalStorage entry in Container is garbage-collected automatically
    // when the runScoped() async context exits — no manual unregistration needed.
  }

  // ── Introspection (for tests and debug logging) ───────────────────────

  /** @internal The current number of outstanding references on this scope. */
  get refCount(): number {
    return this._refCount;
  }
  /** @internal Whether the scope has been flushed and can no longer resolve. */
  get isFlushed(): boolean {
    return this._flushed;
  }
  /** @internal The number of cached scoped instances. */
  get cacheSize(): number {
    return this._cache.size;
  }
  /** The root container — allows middleware to resolve non-scoped bindings. */
  get container(): Container | undefined {
    return this._container;
  }
}
