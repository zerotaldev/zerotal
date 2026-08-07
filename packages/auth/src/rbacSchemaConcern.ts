import type { ConcernDescriptor } from "@zerotal/core";
import { Schema, modelsByName } from "@zerotal/orm";
import { hasRolesMixin } from "./rbac/Roles.ts";
import { hasPermissionsMixin } from "./rbac/Permissions.ts";

/**
 * Provisions the relational-RBAC **pivot** tables on boot — so composing the `Roles`
 * / `Permissions` mixins works with no migration. The `roles` / `permissions` tables
 * themselves are ORM models, so they're created by schema sync / generated migrations;
 * only the polymorphic pivots (which aren't models) need this.
 *
 * Runs once after model discovery (order 70), additively and idempotently, and only
 * when a registered model actually composes the mixins:
 *
 *  - any `Roles` model → `model_roles` + `role_permissions`
 *  - any `Permissions` model → `model_permissions`
 *
 * Restricted to DB-backed environments; any DDL/connection error is swallowed so a
 * DB-less runtime still boots.
 */
export const rbacSchemaConcern: ConcernDescriptor = {
  name: "rbac-schema",
  order: 70,
  envs: ["web", "test"],
  async run() {
    try {
      const models = [...modelsByName.values()];
      const usesRoles = models.some(hasRolesMixin);
      const usesPermissions = models.some(hasPermissionsMixin);
      if (!usesRoles && !usesPermissions) return;

      if (usesRoles) {
        if (!(await Schema.hasTable("model_roles"))) {
          await Schema.create("model_roles", (table) => {
            table.integer("role_id");
            table.integer("model_id");
            table.string("model_type");
          });
        }
        if (!(await Schema.hasTable("role_permissions"))) {
          await Schema.create("role_permissions", (table) => {
            table.integer("role_id");
            table.integer("permission_id");
          });
        }
      }

      if (usesPermissions && !(await Schema.hasTable("model_permissions"))) {
        await Schema.create("model_permissions", (table) => {
          table.integer("permission_id");
          table.integer("model_id");
          table.string("model_type");
        });
      }
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
