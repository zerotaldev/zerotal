import type { HttpContext } from "@zerotal/core";
import { SessionMiddleware } from "./SessionMiddleware.ts";
import type { SessionDriver } from "./drivers/CookieDriver.ts";
import type { SessionManager } from "./SessionManager.ts";

type UserFinder = (id: number) => Promise<{ id: number; [key: string]: unknown } | null>;

/**
 * Session middleware that also resolves the authenticated user.
 *
 * Extends {@link SessionMiddleware}: after the session loads, it reads the
 * numeric `user_id` from the session and calls the supplied `findUser` callback.
 * When a user is returned it is attached to `ctx.user`, so `Auth.user()` works
 * for the remainder of the request. If no `user_id` is stored (or it is not a
 * number), the hook returns early and the request stays unauthenticated.
 *
 * @example
 * ```ts
 * app.use(class extends AuthSessionMiddleware {
 *   constructor() {
 *     super(new CookieDriver(env('SESSION_SECRET', 'changeme')), (id) => User.find(id));
 *   }
 * });
 * ```
 */
export class AuthSessionMiddleware extends SessionMiddleware {
  /**
   * @param driver - Session driver used to load/save the session.
   * @param findUser - Callback resolving a user record by numeric ID (returns
   * `null` when no matching user exists).
   */
  constructor(
    driver: SessionDriver,
    private readonly findUser: UserFinder,
  ) {
    super(driver);
  }

  /**
   * @internal Hydrates `ctx.user` from the session's `user_id` when present.
   * Overrides {@link SessionMiddleware._afterLoad}.
   */
  protected override async _afterLoad(ctx: HttpContext, session: SessionManager): Promise<void> {
    const userId = session.get("user_id");
    if (typeof userId !== "number") return;
    const user = await this.findUser(userId);
    if (user) (ctx as unknown as Record<string, unknown>)["user"] = user;
  }
}
