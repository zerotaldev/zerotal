import { HttpError, ZerotalError } from "@zerotal/core";

/**
 * No tenant could be resolved from the request, or the resolved identifier
 * doesn't match any tenant. Renders as a 404 (content-negotiated by the
 * framework's exception handler).
 */
export class TenantNotFoundError extends HttpError {
  constructor(message = "This account doesn’t exist.") {
    super(message, 404, "E_TENANT_NOT_FOUND");
  }
}

/**
 * The tenant exists but is not active (`is_active === false`). Renders as a 403.
 */
export class TenantInactiveError extends HttpError {
  constructor(message = "This account has been disabled.") {
    super(message, 403, "E_TENANT_INACTIVE");
  }
}

/**
 * Tenancy was used before it was configured — `TenancyProvider` isn't registered
 * or `TenancyMiddleware` ran before boot. A misconfiguration (500).
 */
export class TenancyNotConfiguredError extends HttpError {
  constructor(
    message = "Tenancy is not configured. Register TenancyProvider and apply TenancyMiddleware.",
  ) {
    super(message, 500, "E_TENANCY_NOT_CONFIGURED");
  }
}

/**
 * The current user tried an admin-only tenant action (`update`/`delete`) without
 * being an admin member of the tenant. Renders as a 403. Use the `force*` variants
 * to bypass the check from trusted server code.
 */
export class TenantForbiddenError extends HttpError {
  constructor(message = "You don’t have permission to manage this account.") {
    super(message, 403, "E_TENANT_FORBIDDEN");
  }
}

/**
 * A required companion package or configuration for a tenancy feature is missing
 * (e.g. `tenantDisk()` without a configured disk). A misconfiguration (500).
 */
export class TenancyConfigError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_TENANCY_CONFIG", 500);
  }
}

/**
 * `TenantContext.get()` (or `Tenant.current()`) was called outside an active
 * tenant boundary. A programming error — wrap the code in TenancyMiddleware, or
 * use `TenantContext.getOrNull()` in shared (tenant + non-tenant) code.
 */
export class NoActiveTenantError extends ZerotalError {
  constructor(
    message = "No active tenant. This code ran outside a tenant boundary — is TenancyMiddleware applied? (use TenantContext.getOrNull() in shared code).",
  ) {
    super(message, "E_NO_ACTIVE_TENANT", 500);
  }
}

/**
 * Raised when a caller-supplied storage key would escape the active tenant's directory.
 *
 * `tenantDisk()` prefixes keys with `tenants/<slug>/`, but the underlying LocalDriver confines
 * paths to the *disk root*, not the tenant directory — so a key containing `..` resolved to a
 * sibling tenant's folder and passed the driver's own check. Traversal is rejected at the
 * prefixing layer instead.
 */
export class TenantStoragePathError extends ZerotalError {
  constructor(path: string, slug: string) {
    super(
      `Storage path "${path}" is not allowed for tenant "${slug}": it would resolve outside ` +
        `the tenant's directory. Use a relative key with no ".." segments and no leading "/".`,
      "E_TENANT_STORAGE_PATH",
      400,
    );
  }
}
