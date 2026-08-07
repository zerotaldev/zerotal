import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";

export interface GuestOptions {
  /** Path to redirect authenticated users to. Defaults to `'/'`. */
  redirectTo?: string;
}

/**
 * Ensures the request is from a guest (not authenticated) — the inverse of
 * {@link AuthMiddleware}. If `ctx.user` is set (populated upstream by
 * {@link PersistUserMiddleware}), it returns a 302 redirect to `redirectTo`
 * (default `/`) instead of running the route; otherwise the request proceeds.
 *
 * Use on routes that should only be reachable by unauthenticated users, e.g.
 * login and registration pages.
 *
 * @example
 * ```ts
 * Router.get('/login', AuthController, 'showLogin', [GuestMiddleware]);
 * Router.post('/login', AuthController, 'login',    [GuestMiddleware]);
 *
 * // Override the redirect target:
 * app.use([GuestMiddleware.with({ redirectTo: '/dashboard' })]);
 * ```
 */
export class GuestMiddleware extends BaseMiddleware<GuestOptions> {
  protected options: GuestOptions = { redirectTo: "/" };

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (http.user) {
      return Response.redirect(this.options.redirectTo ?? "/", 302);
    }
    return next();
  }
}
