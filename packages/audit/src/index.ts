// @zerotal/audit — public API

// Core
export { Auditor } from "./Auditor.ts";
export type { AuditableRef } from "./Auditor.ts";
export { AuditLog } from "./AuditLog.ts";
export { AuditObserver } from "./AuditObserver.ts";
export { AuditProvider } from "./provider/AuditProvider.ts";

// Facade
export { Audit } from "./facades/Audit.ts";

// Mixin + programmatic registration
export { Auditable, registerAudit } from "./Auditable.ts";

// Drivers
export type { AuditDriver } from "./drivers/AuditDriver.ts";
export { DatabaseDriver } from "./drivers/DatabaseDriver.ts";
export { NullDriver } from "./drivers/NullDriver.ts";

// Config factory
export { AuditConfig } from "./config.ts";
export type { AuditConfigShape } from "./config.ts";

// Types
export type {
  AuditEvent,
  AuditRecord,
  AuditPayload,
  InstanceAuditPayload,
  AuditableOptions,
} from "./types.ts";
