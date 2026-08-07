import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, readCookie } from "@zerotal/core";
import type { SessionManager } from "@zerotal/session";
import type { AuthUser } from "./AuthUser.ts";
import {
  REMEMBER_COOKIE,
  buildRememberCookie,
  encodeRememberValue,
  forgetRememberCookie,
  hashRememberToken,
  mintRememberToken,
  parseRememberValue,
  rememberTokenMatches,
  type RememberAction,
} from "./RememberMe.ts";

export interface RememberMeOptions {
  /**
   * Mark the remember cookie `Secure`. Defaults to `true` — this is a long-lived,
   * password-free credential. Set `false` only for local HTTP development.
   */
  secure?: boolean;
}

/** A user model exposing the remember-token contract (from `Authenticatable`). */
type Rememberable = {
  getRememberToken?(): string | null;
  setRememberToken?(value: string | null): void;
  save?(): Promise<unknown>;
};

/**
 * Persistent "remember me" login.
 *
 * Registered globally by `AuthProvider`, **after** `PersistUserMiddleware`:
 *
 * - **Read** (before the request): when no user was restored from the session, it
 *   reads the `remember_web` cookie (`id|token`), loads the user by id, and
 *   constant-time-compares `sha256(token)` to the stored hash. On a match it
 *   re-authenticates the user, re-seeds the session, and flags `Auth.viaRemember()`.
 * - **Write** (after the request): it flushes any cookie action queued by
 *   `Auth.login({ remember: true })` / `Auth.logout()` onto the response.
 *
 * The user loader is the same `auth.userLoader` binding `PersistUserMiddleware`
 * uses; if none is registered, the read step is a silent no-op.
 */
export class RememberMeMiddleware extends BaseMiddleware<RememberMeOptions> {
  protected options: RememberMeOptions = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!http.user) await this._attemptFromCookie(http);

    const result = await next();

    this._flushCookie(http);
    return result;
  }

  /**
   * Load a user for a remember-cookie id via the `auth.userLoader` binding.
   * Returns null (no throw) when no loader is registered — remember-me is
   * best-effort and must never break a request.
   */
  protected async loadUser(userId: number, ctx: HttpContext): Promise<AuthUser | null> {
    const loader = (
      ctx.container as unknown as { container?: { tryMake?(key: string): unknown } }
    )?.container?.tryMake?.("auth.userLoader") as
      ((id: number) => Promise<AuthUser | null>) | undefined;
    if (!loader) return null;
    return loader(userId);
  }

  private async _attemptFromCookie(http: HttpContext): Promise<void> {
    const raw = this._readCookie(http.request);
    if (!raw) return;

    const parsed = parseRememberValue(raw);
    if (!parsed) return;

    const id = Number(parsed.id);
    if (!Number.isFinite(id)) return;

    let user: AuthUser | null;
    try {
      user = await this.loadUser(id, http);
    } catch {
      return; // loader failure must not break the request
    }
    if (!user) return;

    const stored = (user as Rememberable).getRememberToken?.();
    if (!stored || !rememberTokenMatches(parsed.token, stored)) return;

    // Re-authenticate for this request and promote back to a real session.
    http.user = user;
    (http as { _viaRemember?: boolean })._viaRemember = true;
    const session = http.session as SessionManager | undefined;
    // Same session-fixation defence as every other login path: the session id in play
    // before this request was a guest's, and it is about to become an authenticated one.
    session?.regenerate?.();
    session?.set("user_id", id);

    await this._rotate(http, user, id);
  }

  /**
   * Replace the token on every successful cookie login.
   *
   * A remember token is a bearer credential with a 400-day life. Without rotation, one
   * interception — a backup, a shared machine, a proxy log — is valid for the whole of that
   * window. Rotating narrows it to the gap before the real user's next visit, and a
   * subsequent use of the old token silently fails to authenticate.
   *
   * Persistence failures are swallowed: remember-me is best-effort and must never break a
   * request. The old token simply stays valid until the next attempt.
   */
  private async _rotate(http: HttpContext, user: AuthUser, id: number): Promise<void> {
    const rotatable = user as Rememberable & {
      setRememberToken?(value: string | null): void;
      save?(): Promise<unknown>;
    };
    if (typeof rotatable.setRememberToken !== "function" || typeof rotatable.save !== "function") {
      return;
    }

    const raw = mintRememberToken();
    rotatable.setRememberToken(hashRememberToken(raw));
    try {
      await rotatable.save();
    } catch {
      return; // keep the existing cookie/token pair rather than desynchronising them
    }
    (http as { _rememberMe?: RememberAction })._rememberMe = {
      type: "set",
      value: encodeRememberValue(id, raw),
    };
  }

  private _flushCookie(http: HttpContext): void {
    const action = (http as { _rememberMe?: RememberAction })._rememberMe;
    if (!action) return;
    const response = http.response as Response | undefined;
    if (!response) return;

    // Secure-by-default. Sniffing `https:` off the request URL got this backwards: behind a
    // TLS-terminating proxy the internal URL is `http:`, so the one deployment that most
    // needs `Secure` was the one that silently lost it.
    const secure = this.options.secure ?? true;
    response.headers.append(
      "Set-Cookie",
      action.type === "set"
        ? buildRememberCookie(action.value, { secure })
        : forgetRememberCookie(secure),
    );
  }

  /** Read the remember cookie, preferring native `Bun.CookieMap` with a header fallback. */
  private _readCookie(request: Request): string | undefined {
    return readCookie(request, REMEMBER_COOKIE);
  }
}
