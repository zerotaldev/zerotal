import { createFacade } from "@zerotal/core";
import type { Tenancy } from "../Tenancy.ts";
import type { Tenant as TenantRecord } from "../types.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    tenancy: Tenancy;
  }
}

/**
 * Tenant facade — the primary entry point to tenancy.
 *
 * @example
 * import { Tenant } from "@zerotal/tenancy";
 *
 * Tenant.current();           // the active tenant (or null)
 * Tenant.check();             // is there an active, enabled tenant?
 * await Tenant.members();     // hydrated User models
 * await Tenant.update({ name }); // admin-gated
 *
 * (The `Tenant` *type* — the tenant record shape — is exported separately and
 * coexists with this value, so `Tenant.current(): Tenant` reads naturally.)
 */
export const Tenant = createFacade("tenancy");

/**
 * The tenant **record** shape (`{ id, slug, name, isActive, … }`). Shares the `Tenant`
 * name with the facade value above — value and type namespaces coexist — so both
 * `Tenant.current()` (value) and `: Tenant` (type) read naturally from one import.
 */
export type Tenant = TenantRecord;
