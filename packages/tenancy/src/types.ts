/**
 * Core types for @zerotal/tenancy.
 */

import type { SQLInstance } from "@zerotal/orm";
import type { HttpContext } from "@zerotal/core";

/** Minimal shape every tenant record satisfies (matches the internal `TenantModel`). */
export interface Tenant {
  /** Database primary key. */
  id: number;
  /** URL-safe identifier used in subdomains and storage paths. */
  slug: string;
  /** Display name. */
  name: string;
  /** Whether this tenant is active. Inactive tenants are rejected by TenancyMiddleware. */
  isActive: boolean;
}

/** Extended tenant shape for the multi-database strategy. */
export interface MultiDbTenant extends Tenant {
  /** SQLite database file path OR connection string for this tenant's database. */
  database: string;
}

// ── Resolver types ────────────────────────────────────────────────────────────

/** A resolver extracts a tenant identifier from the incoming request. */
export interface TenantResolverResult {
  /** The raw identifier extracted (subdomain slug, header value, path segment, auth user, …). */
  identifier: string | number;
  /**
   * How to look the tenant up in the registry. `"slug"` (default) matches the URL-safe
   * slug; `"id"` matches the primary key — used by resolvers that read a foreign key such
   * as the authenticated user's `tenantId`.
   */
  by?: "slug" | "id";
}

export interface TenantResolver {
  /**
   * Return an identifier if this resolver can handle the request, or null to skip.
   *
   * Resolvers receive the full {@link HttpContext} so they can read route params
   * (`http.params`), the authenticated user (`http.user`), headers, or the raw
   * `http.request` — whichever they resolve from.
   */
  resolve(http: HttpContext): TenantResolverResult | null;

  /**
   * Whether the identifier this resolver produces is *already known to belong to the
   * requester* — i.e. it came from server-held state rather than from the request.
   *
   * Only {@link AuthResolver} is trusted: it reads the tenant off the authenticated
   * user's own record. Subdomains, headers, path segments and route params are all
   * attacker-chosen, so `TenancyMiddleware` requires an authenticated requester to be a
   * member of the tenant they named before opening the boundary. Without that check, a
   * user of tenant A reaches tenant B's data by editing one header.
   *
   * Defaults to `false` — a custom resolver is untrusted until it says otherwise, which is
   * the right way round for a security default.
   */
  readonly trusted?: boolean;
}

// ── Strategy ─────────────────────────────────────────────────────────────────

export type TenancyStrategy = "single-database" | "multi-database";

// ── Config ────────────────────────────────────────────────────────────────────

export interface TenancyConfigShape {
  /** Persistence strategy. Default: 'single-database'. */
  strategy: TenancyStrategy;

  /**
   * One or more resolvers tried in order until one returns a non-null result.
   * If all resolvers return null the request is treated as tenant-less
   * (TenancyMiddleware returns a 404).
   */
  resolvers: TenantResolver[];

  /**
   * Column name used for tenant scoping in the single-database strategy.
   * Default: 'tenant_id'.
   */
  tenantColumn?: string;

  /**
   * **Multi-database strategy only — required.** Opens (or returns) the database
   * connection for a tenant. Called once per tenant; the result is pooled. Once
   * supplied, every model query inside a tenant boundary is transparently routed to
   * this connection — no `TenantManager` wiring or raw SQL needed.
   *
   * @example
   * connect: (tenant) => new SQL(`file:./storage/tenants/${tenant.database}`),
   */
  connect?: (tenant: MultiDbTenant) => SQLInstance;
}
