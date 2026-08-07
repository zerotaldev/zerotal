import { request, RequestContext } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import type { SessionManager } from "./SessionManager.ts";

type SessionCtx = HttpContext & { session?: SessionManager };

/**
 * @internal Resolve the in-flight request's {@link SessionManager} from
 * {@link RequestContext}, or `undefined` when no request/session is active.
 */
function _session(): SessionManager | undefined {
  return (RequestContext.tryGet() as SessionCtx | undefined)?.session;
}

/**
 * Developer-facing session API — the object reachable as `ctx.session` and via
 * the `Session` facade.
 *
 * A single instance is bound to `session` in the container. It holds no state of
 * its own: every method resolves the current request's {@link SessionManager}
 * from {@link RequestContext} and forwards to it, so a call is always scoped to
 * the in-flight request. Use it to read and write per-user session values, pull
 * one-shot data, and rotate the session ID on privilege changes.
 *
 * @remarks
 * Mutations are made in memory during the request and persisted by
 * {@link SessionMiddleware} after the response is produced (via the configured
 * driver). If no session is active on the current request — e.g. the middleware
 * has not run — every method degrades gracefully: readers return `undefined`
 * / `false` / `""` and writers become no-ops rather than throwing.
 *
 * The cookie driver enforces the 4096-byte browser cookie limit at save time,
 * so storing large values can cause {@link SessionCookieOverflowError} to be
 * thrown from the middleware (not from these methods) — keep only identifiers
 * in the session and move bulky data to a server-side store (Redis driver).
 *
 * @example
 * ```ts
 * // Inside a controller / route handler
 * export async function show(ctx: HttpContext) {
 *   const session = ctx.session;
 *
 *   // Read & write
 *   const views = session.get<number>("views") ?? 0;
 *   session.set("views", views + 1);
 *
 *   if (!session.has("visited")) session.set("visited", true);
 * }
 *
 * // On login: rotate the ID to prevent session fixation, then store the user
 * export async function login(ctx: HttpContext) {
 *   ctx.session.regenerate();
 *   ctx.session.set("user_id", user.id);
 *
 *   // One-shot value read back exactly once on the next request
 *   const target = ctx.session.intended("/dashboard");
 *   return redirect(target);
 * }
 * ```
 *
 * @see {@link SessionManager} — the per-request object each method delegates to.
 *
 * @remarks
 * Consumed by `createFacade('session')` — do not instantiate directly.
 */
export class SessionAccessor {
  /**
   * Read a value previously stored under `key`.
   *
   * @typeParam T - Expected type of the stored value; used only to cast the
   * result — no runtime validation is performed.
   * @param key - The key of the value to retrieve.
   * @returns The stored value, or `undefined` if the key is absent (or no
   * session is active on the current request).
   *
   * @category Reading
   */
  get<T = unknown>(key: string): T | undefined {
    return _session()?.get(key) as T | undefined;
  }
  /**
   * Read a value and remove it from the session in one step ("read once").
   *
   * Handy for consuming one-shot data such as flash messages: the value is
   * returned and deleted, so a subsequent {@link get} returns `undefined`.
   *
   * @typeParam T - Expected type of the stored value.
   * @param key - The key of the value to retrieve and remove.
   * @returns The stored value, or `undefined` if the key is absent.
   *
   * @category Flash data
   */
  pull<T = unknown>(key: string): T | undefined {
    return _session()?.pull(key) as T | undefined;
  }
  /**
   * Store a value under `key`, overwriting any existing value.
   *
   * The write is held in memory and persisted by {@link SessionMiddleware}
   * after the response is generated.
   *
   * @param key - The key of the value to set.
   * @param value - The value to store (must be JSON-serializable to persist).
   *
   * @category Writing
   */
  set(key: string, value: unknown): void {
    _session()?.set(key, value);
  }

  /**
   * Report whether `key` is present in the session.
   *
   * @param key - The key to check for existence in the session.
   * @returns `true` if the key exists, otherwise `false` (also `false` when no
   * session is active on the current request).
   *
   * @category Reading
   */
  has(key: string): boolean {
    return _session()?.has(key) ?? false;
  }

  /**
   * Remove a single value from the session.
   *
   * @param key - The key of the value to remove from the session.
   *
   * @category Writing
   */
  forget(key: string): void {
    _session()?.forget(key);
  }

  /**
   * Remove every value from the session, leaving it empty. The session ID is
   * left unchanged — use {@link regenerate} to rotate the ID as well.
   *
   * @category Writing
   */
  flush(): void {
    _session()?.flush();
  }

  /**
   * Issue a fresh session ID while preserving the current session data.
   *
   * Call this on any privilege change (most importantly on login) to prevent
   * session-fixation attacks. The middleware destroys the server-side record of
   * the previous ID after the response, so the old ID cannot be replayed.
   *
   * @category Lifecycle
   */
  regenerate(): void {
    _session()?.regenerate();
  }

  /**
   * Return the current session ID.
   *
   * @returns The session ID, or `""` when no session is active on the current
   * request.
   *
   * @category Reading
   */
  id(): string {
    return _session()?.id() ?? "";
  }

  /**
   * Consume the previously captured "intended" URL (see {@link captureIntended}).
   *
   * The stored URL is pulled (read once and removed), so after a redirect the
   * value is gone. Typically used after login to send the user back to the page
   * they originally requested.
   *
   * @param defaultUrl - Fallback returned when no intended URL was captured.
   * Defaults to `"/"`.
   * @returns The captured URL, or `defaultUrl` if none is stored.
   *
   * @category Redirect flow
   */
  intended(defaultUrl: string = "/"): string {
    return (_session()?.pull("intended") as string) ?? defaultUrl;
  }

  /**
   * Remember the current request's full URL as the "intended" destination.
   *
   * Call this before redirecting an unauthenticated user to the login page so
   * that {@link intended} can send them back afterwards.
   *
   * @category Redirect flow
   */
  captureIntended(): void {
    _session()?.set("intended", request().fullUrl());
  }
}
