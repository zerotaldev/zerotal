import type { AuditDriver } from "./AuditDriver.ts";
import type { AuditPayload, AuditRecord } from "../types.ts";

/**
 * No-op audit driver — useful in tests or when auditing is temporarily disabled.
 */
export class NullDriver implements AuditDriver {
  async record(_payload: AuditPayload): Promise<void> {}
  async forModel(_type: string, _id: string | number, _limit?: number): Promise<AuditRecord[]> {
    return [];
  }
}
