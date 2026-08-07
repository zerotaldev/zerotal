import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { Auditor } from "../Auditor.ts";
import { DatabaseDriver } from "../drivers/DatabaseDriver.ts";
import { NullDriver } from "../drivers/NullDriver.ts";
import { _pendingAuditable, registerAudit } from "../Auditable.ts";
import { auditSchemaConcern } from "../auditSchemaConcern.ts";
import type { AuditConfigShape } from "../types.ts";

/**
 * AuditProvider — registers the audit system with the Zerotal application.
 *
 * @example
 * // bootstrap/providers.ts
 * import { AuditProvider } from "@zerotal/audit";
 *
 * export default [
 *   DatabaseProvider,
 *   // ...
 *   AuditProvider,
 * ];
 *
 * @example
 * // config/audit.ts
 * import { AuditConfig } from "@zerotal/audit";
 * export default AuditConfig({ driver: "database" });
 */
export class AuditProvider extends ServiceProvider {
  static override provides = ["audit"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  override onRegister(): void {
    // Provision the audit_logs table on boot (after models are discovered) — no
    // migration required. Idempotent and skipped for the null driver.
    this.app.registerConcern?.(auditSchemaConcern);

    this.app.container.singleton("audit", async (c) => {
      const configManager = await c.make("config");
      const cfg: Partial<AuditConfigShape> =
        (configManager as { get<T>(path: string): T | undefined }).get<Partial<AuditConfigShape>>(
          "audit",
        ) ?? {};

      const resolved: AuditConfigShape = {
        driver: cfg.driver ?? "database",
        table: cfg.table ?? "audit_logs",
        pruneKeep: cfg.pruneKeep ?? 0,
        captureRequest: cfg.captureRequest ?? true,
      };

      const driver =
        resolved.driver === "null" ? new NullDriver() : new DatabaseDriver(resolved.table);

      return new Auditor(driver, resolved);
    });
  }

  /**
   * After boot: drain the `Auditable` registry.
   * Models composed with `Auditable(Base)` are wired to the live Auditor here
   * rather than at import time, so the container is guaranteed ready.
   */
  override async onBooted(): Promise<void> {
    for (const ModelClass of _pendingAuditable) {
      registerAudit(ModelClass);
    }
    _pendingAuditable.clear();
  }
}
