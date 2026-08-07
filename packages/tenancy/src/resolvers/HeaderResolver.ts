/**
 * HeaderResolver — extracts the tenant slug from a request header.
 *
 * Useful for API-first apps where the client sends the tenant in a header
 * instead of using subdomains.
 *
 * @example
 * new HeaderResolver('X-Tenant-ID')
 * // Request: GET /api/users  X-Tenant-ID: acme
 * // Resolved identifier: 'acme'
 */

import type { HttpContext } from "@zerotal/core";
import type { TenantResolver, TenantResolverResult } from "../types.ts";

export class HeaderResolver implements TenantResolver {
  constructor(private readonly header: string) {}

  resolve(http: HttpContext): TenantResolverResult | null {
    const value = http.request.headers.get(this.header);
    if (!value) return null;
    return { identifier: value.trim() };
  }
}
