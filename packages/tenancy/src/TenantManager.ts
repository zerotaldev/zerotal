/**
 * TenantManager — the per-tenant database connection pool for the multi-database
 * strategy. You normally never touch it directly: when you give `TenancyConfig` a
 * `connect` factory, `TenancyProvider` builds a TenantManager from it and registers
 * an ORM connection resolver, so every model query inside a tenant boundary is routed
 * to the right database automatically.
 *
 * It is exported for the rare case where you need the raw connection for a tenant
 * outside the ORM (a manual migration, a bulk import). In the single-database strategy
 * you don't need this class at all — `Tenantable` isolates via `WHERE tenant_id = ?`.
 *
 * @example
 * // Pre-warm connections for all known tenants at startup:
 * const tenants = await Tenant.all();
 * for (const t of tenants) manager.warmUp(t);
 */

import type { SQLInstance } from "@zerotal/orm";
import { TenantContext } from "./TenantContext.ts";
import type { MultiDbTenant, Tenant } from "./types.ts";

export interface TenantManagerOptions {
  /**
   * Factory that opens a new database connection for the given tenant.
   * Called once per tenant on first use; the result is cached.
   */
  connect(tenant: MultiDbTenant): SQLInstance;
}

export class TenantManager {
  private readonly _pool = new Map<number, SQLInstance>();
  private readonly _opts: TenantManagerOptions;

  constructor(opts: TenantManagerOptions) {
    this._opts = opts;
  }

  /**
   * Return the database connection for the currently active tenant.
   * Throws if called outside a TenantContext boundary.
   */
  connection(): SQLInstance {
    const tenant = TenantContext.get() as MultiDbTenant;
    return this._forTenant(tenant);
  }

  /**
   * Return the database connection for a specific tenant without requiring
   * an active TenantContext. Useful in background jobs that iterate tenants.
   */
  connectionFor(tenant: MultiDbTenant): SQLInstance {
    return this._forTenant(tenant);
  }

  /**
   * Pre-open the connection for a tenant so the first request is instant.
   * Safe to call at boot time before any requests arrive.
   */
  warmUp(tenant: MultiDbTenant): void {
    this._forTenant(tenant);
  }

  /** Close and evict a tenant's connection (e.g. after a tenant is deleted). */
  evict(tenant: Tenant): void {
    const conn = this._pool.get(tenant.id);
    if (conn) _closeConnection(conn);
    this._pool.delete(tenant.id);
  }

  /** Close all open connections. */
  closeAll(): void {
    for (const [id, conn] of this._pool) {
      _closeConnection(conn);
      this._pool.delete(id);
    }
  }

  private _forTenant(tenant: MultiDbTenant): SQLInstance {
    let conn = this._pool.get(tenant.id);
    if (!conn) {
      conn = this._opts.connect(tenant);
      this._pool.set(tenant.id, conn);
    }
    return conn;
  }
}

/** Close a connection via whichever teardown method it exposes (`end`/`close`). */
function _closeConnection(conn: SQLInstance): void {
  const c = conn as unknown as { end?: () => unknown; close?: () => unknown };
  if (typeof c.end === "function") c.end();
  else if (typeof c.close === "function") c.close();
}
