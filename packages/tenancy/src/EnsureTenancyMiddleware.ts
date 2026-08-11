/**
 * EnsureTenancyMiddleware — gate a route on an active tenant.
 *
 * `TenancyMiddleware` (registered globally by `TenancyProvider`) has already tried to
 * resolve and open the tenant boundary by the time this runs; this middleware simply
 * asserts that it succeeded. If there is no active tenant it responds **404**; otherwise
 * the tenant is guaranteed to be present for the rest of the request.
 *
 * Apply it to route groups that only make sense inside a tenant — e.g. everything under a
 * `/:tenancy` prefix, or an `acme.myapp.com` subdomain group:
 *
 * @example
 * // bootstrap/app.ts
 * .fileBasedRouting({
 *   dir: basePath("app/flow/pages/[tenancy]"),
 *   prefix: "/:tenancy",
 *   middleware: [EnsureTenancyMiddleware],
 * });
 */

import { BaseMiddleware, type NextFn, type HttpContext } from "@zerotal/core";
import { TenantContext } from "./TenantContext.ts";
import { TenantNotFoundError } from "./errors.ts";

export class EnsureTenancyMiddleware extends BaseMiddleware {
  protected options: Record<string, never> = {};

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    if (TenantContext.tryGet() == null) throw new TenantNotFoundError();
    return next();
  }
}
