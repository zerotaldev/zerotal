import type { ConcernDescriptor } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { Schema } from "@zerotal/orm";

/**
 * Provisions the `audit_logs` table on boot — so apps don't write a migration for it.
 * Runs once after model discovery (order 70), additively and idempotently: it creates
 * the table only when it's missing. Skipped for the `null` driver (which stores
 * nothing) and in DB-less runtimes; any DDL/connection error is swallowed so boot
 * never fails because of it.
 */
export const auditSchemaConcern: ConcernDescriptor = {
  name: "audit-schema",
  order: 70,
  envs: ["web", "worker", "test"],
  async run(ctx) {
    try {
      const config = ctx.resolve<ConfigManager>("config");
      const driver = config?.get<string>("audit.driver", "database") ?? "database";
      if (driver === "null") return;

      const table = config?.get<string>("audit.table", "audit_logs") ?? "audit_logs";
      if (await Schema.hasTable(table)) return;

      await Schema.create(table, (blueprint) => {
        blueprint.increments("id");
        blueprint.string("event");
        blueprint.string("auditable_type");
        blueprint.string("auditable_id").nullable();
        blueprint.string("actor_type").nullable();
        blueprint.integer("actor_id").nullable();
        blueprint.text("old_values").nullable();
        blueprint.text("new_values").nullable();
        blueprint.text("tags").nullable();
        blueprint.string("ip_address").nullable();
        blueprint.string("user_agent").nullable();
        blueprint.string("url").nullable();
        blueprint.timestamp("created_at").nullable();
      });
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
