import { BaseMiddleware, type HttpContext, type NextFn } from "zerotal";
import { Auth } from "zerotal/auth";
import { trackSession } from "@app/auth/sessions";

/**
 * Keeps app/auth/sessions.ts's record of this browser current, and signs the browser
 * out when that record has been deleted — which is what "Sign out other sessions" in
 * Settings → Sessions does to every browser but the one it was clicked in.
 *
 * Runs on every signed-in route (app/routes/(auth)/_middleware.ts).
 */
export class TrackSession extends BaseMiddleware {
  protected options = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const user = Auth.userOrNull();
    if (user && (await trackSession(http, user.id)) === "revoked") {
      await Auth.logout();
      http.flash("info", "You were signed out from another device.");
      http.redirect("/login", 302);
      return http.response;
    }
    return next();
  }
}
