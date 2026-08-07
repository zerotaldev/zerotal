import { BaseMiddleware, ForbiddenError, UnauthorizedError } from "@zerotal/core";
import type { NextFn, HttpContext } from "@zerotal/core";

/**
 * RequirePermissionMiddleware — assert the authenticated user has one of the
 * given abilities via the relational `Roles` / `Permissions` mixins
 * (`user.can()`, wildcard-aware). The user model must expose `can()`; otherwise
 * the request is forbidden.
 *
 * @example
 * Router.get('/posts/:id/publish', PostController, 'publish', [
 *   RequirePermissionMiddleware.for('post.publish'),
 * ]);
 */
export class RequirePermissionMiddleware extends BaseMiddleware {
  protected options = {};
  private readonly _abilities: string[];

  constructor(...abilities: string[]) {
    super();
    if (abilities.length === 0)
      throw new Error("RequirePermissionMiddleware: at least one ability is required");
    this._abilities = abilities;
  }

  /** Fluent factory: `RequirePermissionMiddleware.for('post.update', 'post.*')` */
  static for(...abilities: string[]): RequirePermissionMiddleware {
    return new RequirePermissionMiddleware(...abilities);
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!http.user) throw new UnauthorizedError();

    const user = http.user as { can?: (a: string) => boolean | Promise<boolean> };
    let passes = false;

    if (typeof user.can === "function") {
      for (const ability of this._abilities) {
        if (await user.can(ability)) {
          passes = true;
          break;
        }
      }
    }

    if (!passes) throw new ForbiddenError();
    return next();
  }
}
