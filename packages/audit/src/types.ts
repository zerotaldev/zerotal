/**
 * @zerotal/audit — type definitions
 */

/** The lifecycle event that triggered an audit entry. */
export type AuditEvent =
  | "created"
  | "updated"
  | "deleted"
  | "restored" // soft-delete restore
  | string; // user-defined events e.g. 'login', 'export'

/**
 * A single audit log record as stored in the database.
 */
export interface AuditRecord {
  id: number;
  /** e.g. "created" | "updated" | "deleted" | "login" */
  event: string;
  /** Model class name or a custom tag, e.g. "User", "payment.refunded" */
  auditable_type: string;
  /** PK of the auditable model, null for non-model events */
  auditable_id: string | null;
  /** Type of the actor, defaults to "user" */
  actor_type: string | null;
  /** PK of the acting user */
  actor_id: number | null;
  /** JSON-serialised snapshot of old values (update/delete only) */
  old_values: string | null;
  /** JSON-serialised snapshot of new values (create/update only) */
  new_values: string | null;
  /** Extra contextual metadata (JSON) */
  tags: string | null;
  ip_address: string | null;
  user_agent: string | null;
  /** URL of the request that triggered this event */
  url: string | null;
  created_at: string;
}

/**
 * Payload passed to the driver when recording an audit entry.
 * All fields except event + auditable_type are optional.
 */
export interface AuditPayload {
  event: AuditEvent;
  auditable_type: string;
  auditable_id?: string | number | null;
  actor_type?: string | null;
  actor_id?: number | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  tags?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  url?: string | null;
}

/**
 * Payload for a manual audit log made against a model instance. The model supplies
 * `event`, `auditable_type`, and `auditable_id`, so the caller only adds extras
 * (tags, an explicit actor, value snapshots, …).
 */
export type InstanceAuditPayload = Omit<AuditPayload, "event" | "auditable_type" | "auditable_id">;

/**
 * Audit configuration. Set these as overridable static fields on a `Auditable`
 * model — `auditOnly` / `auditExcept` / `auditType` — read per event from the
 * concrete subclass:
 *
 * ```ts
 * class User extends Auditable(AuthUser) {
 *   protected static auditExcept = ["password"];
 * }
 * ```
 */
export interface AuditableOptions {
  /**
   * Allowlist of column names to include in old_values / new_values.
   * If set, only listed columns are audited. (static `auditOnly`)
   */
  only?: string[];
  /**
   * Denylist of column names to exclude.
   * Applied after `only` (if both are provided, `only` wins). (static `auditExcept`)
   */
  except?: string[];
  /**
   * Override the auditable_type string stored in the log.
   * Defaults to the model's class name. (static `auditType`)
   */
  type?: string;
}

export interface AuditConfigShape {
  /**
   * Which driver to use for storing audit logs.
   * @default 'database'
   */
  driver: "database" | "null";
  /**
   * Table name for the database driver.
   * @default 'audit_logs'
   */
  table?: string;
  /**
   * Maximum number of audit records to keep per model instance.
   * Older records are pruned automatically. 0 = unlimited.
   * @default 0
   */
  pruneKeep?: number;
  /**
   * Whether to automatically capture request metadata (IP, UA, URL)
   * from the active RequestContext.
   * @default true
   */
  captureRequest?: boolean;
}
