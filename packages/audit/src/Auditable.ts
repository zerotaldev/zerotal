// ── Auditable ───────────────────────────────────────────────────────────────
//
// Audit-logging mixin. Apply to any model whose writes should be recorded:
//
//   export class User extends Auditable(AuthUser) {
//     protected static auditExcept = ["password", "rememberToken"];
//   }
//
// Like every other mixin it takes only `(Base)` — there are no options arguments.
// Configure auditing by overriding static fields on the model, read at event time
// off the concrete subclass:
//
//   protected static auditExcept = ["password"]; // columns to scrub from snapshots
//   protected static auditOnly   = ["email"];    // allowlist (wins over auditExcept)
//   protected static auditType   = "User";       // override the logged type name
//
// Registration is deferred: the mixin enqueues the class at module-load (before the
// container has the "audit" binding) and `AuditProvider.onBooted()` drains the queue
// and wires each class to the live Auditor. Because ORM HookRegistry dispatch walks
// the prototype chain, hooks attached to this (anonymous) mixin class fire for the
// concrete subclass — and the observer reads config + type name from the instance's
// constructor, so the concrete `User` name and statics are what get used.

import { currentApp } from "@zerotal/core";
import { HookRegistry } from "@zerotal/orm";
import type { BaseModel, ModelQueryBuilder } from "@zerotal/orm";
import { AuditObserver } from "./AuditObserver.ts";
import type { Auditor } from "./Auditor.ts";
import { Audit } from "./facades/Audit.ts";
import { AuditLog } from "./AuditLog.ts";
import { auditableTypeOf, auditableIdOf } from "./auditableMeta.ts";
import type { AuditEvent, InstanceAuditPayload } from "./types.ts";

type ModelClass = typeof BaseModel & { new (): BaseModel };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Classes awaiting audit registration. `Auditable` adds to this set at module-load;
 * `AuditProvider.onBooted()` drains it once the container is ready.
 */
export const _pendingAuditable = new Set<ModelClass>();

// Maps AuditObserver method names to ORM HookRegistry hook names.
// Mirrors the _methodToHook table in @zerotal/orm/model/Observer.ts.
const METHOD_TO_HOOK: Record<string, string> = {
  created: "afterCreate",
  saving: "beforeSave", // ← captures old values before _original is patched
  updated: "afterUpdate",
  deleted: "afterDelete",
};

/**
 * Wire audit observation onto a model class against the live Auditor.
 *
 * Called by `AuditProvider.onBooted()` for each `Auditable`-composed class. Also
 * usable programmatically for a model you'd rather not wrap in the mixin — set the
 * static `auditExcept` / `auditOnly` / `auditType` fields to configure it.
 *
 * Must run after the container has resolved the "audit" binding (i.e. in onBooted()).
 */
export function registerAudit(ModelClass: ModelClass): void {
  const app = currentApp();
  const auditor = app.container.makeSync("audit") as Auditor;
  const observer = new AuditObserver(auditor);

  for (const [method, hook] of Object.entries(METHOD_TO_HOOK)) {
    const fn = (observer as unknown as Record<string, unknown>)[method];
    if (typeof fn === "function") {
      HookRegistry.register(
        ModelClass,
        hook as Parameters<typeof HookRegistry.register>[1],
        (fn as (...args: unknown[]) => void | Promise<void>).bind(observer),
      );
    }
  }
}

/**
 * `Auditable(Base)` — mixin that enables automatic audit logging for the resulting
 * model and adds the instance methods `auditLog()` and `auditLogs()`. Configure via
 * overridable static fields on the model (see file header).
 */
export function Auditable<TBase extends Constructor>(Base: TBase) {
  class Auditable extends Base {
    /**
     * Record a custom audit event against this instance — `auditable_type` and
     * `auditable_id` are filled in automatically.
     *
     * @example
     * await user.auditLog("login.success", { tags: { method: "github_oauth" } });
     */
    async auditLog(event: AuditEvent, payload: InstanceAuditPayload = {}): Promise<void> {
      await Audit.log(event, this as unknown as BaseModel, payload);
    }

    /**
     * A chainable query of this instance's audit history.
     *
     * @example
     * const logs = await user.auditLogs().desc().limit(25).get();
     * const page = await user.auditLogs().orderBy("id", "desc").paginate(20, 1);
     */
    auditLogs(): ModelQueryBuilder<AuditLog> {
      return AuditLog.query()
        .where("auditable_type", auditableTypeOf(this))
        .where("auditable_id", auditableIdOf(this));
    }
  }
  _pendingAuditable.add(Auditable as unknown as ModelClass);
  return Auditable;
}
