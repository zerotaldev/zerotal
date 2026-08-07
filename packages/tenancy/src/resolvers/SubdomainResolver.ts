/**
 * SubdomainResolver — extracts the tenant slug from the first subdomain segment.
 *
 * Given `domain: 'myapp.com'` and a request to `acme.myapp.com`,
 * the resolved identifier is `'acme'`.
 *
 * Any number of additional subdomains before the tenant segment is ignored —
 * only the leftmost segment is treated as the tenant slug.
 */

import type { HttpContext } from "@zerotal/core";
import type { TenantResolver, TenantResolverResult } from "../types.ts";

export class SubdomainResolver implements TenantResolver {
  constructor(private readonly domain: string) {}

  resolve(http: HttpContext): TenantResolverResult | null {
    const host = new URL(http.request.url).hostname;

    // Strip the base domain and any trailing dot.
    const suffix = `.${this.domain}`;
    if (!host.endsWith(suffix)) return null;

    const sub = host.slice(0, host.length - suffix.length);
    if (!sub) return null;

    // Take only the rightmost subdomain segment as the slug
    // (e.g. "www.acme.myapp.com" → "acme").
    const parts = sub.split(".");
    const slug = parts[parts.length - 1]!;

    return slug ? { identifier: slug } : null;
  }
}
