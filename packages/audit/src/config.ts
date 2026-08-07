import { deepMerge } from "@zerotal/core";
import type { AuditConfigShape } from "./types.ts";

export type { AuditConfigShape };

const defaults: AuditConfigShape = {
  driver: "database",
  table: "audit_logs",
  pruneKeep: 0,
  captureRequest: true,
};

/**
 * Create the audit configuration block. The settings are namespaced under `audit`
 * in the app config tree.
 *
 * @example
 * // config/audit.ts
 * import { AuditConfig } from '@zerotal/audit';
 * export default AuditConfig({ driver: 'database' });
 */
export function AuditConfig(options: Partial<AuditConfigShape> = {}): { audit: AuditConfigShape } {
  return { audit: deepMerge(defaults, options) };
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    audit: AuditConfigShape;
  }
}
