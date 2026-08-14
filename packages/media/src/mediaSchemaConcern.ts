import type { ConcernDescriptor } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { Schema } from "@zerotal/orm";

/**
 * Provisions the `media` table on boot — so apps don't write a migration for it.
 *
 * Runs once after model discovery (order 70), additively and idempotently: it
 * creates the table only when it's missing. Skipped when `media.autoCreateTable`
 * is off and in DB-less runtimes; any DDL/connection error is swallowed so boot
 * never fails because of it.
 *
 * Mirrors `auditSchemaConcern`, and exists for the same reason: the alternative
 * is an app that boots cleanly and then fails on its first upload, in production.
 *
 * @internal — registered by MediaProvider so the `media` table provisions itself.
 */
export const mediaSchemaConcern: ConcernDescriptor = {
  name: "media-schema",
  order: 70,
  envs: ["web", "worker", "test"],
  async run(ctx) {
    try {
      const config = ctx.resolve<ConfigManager>("config");
      if (config?.get<boolean>("media.autoCreateTable", true) === false) return;

      const tableName = config?.get<string>("media.table", "media") ?? "media";
      if (await Schema.hasTable(tableName)) return;

      await Schema.create(tableName, (blueprint) => {
        blueprint.increments("id");

        // model_id is text, not an integer: apps with UUID primary keys are as
        // entitled to attach media as apps with auto-increment ones.
        blueprint.string("model_type");
        blueprint.string("model_id");
        blueprint.string("uuid").nullable();
        blueprint.string("collection_name");
        blueprint.string("name");
        blueprint.string("file_name");
        blueprint.string("mime_type").nullable();
        blueprint.string("disk");
        blueprint.string("conversions_disk").nullable();
        blueprint.integer("size");

        // Every JSON column defaults to an object, never a bare scalar — a bare
        // scalar in a json column does not survive the round trip intact.
        blueprint.text("manipulations").nullable();
        blueprint.text("custom_properties").nullable();
        blueprint.text("generated_conversions").nullable();
        blueprint.text("responsive_images").nullable();

        blueprint.integer("order_column").nullable();
        blueprint.timestamp("created_at").nullable();
        blueprint.timestamp("updated_at").nullable();

        // The query every read makes: "this model's items in this collection,
        // in order".
        blueprint.index(["model_type", "model_id", "collection_name"], "media_owner_index");
        blueprint.index(["order_column"], "media_order_index");
        blueprint.unique(["uuid"], "media_uuid_unique");
      });
    } catch {
      // No database (or DDL not permitted) in this runtime — skip silently.
    }
  },
};
