import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import type { SessionManager } from "@zerotal/session";

export interface AuthOptions {
  /** Path to redirect unauthenticated users to. Defaults to `'/login'`. */
  redirectTo?: string;
  /**
   * Also require the authenticated user to have a verified email. When `true`, a
   * signed-in but unverified user is bounced to `verifyRedirectTo`. No-op for models
   * that don't compose `EmailVerification`. Defaults to `false`.
   */
  mustVerifyEmail?: boolean;
  /** Where to send unverified users when `mustVerifyEmail` is set. Defaults to `'/verify-email'`. */
  verifyRedirectTo?: string;
}

/** The user fields this guard reads — present when the model composes EmailVerification. */
type VerifiableUser = { hasVerifiedEmail?: () => boolean };

/**
 * Guards routes that require an authenticated user — the inverse of
 * {@link GuestMiddleware}.
 *
 * `ctx.user` is populated upstream by `PersistUserMiddleware` (registered globally
 * by `AuthProvider`). This guard checks it:
 *
 * - **Authenticated** → the request proceeds.
 * - **Guest, expects JSON** (API/XHR) → `401 Unauthenticated`.
 * - **Guest, expects HTML** → the originating URL is saved to the session as
 *   `intended_url` and the request is redirected to `redirectTo` (default `/login`).
 *   After a successful login, send the user back with `redirect().intended()` /
 *   `url().intended()`.
 *
 * With `mustVerifyEmail: true` it additionally requires a verified email — an
 * authenticated-but-unverified user is sent to `verifyRedirectTo` (default
 * `/verify-email`), or gets `403 Email not verified.` for JSON requests. The check is
 * skipped on the verify page itself (so it never loops) and for user models that don't
 * compose `EmailVerification`.
 *
 * Use on routes (or a route group) that should only be reachable by signed-in users:
 *   Router.group({ middleware: [AuthMiddleware] }, () => { ... });
 *   Router.flow('/dashboard', DashboardPage, [AuthMiddleware]);
 *
 * Override the targets:
 *   AuthMiddleware.with({ redirectTo: '/sign-in' })
 *   AuthMiddleware.with({ mustVerifyEmail: true, verifyRedirectTo: '/confirm-email' })
 */
export class AuthMiddleware extends BaseMiddleware<AuthOptions> {
  protected options: AuthOptions = {
    redirectTo: "/login",
    mustVerifyEmail: false,
    verifyRedirectTo: "/verify-email",
  };

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    // ── 1. Require authentication ────────────────────────────────────────────
    if (!http.user) {
      if (http.wantsJson()) {
        return Response.json({ message: "Unauthenticated." }, { status: 401 });
      }
      // Remember where the guest was headed so the login flow can send them back
      // via redirect().intended() / url().intended().
      const session = http.session as SessionManager | undefined;
      session?.set("intended_url", http.fullUrl());

      http.redirect(this.options.redirectTo ?? "/login", 302);
      return http.response;
    }

    // ── 2. Optionally require a verified email ───────────────────────────────
    if (this.options.mustVerifyEmail) {
      const verifyPath = this.options.verifyRedirectTo ?? "/verify-email";
      const user = http.user as VerifiableUser;

      // Skip when the model can't be verified, when already verified, or when we're
      // already on the verify page (otherwise the redirect would loop).
      const unverified = typeof user.hasVerifiedEmail === "function" && !user.hasVerifiedEmail();
      if (unverified && http.path() !== verifyPath) {
        if (http.wantsJson()) {
          return Response.json({ message: "Email not verified." }, { status: 403 });
        }
        http.redirect(verifyPath, 302);
        return http.response;
      }
    }

    return next();
  }
}
