import { BaseModel, column, table } from "@zerotal/orm";

/**
 * The internal tenant record — owned by `@zerotal/tenancy` (like `AuditLog` is owned
 * by `@zerotal/audit`). Its table (`tenants`) and the `tenant_members` pivot are
 * provisioned on boot by `tenantSchemaConcern`, so apps don't define a tenant model
 * or write migrations for it. Reach tenants through the `Tenant` facade, not this
 * class directly.
 *
 * `TenantModel` is deliberately NOT `Tenantable` — it lives in the central/platform
 * database and is what bootstraps a tenant context, not something scoped within one.
 */
@(table("tenants").withTimestamps())
export class TenantModel extends BaseModel {
  @column() slug!: string;
  @column() name!: string;
  @column("boolean") isActive!: boolean;
  /**
   * Connection target for the multi-database strategy; null in single-database.
   * Nullable so a single-database `Tenant.create()` (no `database`) doesn't violate a
   * NOT NULL column — this must match `tenantSchemaConcern`, and it is what the ORM's
   * model auto-synchronize uses when it provisions the `tenants` table.
   */
  @column({ nullable: true }) database?: string | null;
}
