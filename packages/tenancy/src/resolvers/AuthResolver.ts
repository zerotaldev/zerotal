/**
 * AuthResolver — resolves the active tenant from the authenticated user.
 *
 * The logged-in user carries the tenant it belongs to (default column `tenantId`),
 * and this resolver reads that foreign key off `http.user` — the user populated
 * upstream by the auth layer's `PersistUserMiddleware`. Because it reads `http.user`
 * (typed by core's `AuthenticatedUser`) rather than importing the auth package,
 * `@zerotal/tenancy` stays decoupled from `@zerotal/auth`.
 *
 * Place it after URL-based resolvers so an explicit `/:tenancy` in the path wins,
 * and the auth user is the fallback for tenant-scoped routes without a slug:
 *
 * @example
 * // config/tenancy.ts
 * resolvers: [
 *   new RouteParamResolver({ param: "tenancy" }),
 *   new AuthResolver(),   // falls back to the logged-in user's tenantId
 * ]
 *
 * Requests with no authenticated user (login, signup) resolve to `null` here — and
 * with `strict: false` (the default) fall through to the default database.
 */

import type { HttpContext } from "@zerotal/core";
import type { TenantResolver, TenantResolverResult } from "../types.ts";

interface AuthResolverOptions {
  /**
   * The property on the authenticated user holding the tenant foreign key.
   * Default: `"tenantId"`.
   */
  column?: string;
}

export class AuthResolver implements TenantResolver {
  /**
   * The identifier comes off the authenticated user's own record, so it is by construction
   * a tenant this requester belongs to — no membership check is needed or meaningful.
   */
  readonly trusted = true;

  private readonly column: string;

  constructor(opts: AuthResolverOptions = {}) {
    this.column = opts.column ?? "tenantId";
  }

  resolve(http: HttpContext): TenantResolverResult | null {
    // Read `user` structurally: it is augmented onto HttpContext by @zerotal/auth,
    // which this package intentionally does not depend on.
    const user = (http as unknown as { user?: Record<string, unknown> | null }).user;
    const value = user?.[this.column];
    if (value === undefined || value === null || value === "") return null;
    return { identifier: value as string | number, by: "id" };
  }
}
