import { BaseMiddleware, ForbiddenError, UnauthorizedError } from "@zerotal/core";
import type { NextFn, HttpContext } from "@zerotal/core";

/**
 * RequireRoleMiddleware — assert the authenticated user has one or more roles.
 *
 * Reads roles straight off the authenticated user via the relational `Roles`
 * mixin (`user.hasRole(...)`). The user model must be composed with `Roles`;
 * if it exposes no `hasRole`, the request is forbidden.
 *
 * Throws `UnauthorizedError` (401) when the request is unauthenticated.
 * Throws `ForbiddenError` (403) when the user lacks the required role(s).
 *
 * @example
 * // Single role:
 * Router.get('/admin', AdminController, 'index', [new RequireRoleMiddleware('admin')]);
 *
 * // Any of several roles (OR semantics):
 * Router.get('/dashboard', DashboardController, 'index', [
 *   new RequireRoleMiddleware('admin', 'editor'),
 * ]);
 */
export class RequireRoleMiddleware extends BaseMiddleware {
  protected options = {};

  private readonly _roles: string[];

  constructor(...roles: string[]) {
    super();
    if (roles.length === 0) throw new Error("RequireRoleMiddleware: at least one role is required");
    this._roles = roles;
  }

  /** Fluent factory alias: `RequireRoleMiddleware.for('admin', 'editor')` */
  static for(...roles: string[]): RequireRoleMiddleware {
    return new RequireRoleMiddleware(...roles);
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!http.user) throw new UnauthorizedError();

    const user = http.user as unknown as { hasRole?(role: string): boolean };
    const passes = typeof user.hasRole === "function" && this._roles.some((r) => user.hasRole!(r));

    if (!passes) throw new ForbiddenError();

    return next();
  }
}
