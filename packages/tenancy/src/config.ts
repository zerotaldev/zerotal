/**
 * Tenancy config factory.
 *
 * @example
 * // config/tenancy.ts
 * import { TenancyConfig, SubdomainResolver } from "@zerotal/tenancy";
 *
 * export default TenancyConfig({
 *   strategy: "single-database",
 *   resolvers: [new SubdomainResolver("myapp.com")],
 * });
 *
 * The tenant registry (`tenants` table) is owned by the package — no `findTenant`
 * callback or app tenant model needed. Reach tenants via the `Tenant` facade.
 */

import { deepMerge } from "@zerotal/core";
import type { TenancyConfigShape } from "./types.ts";

// `resolvers` has no default — it is required from the caller. deepMerge passes the
// resolver instances through by reference (it only deep-clones plain objects/arrays).
const defaults: Partial<TenancyConfigShape> = {
  strategy: "single-database",
  tenantColumn: "tenant_id",
};

export function TenancyConfig(
  config: Partial<TenancyConfigShape> & Pick<TenancyConfigShape, "resolvers">,
): TenancyConfigShape {
  return deepMerge(defaults as TenancyConfigShape, config);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    tenancy: TenancyConfigShape;
  }
}
