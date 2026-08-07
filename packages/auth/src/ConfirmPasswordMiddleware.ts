import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import type { SessionManager } from "@zerotal/session";

/** Session key holding the unix-ms timestamp of the last password confirmation. */
export const PASSWORD_CONFIRMED_AT_KEY = "auth_password_confirmed_at";

/** Default window (seconds) a confirmation stays valid — 3 hours. */
export const DEFAULT_PASSWORD_TIMEOUT = 3 * 60 * 60;

export interface ConfirmPasswordOptions {
  /** Where to send users who must (re)confirm their password. Default `/confirm-password`. */
  redirectTo?: string;
  /** How long a confirmation stays valid, in seconds. Default 10800 (3 hours). */
  timeoutSeconds?: number;
}

/**
 * Require a recent password confirmation before reaching sensitive routes.
 *
 * If the user confirmed their password within `timeoutSeconds`, the request
 * proceeds. Otherwise the originating URL is saved as `intended_url` and the
 * user is redirected to `redirectTo` (or gets `423 Locked` for JSON requests).
 * After they confirm via `Auth.confirmPassword(...)`, send them on with
 * `redirect().intended()`.
 *
 * @example
 * Router.group({ middleware: [AuthMiddleware, ConfirmPasswordMiddleware] }, () => {
 *   Router.get("/settings/security", SecurityController, "show");
 * });
 *
 * // Custom window / target:
 * ConfirmPasswordMiddleware.with({ redirectTo: "/verify", timeoutSeconds: 1800 })
 */
export class ConfirmPasswordMiddleware extends BaseMiddleware<ConfirmPasswordOptions> {
  protected options: ConfirmPasswordOptions = {
    redirectTo: "/confirm-password",
    timeoutSeconds: DEFAULT_PASSWORD_TIMEOUT,
  };

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const session = http.session as SessionManager | undefined;
    const confirmedAt = session?.get(PASSWORD_CONFIRMED_AT_KEY) as number | undefined;
    const timeoutMs = (this.options.timeoutSeconds ?? DEFAULT_PASSWORD_TIMEOUT) * 1000;

    if (typeof confirmedAt === "number" && Date.now() - confirmedAt < timeoutMs) {
      return next();
    }

    if (http.wantsJson()) {
      return Response.json({ message: "Password confirmation required." }, { status: 423 });
    }

    session?.set("intended_url", http.fullUrl());
    http.redirect(this.options.redirectTo ?? "/confirm-password", 302);
    return http.response;
  }
}
