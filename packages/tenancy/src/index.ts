// @zerotal/tenancy — public API

// Facade + service (the primary entry point). The `Tenant` export is both the facade
// *value* and the tenant-record *type* (they share the name from one module).
export { Tenant } from "./facades/Tenant.ts";
export { Tenancy } from "./Tenancy.ts";
export type { TenantDeletedHook } from "./Tenancy.ts";
export { TenantModel } from "./TenantModel.ts";

// Core
export { TenantContext } from "./TenantContext.ts";
// TenancyMiddleware is intentionally NOT exported — TenancyProvider registers it globally.
// Apps gate tenant-required routes with EnsureTenancyMiddleware instead.
export { EnsureTenancyMiddleware } from "./EnsureTenancyMiddleware.ts";
export { TenancyProvider } from "./provider/TenancyProvider.ts";
export { TenantManager } from "./TenantManager.ts";
export type { TenantManagerOptions } from "./TenantManager.ts";

// Resolvers
export { SubdomainResolver } from "./resolvers/SubdomainResolver.ts";
export { HeaderResolver } from "./resolvers/HeaderResolver.ts";
export { PathResolver } from "./resolvers/PathResolver.ts";
export { RouteParamResolver } from "./resolvers/RouteParamResolver.ts";
export { AuthResolver } from "./resolvers/AuthResolver.ts";

// Model mixin
export { Tenantable } from "./Tenantable.ts";

// Storage / Cache helpers
export { tenantDisk, tenantCache } from "./tenantStorage.ts";

// Config
export { TenancyConfig } from "./config.ts";

// Errors
export {
  TenantNotFoundError,
  TenantInactiveError,
  TenantForbiddenError,
  TenancyNotConfiguredError,
  TenancyConfigError,
  TenantStoragePathError,
  NoActiveTenantError,
} from "./errors.ts";

// Types
// Note: the `Tenant` record type is exported from ./facades/Tenant.ts (alongside the
// facade value), so it is intentionally absent here.
export type {
  MultiDbTenant,
  TenantResolver,
  TenantResolverResult,
  TenancyStrategy,
  TenancyConfigShape,
} from "./types.ts";
