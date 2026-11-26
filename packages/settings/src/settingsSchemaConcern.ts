import type { ConcernDescriptor } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { Schema } from "@zerotal/orm";

/**
 * Create a settings table, if it is missing, through the ORM's schema builder —
 * so the DDL is right for SQLite, PostgreSQL and MySQL alike.
 *
 * @internal
 */
export async function _createSettingsTable(table: string): Promise<void> {
  if (await Schema.hasTable(table)) return;
  await Schema.create(table, (blueprint) => {
    blueprint.increments("id");
    blueprint.string("setting_key", 191);
    blueprint.string("scope_key", 191);
    blueprint.integer("tenant_id").nullable();
    blueprint.string("user_id", 191).nullable();
    blueprint.text("value");
    blueprint.boolean("hidden").default(false);
    blueprint.string("updated_by", 191).nullable();
    blueprint.string("created_at", 64).nullable();
    blueprint.string("updated_at", 64).nullable();
    // The identity of an override: one row per setting per level.
    blueprint.unique(["setting_key", "scope_key"], `${table}_key_scope_unique`);
    // A tenant's overrides, for the settings screen.
    blueprint.index(["tenant_id"], `${table}_tenant_index`);
  });
}

/**
 * Provisions the settings table on boot, so an app writes no migration for it.
 * Runs once after model discovery, additively and idempotently: it creates the
 * table only when it is missing. A runtime without a database skips it, and a
 * DDL error never fails boot — the first read reports it instead.
 */
export const settingsSchemaConcern: ConcernDescriptor = {
  name: "settings-schema",
  order: 70,
  envs: ["web", "worker", "test"],
  async run(ctx) {
    try {
      const config = ctx.resolve<ConfigManager>("config");
      const table = config?.get<string>("settings.table", "zerotal_settings") ?? "zerotal_settings";
      await _createSettingsTable(table);
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
