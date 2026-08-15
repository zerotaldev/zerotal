// ── Tenantable ──────────────────────────────────────────────────────────────
//
// Multi-tenant model mixin. Compose it via `Model.using`, like every other mixin:
//
//   import { Model, column, table } from "@zerotal/orm";
//   import { Tenantable } from "@zerotal/tenancy";
//
//   @table("projects").withTimestamps()
//   export class Project extends Model.using(Tenantable) {
//     @column() name!: string;
//     @column() tenantId!: number;
//   }
//
// Configure the tenant FK column by overriding the static field (default
// `tenant_id`):
//
//   protected static tenantColumn = "org_id";
//
// It registers two behaviours against the model:
//   1. Query scoping — every SELECT/UPDATE/DELETE gets `WHERE <col> = <tenant id>`
//      via the ORM global-scope system. Outside a tenant context the scope matches
//      *nothing*, so a missing boundary is an empty result, never every tenant's rows.
//   2. Create injection — inside a boundary the tenant column is set from the context and
//      is authoritative, so a client-supplied `tenant_id` cannot redirect the write.
//
//   const projects = await Project.all();              // … WHERE tenant_id = 7
//   const all = await Project.query().withoutTenancy().get(); // bypass for admin
//
// Registration is deferred: the mixin enqueues the anonymous class at module-load
// (before the ORM context is live) and TenancyProvider.onBooted() drains the queue
// and wires each class to the live ORM context. This matches the Auditable pattern
// and avoids hooks/scopes being lost when registerAppScope resets the ORM context.

import { TenantContext } from "./TenantContext.ts";
import { _globalScopeRegistry, ModelQueryBuilder as MQB, HookRegistry } from "@zerotal/orm";
import type { ModelQueryBuilder } from "@zerotal/orm";
import type { BaseModel } from "@zerotal/orm";
import type { ClassRef } from "@zerotal/core";

const SCOPE_NAME = "__tenant__";
const DEFAULT_COLUMN = "tenant_id";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
type Constructor<T = object> = new (...args: any[]) => T;

/** Resolve the tenant column for a concrete model class (honours static override). */
function _tenantColumn(ctor: unknown): string {
  return (ctor as { tenantColumn?: string })?.tenantColumn ?? DEFAULT_COLUMN;
}

/**
 * Classes awaiting tenant-scope registration. `Tenantable` adds to this set at
 * module-load; `TenancyProvider.onBooted()` drains it once the ORM context is live.
 * After boot, new classes are registered immediately via `_markTenantProviderBooted()`.
 */
export const _pendingTenantable = new Set<ClassRef>();
let _tenantProviderBooted = false;
export function _markTenantProviderBooted(): void {
  _tenantProviderBooted = true;
}

/**
 * Wire the global query scope and beforeCreate hook onto a model class.
 * Called by `TenancyProvider.onBooted()` for each `Tenantable`-composed class.
 */
export function registerTenantScoping(cls: ClassRef): void {
  // ── 1. Global query scope ────────────────────────────────────────────────
  const registry = _globalScopeRegistry();
  let scopes = registry.get(cls as unknown as typeof BaseModel);
  if (!scopes) {
    scopes = new Map();
    registry.set(cls as unknown as typeof BaseModel, scopes);
  }
  scopes.set(SCOPE_NAME, (qb: ModelQueryBuilder<BaseModel>) => {
    const column = _tenantColumn((qb as unknown as { _ModelClass?: unknown })._ModelClass);
    const tenantId = TenantContext.id();
    if (tenantId !== null) {
      qb.where(column, tenantId);
      return;
    }
    // No tenant context: match nothing rather than everything. A tenant-scoped model
    // queried outside a boundary — the apex domain, a queue worker, a resolver that found
    // no tenant — otherwise returned every tenant's rows, and did it silently. Failing
    // closed turns that into an obviously-empty result, and code that genuinely wants
    // cross-tenant reach says so with `withoutTenancy()`.
    qb.whereRaw("1 = 0");
  });

  // ── 2. Set the tenant column on create ───────────────────────────────────
  HookRegistry.register(cls as unknown as typeof BaseModel, "beforeCreate", (model: BaseModel) => {
    const column = _tenantColumn(model.constructor);
    const rec = model as unknown as Record<string, unknown>;
    const tenantId = TenantContext.id();
    // Inside a boundary the context is authoritative and overwrites whatever is there.
    // Fill-if-absent made the column mass-assignable: `Project.create(request.all())` with
    // an attacker-supplied `tenant_id` wrote straight into another tenant, with the
    // mass-assignment guard as the only thing in the way. Cross-tenant writes are done by
    // running inside that tenant's context, not by naming it in the payload.
    if (tenantId !== null) rec[column] = tenantId;
  });
}

export function Tenantable<TBase extends Constructor>(Base: TBase) {
  const cls = class extends Base {
    /** Tenant foreign-key column. Override per model to change it. */
    static tenantColumn = DEFAULT_COLUMN;
  };

  _pendingTenantable.add(cls);
  if (_tenantProviderBooted) {
    // Provider already booted — register into the live context now.
    // The class stays in _pendingTenantable so future onBooted() calls
    // (new Application instances) re-register it into the new context.
    registerTenantScoping(cls);
  }
  return cls;
}

// ── Augment ModelQueryBuilder with withoutTenancy() ──────────────────────────

declare module "@zerotal/orm" {
  // Declaration merging requires the type parameter list to match the merged
  // declaration exactly, so `M` cannot be renamed or dropped even though this
  // augmentation's body never reads it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ModelQueryBuilder<M extends BaseModel> {
    /**
     * Remove the tenant global scope for this query only.
     *
     * @example
     * // Admin route — load all projects across tenants:
     * const all = await Project.query().withoutTenancy().get();
     */
    withoutTenancy(): this;
  }
}

// Patch the prototype once at module-load time.
(MQB.prototype as unknown as Record<string, unknown>)["withoutTenancy"] = function (
  this: ModelQueryBuilder<BaseModel>,
): ModelQueryBuilder<BaseModel> {
  return this.withoutGlobalScope(SCOPE_NAME);
};
