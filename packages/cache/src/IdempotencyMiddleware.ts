import type { NextFn, HttpContext } from "@zerotal/core";
import { currentApp, BaseMiddleware } from "@zerotal/core";
import type { LockManager } from "@zerotal/core/lock";
import { LockNotAcquiredError } from "@zerotal/core/lock";
import type { CacheManager } from "./CacheManager.ts";

// Cross-process idempotency lock: hold time while the handler runs, and how long a
// concurrent request waits for the holder before executing anyway.
const IDEMPOTENCY_LOCK_TTL = 60; // seconds
const IDEMPOTENCY_LOCK_WAIT = 30; // seconds

// ── Stored payload ────────────────────────────────────────────────────────────

interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyHash: string | null; // SHA-256 of original request body, null when validateBody disabled
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface IdempotencyOptions {
  /**
   * CacheManager that stores idempotent responses.
   * Required — pass via `IdempotencyMiddleware.with({ cache: manager })`.
   */
  cache: CacheManager | undefined;

  /**
   * Seconds to retain a stored response. After this, the same key can be
   * reused without replaying the previous response. Default: `86400` (24 h).
   */
  ttl: number;

  /**
   * HTTP methods subject to idempotency checks.
   * Default: `['POST', 'PUT', 'PATCH', 'DELETE']`.
   */
  methods: string[];

  /**
   * Request header that carries the client-supplied idempotency key.
   * Default: `'Idempotency-Key'`.
   */
  header: string;

  /**
   * When `true`, a 422 is returned if the same idempotency key arrives with
   * a different request body. Useful for detecting accidental key reuse.
   * Default: `false`.
   */
  validateBody: boolean;

  /**
   * Take a cross-process lock (via the lock primitive) so only one node executes the
   * handler for a given key at a time, even across machines. Default: `true`.
   * Degrades to in-process coalescing + cache replay when no lock driver is configured.
   */
  useLock: boolean;

  /**
   * Explicit lock manager. When omitted (and `useLock` is true), the manager is
   * resolved from the container's `lock` binding at request time.
   */
  lock?: LockManager;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Idempotency middleware — prevents double-execution of mutating requests.
 *
 * Clients attach an `Idempotency-Key: <uuid>` header to any mutating request.
 * On the first request the handler executes normally and the response is
 * stored in the cache. All subsequent requests with the same key receive the
 * stored response without re-running the handler.
 *
 * Concurrent requests for the same key are coalesced: within a process via an
 * in-flight map, and across processes via a cross-process lock (the lock
 * primitive) so only one node executes the handler at a time. Cross-process
 * locking is on by default and degrades to cache-backed replay when no lock
 * driver is configured; disable it with `useLock: false`.
 *
 * Replayed responses carry an `Idempotency-Replay: true` header so clients
 * can distinguish fresh from cached responses.
 *
 * 5xx responses are never cached so transient errors don't permanently
 * suppress retries.
 *
 * @example
 * import { IdempotencyMiddleware } from '@zerotal/cache';
 * import { Cache } from '@zerotal/cache';
 *
 * // Per-route
 * Router.post('/api/orders', [OrderController, 'store'], {
 *   middleware: [IdempotencyMiddleware.with({ cache: Cache.instance() })],
 * });
 *
 * // Global
 * app.use([IdempotencyMiddleware.with({ cache: cacheManager, ttl: 48 * 3600 })]);
 */
export class IdempotencyMiddleware extends BaseMiddleware<IdempotencyOptions> {
  protected options: IdempotencyOptions = {
    cache: undefined,
    ttl: 86_400, // 24 h
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    header: "Idempotency-Key",
    validateBody: false,
    useLock: true,
  };

  // Per-process in-flight map — coalesces concurrent requests with the same key
  // so only one handler execution runs at a time within this process.
  private static readonly _inFlight = new Map<string, Promise<Response>>();

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const method = http.request.method.toUpperCase();
    if (!this.options.methods.includes(method)) return next();

    const idempotencyKey = http.header(this.options.header);
    if (!idempotencyKey) return next();

    const { cache, ttl, validateBody } = this.options;
    if (!cache) return next();

    const cacheKey = `idempotency:${idempotencyKey.trim().slice(0, 512)}`;

    // Compute body hash now — before next() can consume the stream.
    const bodyHash = validateBody ? await _hashBody(http.request) : null;

    // ── Replay from cache ─────────────────────────────────────────────────────
    const stored = await cache.get<StoredResponse>(cacheKey);
    if (stored) {
      if (validateBody && stored.bodyHash !== null && stored.bodyHash !== bodyHash) {
        return Response.json(
          {
            message: "This Idempotency-Key was used with a different request body.",
          },
          { status: 422 },
        );
      }
      return _rehydrate(stored, true);
    }

    // ── Coalesce within process ───────────────────────────────────────────────
    const inFlight = IdempotencyMiddleware._inFlight.get(cacheKey);
    if (inFlight) {
      const replayed = (await inFlight).clone();
      replayed.headers.set("Idempotency-Replay", "true");
      return replayed;
    }

    // Run the handler exactly once and cache its response. Re-checks the cache first
    // so a request that just waited on the cross-process lock replays the stored
    // response instead of executing the handler again.
    const executeOnce = async (): Promise<Response> => {
      const fresh = await cache.get<StoredResponse>(cacheKey);
      if (fresh) {
        if (validateBody && fresh.bodyHash !== null && fresh.bodyHash !== bodyHash) {
          const conflict = Response.json(
            { message: "This Idempotency-Key was used with a different request body." },
            { status: 422 },
          );
          http.response = conflict;
          return conflict;
        }
        const replay = _rehydrate(fresh, true);
        http.response = replay;
        return replay;
      }

      await next();

      if (http.response && http.response.status < 500) {
        const serialized = await _serialize(http.response, bodyHash);
        // Replace http.response with a fresh response so the body is reusable
        // by anything downstream that still needs to read it.
        http.response = _rehydrate(serialized, false);
        await cache.set(cacheKey, serialized, ttl);
        return http.response;
      }

      const fallback = http.response ?? new Response("", { status: 500 });
      http.response = fallback;
      return fallback;
    };

    // ── Execute under a cross-process lock, then resolve in-process waiters ────
    const lock = this._resolveLock();
    const runGuarded = async (): Promise<Response> => {
      if (!lock) return executeOnce();
      try {
        return await lock.block(`idempotency:lock:${cacheKey}`, IDEMPOTENCY_LOCK_TTL, executeOnce, {
          timeout: IDEMPOTENCY_LOCK_WAIT,
          retryDelay: 50,
        });
      } catch (err) {
        // Couldn't get the lock in time — run anyway rather than fail the request.
        if (err instanceof LockNotAcquiredError) return executeOnce();
        throw err;
      }
    };

    let resolveInFlight!: (r: Response) => void;
    const inFlightPromise = new Promise<Response>((resolve) => {
      resolveInFlight = resolve;
    });
    IdempotencyMiddleware._inFlight.set(cacheKey, inFlightPromise);

    try {
      const result = await runGuarded();
      resolveInFlight(result.clone());
      return result;
    } catch (err) {
      resolveInFlight(new Response("", { status: 500 }));
      throw err;
    } finally {
      IdempotencyMiddleware._inFlight.delete(cacheKey);
    }
  }

  /** Resolve the lock manager: explicit option, else the container's `lock` binding. */
  private _resolveLock(): LockManager | null {
    if (this.options.lock) return this.options.lock;
    if (!this.options.useLock) return null;
    try {
      return (currentApp().container.tryMake("lock") as LockManager | null) ?? null;
    } catch {
      return null;
    }
  }

  /** @internal — expose for testing only */
  static _clearInFlight(): void {
    IdempotencyMiddleware._inFlight.clear();
  }
}

// ── Serialization helpers ─────────────────────────────────────────────────────

async function _serialize(res: Response, bodyHash: string | null): Promise<StoredResponse> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await res.clone().text();
  return { status: res.status, headers, body, bodyHash };
}

function _rehydrate(stored: StoredResponse, replay: boolean): Response {
  const headers = { ...stored.headers };
  if (replay) headers["Idempotency-Replay"] = "true";
  return new Response(stored.body, { status: stored.status, headers });
}

async function _hashBody(req: Request): Promise<string> {
  const buf = await req.clone().arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Buffer.from(hash).toString("hex");
}
