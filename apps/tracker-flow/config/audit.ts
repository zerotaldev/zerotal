import { AuditConfig } from "@zerotal/audit";

/**
 * The audit trail — feature 11.
 *
 * `captureRequest` records the IP, user agent and URL behind each change. Kept
 * on because the question an activity feed exists to answer is "who changed
 * this, and from where" — and the second half is the one you only miss after
 * you needed it.
 *
 * `pruneKeep: 0` retains everything. A tracker's history is small and the trail
 * is the feature; a retention window belongs in an app that has a reason for one.
 */
export default AuditConfig({
  driver: "database",
  table: "audit_logs",
  pruneKeep: 0,
  captureRequest: true,
});
