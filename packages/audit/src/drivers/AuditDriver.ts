import type { AuditPayload, AuditRecord } from "../types.ts";

/**
 * Interface every audit driver must satisfy.
 */
export interface AuditDriver {
  /** Persist a single audit entry. */
  record(payload: AuditPayload): Promise<void>;

  /**
   * Return the most recent `limit` entries for a given model.
   * Return an empty array if the driver does not support reads.
   */
  forModel(type: string, id: string | number, limit?: number): Promise<AuditRecord[]>;
}
