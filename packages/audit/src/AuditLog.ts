import { BaseModel, column, table } from "@zerotal/orm";
import type { AuditEvent } from "./types.ts";
import type { Carbon } from "@zerotal/core/carbon";

/**
 * The `AuditLog` model represents a single row in the `audit_logs` table.
 *
 * @example
 * const logs = await AuditLog.query()
 *   .where("auditable_type", "User")
 *   .where("auditable_id", String(user.id))
 *   .orderBy("id", "desc")
 *   .limit(20)
 *   .get();
 *
 * const actions = await AuditLog.byActor(user.id).get();
 */
@(table("audit_logs").withoutTimestamps())
export class AuditLog extends BaseModel {
  @column() event!: AuditEvent;
  @column() auditableType!: string;
  @column() auditableId!: string | null;
  @column() actorType!: string | null;
  @column("number") actorId!: number | null;
  @column("json") oldValues!: Record<string, unknown> | null;
  @column("json") newValues!: Record<string, unknown> | null;
  @column("json") tags!: Record<string, unknown> | null;
  @column() ipAddress!: string | null;
  @column() userAgent!: string | null;
  @column() url!: string | null;
  // Timestamps are disabled for this table, so `createdAt` is a plain tracked
  // column set explicitly by the Auditor (not auto-managed by the ORM). The
  // initializer satisfies the base-class field override check (TS2612).
  //
  // `Carbon`, not `Date`: a `datetime` column hydrates as Carbon, and this was
  // declared as a Date it never held — so `.getTime()` on an audit row compiled
  // and threw. Same mistake the base model's own timestamps carried.
  @column("datetime") createdAt: Carbon = undefined as unknown as Carbon;

  // ── Scopes ───────────────────────────────────────────────────────────────

  static forModel = this.scope((q, type: string, id: string | number) =>
    q.where("auditable_type", type).where("auditable_id", String(id)),
  );

  static byActor = this.scope((q, actorId: number) => q.where("actor_id", actorId));

  static ofEvent = this.scope((q, event: AuditEvent) => q.where("event", event));

  // ── Helpers ──────────────────────────────────────────────────────────────

  get changedKeys(): string[] {
    if (!this.newValues) return [];
    return Object.keys(this.newValues);
  }

  get oldParsed(): Record<string, unknown> {
    return this.oldValues ?? {};
  }

  get newParsed(): Record<string, unknown> {
    return this.newValues ?? {};
  }
}
