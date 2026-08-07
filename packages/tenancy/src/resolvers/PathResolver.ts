/**
 * PathResolver — extracts the tenant slug from a URL path segment.
 *
 * @example
 * new PathResolver({ segment: 0 })
 * // Request: GET /acme/dashboard
 * // Resolved identifier: 'acme'
 *
 * new PathResolver({ segment: 1, prefix: '/tenants' })
 * // Request: GET /tenants/acme/settings
 * // Resolved identifier: 'acme'
 */

import type { HttpContext } from "@zerotal/core";
import type { TenantResolver, TenantResolverResult } from "../types.ts";

interface PathResolverOptions {
  /**
   * Zero-based index of the path segment that holds the tenant slug.
   * Default: 0 (i.e. the first segment after the leading slash).
   */
  segment?: number;
  /**
   * Optional static prefix to strip before indexing.
   * Example: prefix '/tenants' with segment 0 matches `/tenants/acme/…`.
   */
  prefix?: string;
}

export class PathResolver implements TenantResolver {
  private readonly segment: number;
  private readonly prefix: string;

  constructor(opts: PathResolverOptions = {}) {
    this.segment = opts.segment ?? 0;
    this.prefix = opts.prefix ?? "";
  }

  resolve(http: HttpContext): TenantResolverResult | null {
    let pathname = new URL(http.request.url).pathname;

    if (this.prefix && pathname.startsWith(this.prefix)) {
      pathname = pathname.slice(this.prefix.length);
    }

    // Split and filter empty strings produced by leading/trailing slashes.
    const parts = pathname.split("/").filter(Boolean);
    const slug = parts[this.segment];

    return slug ? { identifier: slug } : null;
  }
}
