import type { ConcernDescriptor } from "@zerotal/core";
import { Schema } from "@zerotal/orm";

/**
 * Provisions the tenancy tables on boot — the `tenants` registry and the
 * `tenant_members` pivot — so apps don't define a tenant model or write migrations.
 * Runs once after model discovery (order 70), additively and idempotently. Restricted
 * to DB-backed environments; DDL/connection errors are swallowed so boot never fails.
 */
export const tenantSchemaConcern: ConcernDescriptor = {
  name: "tenancy-schema",
  order: 70,
  envs: ["web", "worker", "test"],
  async run() {
    try {
      if (!(await Schema.hasTable("tenants"))) {
        await Schema.create("tenants", (table) => {
          table.increments("id");
          table.string("slug");
          table.string("name");
          table.boolean("is_active");
          table.string("database").nullable(); // multi-database strategy target
          table.timestamp("created_at").nullable();
          table.timestamp("updated_at").nullable();
        });
      }

      if (!(await Schema.hasTable("tenant_members"))) {
        await Schema.create("tenant_members", (table) => {
          table.increments("id");
          table.integer("tenant_id");
          table.integer("user_id");
          table.boolean("is_admin");
          table.timestamp("created_at").nullable();
        });
      }
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
