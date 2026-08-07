import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, FrameworkEvents } from "@zerotal/core";
import { LoggedOut } from "./events.ts";
import type { SessionManager } from "@zerotal/session";

/** Session key holding a snapshot of the user's password hash for this session. */
export const AUTH_PASSWORD_HASH_KEY = "auth_password_hash";

export interface AuthenticateSessionOptions {
  /** Where to send a session that has been invalidated. Default `/login`. */
  redirectTo?: string;
}

/** A user model exposing the hashed password (from `Authenticatable`). */
type WithPassword = { getAuthPassword?(): string | null; getAuthId?(): number };

/**
 * Binds a session to the user's current password hash so that
 * {@link Auth.logoutOtherDevices} (and any password change) can invalidate the
 * user's *other* sessions without server-side session storage.
 *
 * On the first authenticated request it snapshots `getAuthPassword()` into the
 * session. On later requests it compares the snapshot to the user's current
 * hash; a mismatch means the password hash changed elsewhere, so this session is
 * stale and gets torn down (redirect to `redirectTo`, or `401` for JSON).
 *
 * Attach it after the auth guard on routes that should be revocable:
 *
 * @example
 * Router.group({ middleware: [AuthMiddleware, AuthenticateSessionMiddleware] }, () => {
 *   // ...the bulk of your authenticated routes
 * });
 */
export class AuthenticateSessionMiddleware extends BaseMiddleware<AuthenticateSessionOptions> {
  protected options: AuthenticateSessionOptions = { redirectTo: "/login" };

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const user = http.user as WithPassword | undefined;
    const session = http.session as SessionManager | undefined;

    if (user && session && typeof user.getAuthPassword === "function") {
      const current = user.getAuthPassword();
      const stored = session.get(AUTH_PASSWORD_HASH_KEY) as string | undefined;

      if (stored === undefined) {
        // First authenticated request in this session — snapshot the hash.
        if (current) session.set(AUTH_PASSWORD_HASH_KEY, current);
      } else if (current && stored !== current) {
        // The password hash changed elsewhere (password change or
        // logoutOtherDevices) — this session is stale. Tear it down.
        const userId = user.getAuthId?.();
        session.flush();
        http.user = undefined;
        if (userId !== undefined && userId !== null) {
          FrameworkEvents.emit(new LoggedOut("web", userId, http));
        }
        if (http.wantsJson()) {
          return Response.json({ message: "Unauthenticated." }, { status: 401 });
        }
        http.redirect(this.options.redirectTo ?? "/login", 302);
        return http.response;
      }
    }

    return next();
  }
}
