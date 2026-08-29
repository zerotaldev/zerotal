import { BaseMiddleware, UnauthorizedError } from "@zerotal/core";
import type { NextFn, HttpContext } from "@zerotal/core";
import type { SessionManager } from "@zerotal/session";

/** Session key written after a successful 2FA challenge. */
export const TWO_FACTOR_SESSION_KEY = "two_factor_confirmed";

/**
 * Session key written by {@link Auth.login} when the user has a confirmed second factor.
 *
 * While it is set the session is *half* authenticated: the password matched, the second
 * factor has not been presented. `PersistUserMiddleware` therefore leaves `ctx.user`
 * unset — so every route, API endpoint, admin page and Flow action treats the request
 * as a guest — and exposes the user only through {@link Auth.pendingTwoFactorUser} so the
 * challenge page can render. {@link Auth.completeTwoFactor} clears it.
 *
 * This is what makes 2FA a *login* gate rather than a per-route one: enforcement does not
 * depend on a developer remembering to attach {@link TwoFactorMiddleware} to a route.
 *
 * @internal
 */
export const TWO_FACTOR_PENDING_KEY = "two_factor_pending";

/**
 * Session key recording that the pending login asked to be remembered. The remember cookie
 * is a password-free credential, so it is minted by {@link Auth.completeTwoFactor} rather
 * than at password time.
 *
 * @internal
 */
export const TWO_FACTOR_REMEMBER_KEY = "two_factor_pending_remember";

/**
 * TwoFactorMiddleware — enforce 2FA completion for the current session.
 *
 * Place this **after** `AuthMiddleware` in your route stack.
 *
 * Behavior:
 * - Session awaiting its second factor ({@link TWO_FACTOR_PENDING_KEY}) → redirect to the challenge page.
 * - Otherwise unauthenticated → `UnauthorizedError` (401).
 * - User has no 2FA configured (`twoFactorSecret` is null/empty) → pass through.
 * - 2FA is configured but NOT confirmed this session → redirect to the challenge page.
 * - 2FA is configured AND confirmed this session → pass through.
 *
 * This middleware is a convenience, not the enforcement point. `Auth.login` marks a session
 * with a confirmed second factor as pending and `PersistUserMiddleware` withholds `ctx.user`
 * until the challenge is met, so a route that forgets this middleware still sees a guest.
 * Attach it where you want the redirect-to-challenge behaviour instead of a bare 401.
 *
 * The challenge page verifies the submitted code via `TwoFactorService.verifyCode()` and then
 * calls `Auth.completeTwoFactor()`, which clears the pending marker, records the challenge as
 * met, and rotates the session id.
 *
 * @example
 * ```ts
 * // In bootstrap/app.ts (authenticated group):
 * Router.group({ middleware: [AuthMiddleware, TwoFactorMiddleware] }, () => {
 *   Router.get('/dashboard', DashboardController, 'index');
 * });
 * ```
 * @throws {UnauthorizedError} When the request is unauthenticated (`http.user` is unset).
 */
export class TwoFactorMiddleware extends BaseMiddleware {
  protected options = {};

  /**
   * The route users are redirected to when 2FA is required.
   * Override by subclassing or set `TwoFactorMiddleware.challengeRoute`.
   */
  static challengeRoute = "/two-factor/challenge";

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const pendingSession = http.session as SessionManager | undefined;
    if (pendingSession?.get(TWO_FACTOR_PENDING_KEY) === true) {
      http.redirect(TwoFactorMiddleware.challengeRoute);
      return http.response;
    }

    if (!http.user) throw new UnauthorizedError();

    const user = http.user as unknown as Record<string, unknown>;

    // If user doesn't have 2FA enabled, skip this middleware entirely.
    const hasSecret =
      typeof user["twoFactorSecret"] === "string" && user["twoFactorSecret"].length > 0;

    const isConfirmed = user["twoFactorConfirmedAt"] != null && user["twoFactorConfirmedAt"] !== "";

    if (!hasSecret || !isConfirmed) return next();

    // Check whether the current session has completed the 2FA challenge.
    const session = http.session as SessionManager | undefined;
    const confirmed = session?.get(TWO_FACTOR_SESSION_KEY);

    if (confirmed === true) return next();

    // Redirect to the challenge page.
    http.redirect(TwoFactorMiddleware.challengeRoute);
    return http.response;
  }
}
