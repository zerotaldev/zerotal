import type { NextFn, HttpContext } from "@zerotal/core";
import { currentApp, BaseMiddleware, sha256Hex } from "@zerotal/core";
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
  lock?: LockManager | undefined;

  /**
   * Whose key this is. A stored response is replayed only to a request with the same scope,
   * method, host, path, query string and key, so two callers who pick the same key never see
   * each other's answer.
   *
   * The default is the authenticated user (`ctx.user`): `user:<type>:<id>` when the request
   * authenticated with a personal access token, whose subject type the token carries, and
   * `user:<id>` otherwise. With no user it is `session:<id>`, but only when the client sent an
   * existing session back (`ctx.session.resumed()`); a session started on this request is not a
   * scope, because a client that does not keep cookies is given a new one every time and its
   * retry would never find its own answer. Anything else is `undefined`, which means unscoped:
   * every such caller shares one key space per method, host, path and query. The default reads
   * what the auth and session middleware put on the context, so this middleware must run after
   * them.
   *
   * A handler can change who the caller is, so when it runs, its answer is also stored under
   * the scope the client's retry will have, read after the handler: the user the session's
   * `user_id` names if the handler changed it (the session auth middleware signs the retry in
   * from it, whatever `ctx.user` still says), else the user on `ctx.user`, else the session
   * whose cookie the response carries, whether it was regenerated or started for a
   * first request that sent no cookie. A retry of a registration, a sign-in, a sign-out or a
   * second-factor step that carries the cookie its answer set is therefore replayed. A request
   * that was replayed or waited on another stores nothing, so the cache does not grow with
   * replays; the cost is that a client with no cookie that is replayed its answer and then
   * retries with the cookie that replay set runs the handler again. An answer is never copied
   * under the unscoped key, and a scoped request never falls back to it. A `scope` you pass
   * turns this off.
   *
   * Only the token middleware exposes a subject type. A user set by the session, a JWT or any
   * other guard is scoped by id alone, so two kinds of subject with the same id, authenticated
   * that way, share a scope; pass a `scope` that includes the type if that can happen.
   *
   * Return something the request has proved about its caller, such as a verified API client
   * id, when the default does not identify it; never a value the client can choose freely.
   */
  scope?: ((http: HttpContext) => string | undefined) | undefined;
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
 * A key belongs to its caller and its endpoint: the stored response, the in-flight
 * slot and the lock are all named from the {@link IdempotencyOptions.scope | scope}
 * (by default the authenticated user, else a session the client sent back, else none),
 * the method, the host, the URL path, the query string and the client's key, so the same
 * key from another user, or sent to another host, path or query, is a different key. Run it
 * after the auth and session middleware so the default scope can see them.
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

  // Per-process in-flight requests, one table per CacheManager: coalesces concurrent
  // requests with the same key so only one handler execution runs at a time within this
  // process. Per manager because two managers are two namespaces (a tenant's prefixed
  // cache, say), and a request must never wait on, or be handed, another namespace's
  // response.
  private static _inFlight = new WeakMap<CacheManager, Map<string, Promise<Response>>>();

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const method = http.request.method.toUpperCase();
    if (!this.options.methods.includes(method)) return next();

    const idempotencyKey = http.header(this.options.header);
    if (!idempotencyKey) return next();

    const { cache, ttl, validateBody } = this.options;
    if (!cache) return next();

    // One key names the stored response, the in-flight slot and the lock. It is a digest
    // so that no part (a scope, host, path or query containing the separator) can
    // impersonate another, and so the session id behind a session scope never sits in the
    // cache in clear. The host keeps two tenants on subdomains of one app apart, and the
    // query keeps `?account=1` and `?account=2` apart.
    const clientKey = idempotencyKey.trim().slice(0, 512);
    const keyFor = (scope: string | undefined): string =>
      `idempotency:${sha256Hex(
        JSON.stringify([
          scope ?? null,
          method,
          http.url.host.toLowerCase(),
          http.url.pathname,
          http.url.search,
          clientKey,
        ]),
      )}`;
    const scope = (this.options.scope ?? _defaultScope)(http);
    const cacheKey = keyFor(scope);

    // A browser's first request carries no session cookie, so it is unscoped, but the
    // session middleware started a session for it and sends that cookie with this
    // response, so the browser's retry is scoped to the new session. A retry that arrives
    // while this request is still running waits on it under that scope too. A lookup never
    // falls back from a scoped key to the unscoped one.
    const startedSessionKey = (): string | undefined => {
      if (this.options.scope || scope !== undefined) return undefined;
      const session = http.session;
      if (!session || session.resumed?.() === true) return undefined;
      return keyFor(`session:${session.id()}`);
    };

    const inFlightRequests =
      IdempotencyMiddleware._inFlight.get(cache) ?? new Map<string, Promise<Response>>();
    IdempotencyMiddleware._inFlight.set(cache, inFlightRequests);

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
    const inFlight = inFlightRequests.get(cacheKey);
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

      const signedInBefore = http.session?.get("user_id");
      await next();

      if (http.response && http.response.status < 500) {
        const serialized = await _serialize(http.response, bodyHash);
        // Replace http.response with a fresh response so the body is reusable
        // by anything downstream that still needs to read it.
        http.response = _rehydrate(serialized, false);
        await cache.set(cacheKey, serialized, ttl);
        // The handler may have changed who the caller is: signed them in or out, finished a
        // second factor, regenerated their session, or (on a first request with no cookie)
        // started the session its retry will carry. The retry is scoped by what the auth and
        // session middleware make of the cookie this response sends, so the answer is stored
        // under that scope too. Only here, where the handler ran: a replay or a wait answers
        // with what is already stored, and copying it again would let a client that keeps no
        // cookies write a full response to the cache with every replay.
        if (!this.options.scope) {
          for (const after of _scopesAfter(http, signedInBefore)) {
            if (after !== scope) await cache.set(keyFor(after), serialized, ttl);
          }
        }
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
        // The lock is shared by every process and every cache on its backend, so its name
        // carries the cache's own prefix as well as the key.
        const lockName = `idempotency:lock:${cache.prefix}${cacheKey}`;
        return await lock.block(lockName, IDEMPOTENCY_LOCK_TTL, executeOnce, {
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
    inFlightRequests.set(cacheKey, inFlightPromise);
    // A retry that already carries the new session's cookie waits on this request too.
    const sessionInFlightKey = startedSessionKey();
    const joinable =
      sessionInFlightKey !== undefined && !inFlightRequests.has(sessionInFlightKey)
        ? sessionInFlightKey
        : undefined;
    if (joinable) inFlightRequests.set(joinable, inFlightPromise);

    try {
      const result = await runGuarded();
      resolveInFlight(result.clone());
      return result;
    } catch (err) {
      resolveInFlight(new Response("", { status: 500 }));
      throw err;
    } finally {
      inFlightRequests.delete(cacheKey);
      if (joinable && inFlightRequests.get(joinable) === inFlightPromise) {
        inFlightRequests.delete(joinable);
      }
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
    IdempotencyMiddleware._inFlight = new WeakMap();
  }
}

// ── Scope ─────────────────────────────────────────────────────────────────────

/**
 * The default {@link IdempotencyOptions.scope}: the authenticated user, else a session the
 * client sent back, else unscoped. `ctx.user` is declared by the auth package, which this one
 * does not depend on, so it is read by shape, along with the token row `BearerTokenMiddleware`
 * attaches to it as `_token`, whose `tokenable_type` names the kind of subject.
 */
function _defaultScope(http: HttpContext): string | undefined {
  const user = _userScope(http);
  if (user !== undefined) return user;
  // A session started on this request is not a scope: its id will not come back, so a
  // client that does not keep cookies would never be replayed its own answer.
  const session = http.session;
  if (session?.resumed?.() === true) return `session:${session.id()}`;
  return undefined;
}

/** `user:<type>:<id>` for a token's subject, `user:<id>` for any other user, else undefined. */
function _userScope(http: HttpContext): string | undefined {
  const user = (
    http as { user?: { id?: unknown; _token?: { tokenable_type?: unknown } | null } | null }
  ).user;
  const userId = user?.id;
  if (typeof userId !== "string" && typeof userId !== "number" && typeof userId !== "bigint") {
    return undefined;
  }
  const type = user?._token?.tokenable_type;
  return typeof type === "string" ? `user:${type}:${String(userId)}` : `user:${String(userId)}`;
}

/**
 * The default scopes a retry of this request can arrive with, read once the handler has run:
 * the scope the auth and session middleware will give it from the cookie this response sends.
 *
 * The session auth middleware signs the retry in as the session's `user_id`, so a handler
 * that changed it (`signedInBefore` is what it held before) decides the scope, whatever
 * `ctx.user` still says: a handler that signs in or out through the session alone does not
 * always update `ctx.user`. A new `user_id` gives that user's scope, unless `ctx.user` already
 * names the same user, together with the scope of the session whose cookie this response
 * carries, because a session still waiting on its second factor holds a `user_id` that does
 * not sign the retry in. A `user_id` taken away gives that session's guest scope. When the
 * handler left `user_id` alone, the user on the context is the scope, else that session's
 * guest, whether it was regenerated or newly started. Never `undefined`: an answer given to a
 * scoped caller is not copied into the unscoped key space.
 */
function _scopesAfter(http: HttpContext, signedInBefore: unknown): string[] {
  const user = _userScope(http);
  const session = http.session;
  if (!session) return user === undefined ? [] : [user];
  const guest = `session:${session.id()}`;
  const signedIn = session.get("user_id");
  if (signedIn === signedInBefore) return [user ?? guest];
  if (typeof signedIn !== "string" && typeof signedIn !== "number") return [guest];
  const sessionUser = `user:${String(signedIn)}`;
  return sessionUser === user ? [user] : [sessionUser, guest];
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
