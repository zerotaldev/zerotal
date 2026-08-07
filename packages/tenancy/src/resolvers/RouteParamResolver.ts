/**
 * RouteParamResolver — reads the tenant slug from a named route parameter.
 *
 * Pair it with a `/:tenancy` group prefix: the router captures the segment into
 * `http.params.tenancy` before middleware runs, and this resolver hands that slug
 * to `TenancyMiddleware`.
 *
 * @example
 * // config/tenancy.ts
 * resolvers: [new RouteParamResolver({ param: "tenancy" })]
 *
 * // bootstrap/app.ts
 * .fileBasedRouting({
 *   dir: basePath("app/routes"),
 *   prefix: "/:tenancy",          // GET /acme/dashboard → params.tenancy = "acme"
 *   middleware: [TenancyMiddleware],
 * });
 */

import type { HttpContext } from "@zerotal/core";
import type { TenantResolver, TenantResolverResult } from "../types.ts";

interface RouteParamResolverOptions {
  /** The route parameter name holding the tenant slug. Default: `"tenancy"`. */
  param?: string;
}

export class RouteParamResolver implements TenantResolver {
  private readonly param: string;

  constructor(opts: RouteParamResolverOptions = {}) {
    this.param = opts.param ?? "tenancy";
  }

  resolve(http: HttpContext): TenantResolverResult | null {
    const raw = (http.params as Record<string, unknown>)[this.param];
    const slug = typeof raw === "string" ? raw.trim() : "";
    return slug ? { identifier: slug, by: "slug" } : null;
  }
}
