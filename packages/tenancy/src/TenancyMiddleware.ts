/**
 * TenancyMiddleware — resolves the active tenant and opens a TenantContext boundary.
 *
 * You do not register this yourself: `TenancyProvider` adds it to the **global**
 * pipeline automatically (and it is not exported from the package). It runs on every
 * request, so once a tenant is resolved every downstream service — `Auth.user()`, model
 * queries, cache, storage — is transparently scoped to that tenant.
 *
 * It is deliberately **lenient about absence**: a request that resolves no tenant simply
 * continues with no boundary, which is what lets tenant-less routes (login, signup,
 * marketing) coexist with tenant-scoped ones. That is safe because `Tenantable`'s scope
 * matches nothing outside a boundary — no tenant means no rows, not everyone's rows. Apply
 * {@link EnsureTenancyMiddleware} to routes that must *have* a tenant.
 *
 * It is **strict about identity**: every resolver except {@link AuthResolver} takes its
 * identifier from the request (a subdomain, a header, a path segment), so an authenticated
 * requester who names a tenant must be a member of it. See {@link TenantResolver.trusted}.
 *
 * Outcomes:
 *   - no resolver matches → continue, no boundary (tenant-scoped models return nothing)
 *   - resolver names a tenant that does not exist → continue, no boundary
 *   - tenant exists but `isActive` is false → 403
 *   - signed-in requester named a tenant they do not belong to → 403
 *   - tenant exists and is active → open the boundary
 */

import { BaseMiddleware, type NextFn, type HttpContext } from "@zerotal/core";
import { TenantContext } from "./TenantContext.ts";
import { TenantModel } from "./TenantModel.ts";
import { DB } from "@zerotal/orm";
import { MEMBERS_TABLE } from "./Tenancy.ts";
import { TenantInactiveError, TenancyNotConfiguredError, TenantForbiddenError } from "./errors.ts";
import type { Tenant, TenancyConfigShape } from "./types.ts";

/**
 * The authenticated user's id, or `null` for an anonymous request.
 *
 * `AuthenticatedUser` is an empty interface until an app augments it, so reaching `id`
 * needs one structural view. Kept here so the membership check has exactly one.
 * @internal
 */
function _authUserId(http: HttpContext): number | null {
  const user = (http as { user?: { id?: unknown } | null }).user;
  return typeof user?.id === "number" ? user.id : null;
}

export class TenancyMiddleware extends BaseMiddleware {
  protected options: Record<string, never> = {};

  private static _config?: TenancyConfigShape;

  /** Called by TenancyProvider during boot. */
  static configure(config: TenancyConfigShape): void {
    TenancyMiddleware._config = config;
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const config = TenancyMiddleware._config;
    if (!config)
      throw new TenancyNotConfiguredError(
        "TenancyMiddleware used before TenancyProvider was booted.",
      );

    // Try each resolver in order until one identifies a tenant. Each resolver reads
    // whatever it needs off the HttpContext (route params, the auth user, headers, …).
    let identifier: string | number | null = null;
    let by: "slug" | "id" = "slug";
    let trusted = false;
    for (const resolver of config.resolvers) {
      const result = resolver.resolve(http);
      if (result != null && result.identifier !== "" && result.identifier != null) {
        identifier = result.identifier;
        by = result.by ?? "slug";
        trusted = resolver.trusted === true;
        break;
      }
    }

    // No tenant could be identified — run tenant-less against the default database.
    // Routes that must have a tenant reject this later via EnsureTenancyMiddleware.
    if (identifier == null) return next();

    // Load the tenant from the internal registry (owned by @zerotal/tenancy), matching
    // on slug or primary key depending on how the resolver identified it.
    const column = by === "id" ? "id" : "slug";
    const tenant = (await TenantModel.query().where(column, identifier).first()) as Tenant | null;

    // An identifier that maps to no tenant is treated leniently (no boundary) — the
    // EnsureTenancyMiddleware gate turns this into a 404 only where a tenant is required.
    if (!tenant) return next();

    // A known-but-disabled tenant is a definitive rejection, surfaced everywhere.
    if (!tenant.isActive) throw new TenantInactiveError();

    // An authenticated requester who *names* a tenant must belong to it. Subdomains,
    // headers, path segments and route params are all attacker-chosen, so without this a
    // user of tenant A reaches tenant B by editing one header — the tenant boundary would
    // be decided entirely by the client. Anonymous requests are left alone: a public
    // tenant surface (marketing page, login form) has no membership to check, and nothing
    // downstream is authorised on identity yet.
    if (!trusted) {
      await this._assertMembership(http, tenant);
    }

    // Attach tenant to http for convenient access in controllers.
    (http as unknown as Record<string, unknown>)["tenant"] = tenant;

    // Establish the ALS boundary so all downstream code can call TenantContext.get().
    return new Promise<Response | void>((resolve, reject) => {
      TenantContext.run(tenant, () => {
        next().then(resolve, reject);
      });
    });
  }

  /**
   * Reject an authenticated requester who named a tenant they do not belong to.
   *
   * Queries the membership pivot directly rather than going through the `Tenant` facade:
   * this check runs on every request and must not depend on the container being resolvable,
   * and `Tenancy.isMember()` reads the *current* tenant id — which is precisely the tenant
   * we have not entered yet.
   *
   * @throws {@link TenantForbiddenError} When a signed-in user is not a member.
   */
  private async _assertMembership(http: HttpContext, tenant: Tenant): Promise<void> {
    const userId = _authUserId(http);
    if (userId === null) return; // anonymous — nothing to check against

    const row = await DB.table(MEMBERS_TABLE)
      .where("tenant_id", tenant.id)
      .where("user_id", userId)
      .first();
    if (!row) throw new TenantForbiddenError();
  }
}
