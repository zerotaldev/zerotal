import { request, RequestContext, safeRedirectPath } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import type { SessionManager } from "./SessionManager.ts";

type SessionCtx = HttpContext & { session?: SessionManager };

/**
 * The session key holding where an intercepted request was headed.
 *
 * One key, named here, because it is written and read by four things that do not
 * import each other — `AuthMiddleware`, `ConfirmPasswordMiddleware`,
 * `redirect().intended()` and this accessor — and two of them used to spell it
 * differently.
 */
const INTENDED_URL_KEY = "intended_url";

/** What this accessor used to write. Still read, so a session mid-flow is not stranded. */
const LEGACY_INTENDED_URL_KEY = "intended";

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
   * Reads the same key `AuthMiddleware` writes and `redirect().intended()` reads.
   * It did not: this pair used `intended` while the rest of the framework used
   * `intended_url`, so the two halves of one feature never met. An app that let
   * `AuthMiddleware` intercept a guest — the documented way — and then reached for
   * `ctx.session.intended()` — the obvious API on the session object — got the
   * fallback every time, on a session where the value was sitting there under the
   * other name. Nothing failed; the user was simply always sent to `/`, which
   * reads from the outside as the intended URL not surviving login.
   *
   * The legacy key is still read, so a session captured before the upgrade and
   * consumed after it still lands where it should.
   *
   * @param defaultUrl - Fallback returned when no intended URL was captured, or
   *   when the captured one points at another origin. Defaults to `"/"`.
   * @returns The captured URL, or `defaultUrl` if none is stored.
   *
   * @category Redirect flow
   */
  intended(defaultUrl: string = "/"): string {
    const session = _session();
    const stored =
      (session?.pull(INTENDED_URL_KEY) as string | undefined) ??
      (session?.pull(LEGACY_INTENDED_URL_KEY) as string | undefined);

    // Same guard `redirect().intended()` applies. `captureIntended()` only ever
    // stores this request's own URL, but the key is a plain session value and
    // anything that can write one could otherwise choose where a login lands.
    const origin = RequestContext.tryGet()?.url.origin;
    if (!origin) return stored ?? defaultUrl;
    return safeRedirectPath(stored, origin) ?? defaultUrl;
  }

  /**
   * Remember the current request's full URL as the "intended" destination.
   *
   * Call this before redirecting an unauthenticated user to the login page so
   * that {@link intended} can send them back afterwards.
   *
   * Writes `intended_url`, the key `AuthMiddleware` writes and
   * `redirect().intended()` reads — so the capture and the redirect can come from
   * either API in any combination.
   *
   * @category Redirect flow
   */
  captureIntended(): void {
    _session()?.set(INTENDED_URL_KEY, request().fullUrl());
  }
}
