/**
 * TenantContext — AsyncLocalStorage-based tenant store.
 *
 * Once TenancyMiddleware resolves a tenant and calls `TenantContext.run()`,
 * every async operation downstream (including ORM queries, mail jobs, queue
 * workers dispatched from within the same request) can call
 * `TenantContext.get()` to retrieve the active tenant without threading it
 * manually through function arguments.
 *
 * This parallels how RequestContext works in @zerotal/core.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { NoActiveTenantError } from "./errors.ts";
import type { Tenant } from "./types.ts";

const _storage = new AsyncLocalStorage<Tenant>();

export class TenantContext {
  /**
   * Execute `callback` inside a tenant boundary.
   * Called by TenancyMiddleware before forwarding to the next handler.
   */
  static run<T>(tenant: Tenant, callback: () => T): T {
    return _storage.run(tenant, callback);
  }

  /**
   * Return the active tenant.
   * Throws if called outside a tenant context (i.e. without TenancyMiddleware).
   */
  static get(): Tenant {
    const t = _storage.getStore();
    if (!t) throw new NoActiveTenantError();
    return t;
  }

  /**
   * Return the active tenant, or undefined if called outside a tenant context.
   * Useful in shared code that runs in both tenant and non-tenant contexts
   * (CLI commands, background jobs that process all tenants).
   */
  static tryGet(): Tenant | undefined {
    return _storage.getStore();
  }

  /** Convenience: return the current tenant's id, or null outside a context. */
  static id(): number | null {
    return _storage.getStore()?.id ?? null;
  }

  /** Convenience: return the current tenant's slug, or null outside a context. */
  static slug(): string | null {
    return _storage.getStore()?.slug ?? null;
  }
}
