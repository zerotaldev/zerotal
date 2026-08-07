import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, FrameworkEvents } from "@zerotal/core";
import { LoginFailed } from "./events.ts";
import { TWO_FACTOR_PENDING_KEY } from "./TwoFactorMiddleware.ts";
import type { SessionManager } from "@zerotal/session";
import type { AuthUser } from "./AuthUser.ts";

/**
 * Reads 'user_id' from the active session and populates ctx.user.
 *
 * This is the *populate* step, not a guard: it never blocks a request. If there is
 * no `user_id` in the session the request simply continues as a guest
 * (ctx.user = undefined). If a `user_id` is present but the user no longer exists,
 * the stale session entry is cleared.
 *
 * `AuthProvider` registers this globally, so `ctx.user` / `Auth.user()` are
 * available everywhere — you do not wire it up yourself. To *require* an
 * authenticated user on a route, use {@link AuthMiddleware} (the guard).
 *
 * The user loader is resolved from the `auth.userLoader` container binding, which
 * `AuthProvider` registers (from the convention default or `AuthProvider.resolveUsing(...)`).
 *
 * A session whose second factor is still outstanding is *not* populated: the user is
 * exposed only via `Auth.pendingTwoFactorUser()` so the challenge page can render, while
 * `ctx.user` stays unset for every guard and handler. See {@link TWO_FACTOR_PENDING_KEY}.
 *
 * After this middleware runs:
 *   Auth.check()      → true if a user was found
 *   Auth.user()       → the authenticated user (throws if guest)
 *   Auth.userOrNull() → the user or undefined
 */
export class PersistUserMiddleware extends BaseMiddleware {
  protected options: {} = {};

  /**
   * Load the user for a given session user_id from the `auth.userLoader`
   * container binding. Override this in a subclass for per-request loader logic.
   *
   * @param userId - The `user_id` read from the session.
   * @param ctx - The current HTTP context (used to reach the container).
   * @returns The user, or `null` when the id no longer resolves to a user.
   * @throws {Error} when no `auth.userLoader` binding is registered (call `AuthProvider.resolveUsing(...)`).
   */
  protected async loadUser(userId: number, ctx: HttpContext): Promise<AuthUser | null> {
    const containerLoader = (
      ctx.container as unknown as {
        container?: { tryMake?(key: string): unknown };
      }
    )?.container?.tryMake?.("auth.userLoader") as
      ((id: number) => Promise<AuthUser | null>) | undefined;

    if (containerLoader) return containerLoader(userId);

    throw new Error(
      `[Zerotal Auth] No user loader registered. Call AuthProvider.resolveUsing(async (id) => User.find(id)) ` +
        `in bootstrap/app.ts, or bind 'auth.userLoader' in a ServiceProvider.`,
    );
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const session = http.session as SessionManager | undefined;

    if (session) {
      const userId = session.get("user_id");

      if (userId !== undefined && userId !== null) {
        const user = await this.loadUser(userId as number, http);

        if (user) {
          // A session awaiting its second factor is not authenticated. Hand the user to
          // the challenge page via a private slot instead of `ctx.user`, so every guard,
          // route, API endpoint and Flow action still sees a guest. This is the
          // enforcement point for 2FA — attaching TwoFactorMiddleware only changes the
          // 401 into a redirect.
          if (session.get(TWO_FACTOR_PENDING_KEY) === true) {
            (http as { _twoFactorPendingUser?: AuthUser })._twoFactorPendingUser = user;
          } else {
            http.user = user;
          }
        } else {
          session.forget("user_id");
          FrameworkEvents.emit(new LoginFailed("web", String(userId), "stale_session", http));
        }
      }
    }

    return next();
  }
}
