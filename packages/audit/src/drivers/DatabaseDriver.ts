import { DB } from "@zerotal/orm";
import type { AuditDriver } from "./AuditDriver.ts";
import type { AuditPayload, AuditRecord } from "../types.ts";

/**
 * Stores audit logs in a relational database table (default: audit_logs).
 *
 * Create the table with:
 *
 *   await Schema.create("audit_logs", (table) => {
 *     table.id();
 *     table.string("event");
 *     table.string("auditable_type");
 *     table.string("auditable_id").nullable();
 *     table.string("actor_type").nullable();
 *     table.integer("actor_id").nullable();
 *     table.text("old_values").nullable();
 *     table.text("new_values").nullable();
 *     table.text("tags").nullable();
 *     table.string("ip_address").nullable();
 *     table.string("user_agent").nullable();
 *     table.string("url").nullable();
 *     table.timestamp("created_at");
 *   });
 */
export class DatabaseDriver implements AuditDriver {
  constructor(private readonly table: string = "audit_logs") {}

  async record(payload: AuditPayload): Promise<void> {
    const now = new Date().toISOString();
    await DB.table(this.table).insert({
      event: payload.event,
      auditable_type: payload.auditable_type,
      auditable_id: payload.auditable_id != null ? String(payload.auditable_id) : null,
      actor_type: payload.actor_type ?? null,
      actor_id: payload.actor_id ?? null,
      old_values: payload.old_values ? JSON.stringify(payload.old_values) : null,
      new_values: payload.new_values ? JSON.stringify(payload.new_values) : null,
      tags: payload.tags ? JSON.stringify(payload.tags) : null,
      ip_address: payload.ip_address ?? null,
      user_agent: payload.user_agent ?? null,
      url: payload.url ?? null,
      created_at: now,
    });
  }

  async forModel(type: string, id: string | number, limit = 50): Promise<AuditRecord[]> {
    const rows = await DB.table(this.table)
      .where("auditable_type", type)
      .where("auditable_id", String(id))
      .orderBy("id", "desc")
      .limit(limit)
      .get<AuditRecord>();
    return rows;
  }
}
