import { RequestContext } from "@zerotal/core";
import { BaseModel } from "@zerotal/orm";
import type { ModelQueryBuilder } from "@zerotal/orm";
import type { AuditDriver } from "./drivers/AuditDriver.ts";
import { AuditLog } from "./AuditLog.ts";
import { auditableTypeOf, auditableIdOf } from "./auditableMeta.ts";
import type {
  AuditPayload,
  AuditConfigShape,
  AuditRecord,
  AuditEvent,
  InstanceAuditPayload,
} from "./types.ts";
import { frameworkLog } from "@zerotal/core/logger";

/** A model class (or its audit type name) used to scope an audit query. */
export type AuditableRef = string | { name: string; auditType?: string };

/** Resolve the `auditable_type` string for a model class or literal type name. */
function auditTypeOf(model: AuditableRef): string {
  return typeof model === "string" ? model : (model.auditType ?? model.name);
}

/**
 * Core audit service — record events, query history.
 *
 * Resolved from the container as 'audit'. Access via the `Audit` facade
 * (import from @zerotal/audit) after AuditProvider is registered.
 */
export class Auditor {
  constructor(
    private readonly driver: AuditDriver,
    private readonly config: AuditConfigShape,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Record a manual audit event.
   *
   * Pass the **model instance** the event concerns — `auditable_type` and
   * `auditable_id` are derived from it, so logs are always linked to a record (no
   * orphans) and you never hand-write the type string:
   *
   * @example
   * await Audit.log("login.success", user, { tags: { method: "github_oauth" } });
   * await Audit.log("report.exported", report, { tags: { format: "csv", rows: 5000 } });
   *
   * For an event not tied to a model, pass a raw payload with `auditable_type`:
   *
   * @example
   * await Audit.log("cache.flushed", { auditable_type: "System" });
   */
  async log(event: AuditEvent, model: BaseModel, payload?: InstanceAuditPayload): Promise<void>;
  async log(event: AuditEvent, payload: Omit<AuditPayload, "event">): Promise<void>;
  async log(
    event: AuditEvent,
    modelOrPayload: BaseModel | Omit<AuditPayload, "event">,
    payload: InstanceAuditPayload = {},
  ): Promise<void> {
    if (modelOrPayload instanceof BaseModel) {
      await this._record({
        ...payload,
        event,
        auditable_type: auditableTypeOf(modelOrPayload),
        auditable_id: auditableIdOf(modelOrPayload),
      });
      return;
    }
    await this._record({ ...modelOrPayload, event });
  }

  /**
   * Return the audit history for a specific model instance.
   *
   * @example
   * const history = await Audit.historyFor("User", user.id, 25);
   */
  async historyFor(type: string, id: string | number, limit = 50): Promise<AuditRecord[]> {
    return this.driver.forModel(type, id, limit);
  }

  // ── Querying (chainable AuditLog builders) ────────────────────────────

  /**
   * A chainable query of the audit logs for a model instance. Pass the model class
   * (its name / `auditType` is used) or a literal type string, plus the id.
   *
   * @example
   * const logs = await Audit.logs(User, 1).desc().limit(25).get();
   * const page = await Audit.logs(User, 1).orderBy("id", "desc").paginate(20, 1);
   */
  logs(model: AuditableRef, id: string | number): ModelQueryBuilder<AuditLog> {
    return AuditLog.query()
      .where("auditable_type", auditTypeOf(model))
      .where("auditable_id", String(id));
  }

  /**
   * A chainable query of every audit log recorded by a given actor.
   *
   * @example
   * const actorLog = await Audit.logsByActor(user.id).desc().get();
   */
  logsByActor(actorId: number): ModelQueryBuilder<AuditLog> {
    return AuditLog.query().where("actor_id", actorId);
  }

  /**
   * A chainable query of every audit log for a given event name.
   *
   * @example
   * const loginEvents = await Audit.logsOfEvent("login.success").get();
   */
  logsOfEvent(event: AuditEvent): ModelQueryBuilder<AuditLog> {
    return AuditLog.query().where("event", event);
  }

  // ── Internal — called by AuditObserver ────────────────────────────────

  /**
   * Record a model lifecycle event.  Called by AuditObserver.
   * Automatically enriches the payload with request metadata when available.
   */
  async _recordModel(payload: AuditPayload): Promise<void> {
    await this._record(payload);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async _record(payload: AuditPayload): Promise<void> {
    const enriched = this.config.captureRequest ? this._enrichWithRequest(payload) : payload;

    // Automatically attach the authenticated actor when not explicitly set
    const final = this._attachActor(enriched);

    try {
      await this.driver.record(final);
    } catch (err) {
      // Audit failures must NEVER crash the application
      frameworkLog("audit").error("Failed to record entry", undefined, err);
    }
  }

  private _enrichWithRequest(payload: AuditPayload): AuditPayload {
    const ctx = RequestContext.tryGet();
    if (!ctx) return payload;

    const req = ctx.request;
    return {
      ip_address: payload.ip_address ?? this._extractIp(req),
      user_agent: payload.user_agent ?? req.headers.get("user-agent"),
      url: payload.url ?? req.url,
      ...payload,
    };
  }

  private _attachActor(payload: AuditPayload): AuditPayload {
    if (payload.actor_id !== undefined) return payload; // caller set it explicitly

    // `user` is attached to the request context by the auth layer; audit does not
    // depend on @zerotal/auth, so read it structurally rather than via a typed field.
    const user = (RequestContext.tryGet() as { user?: unknown } | undefined)?.user;
    if (!user) return payload;

    return {
      actor_type: "user",
      actor_id: (user as { id: number }).id ?? null,
      ...payload,
    };
  }

  private _extractIp(req: Request): string | null {
    return (
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null
    );
  }
}
