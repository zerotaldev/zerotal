---
name: zerotal-tenancy
description: "Make a Zerotal app multi-tenant, or make a model tenant-owned — installing and configuring @zerotal/tenancy, scoping models, jobs that run outside a request, and the isolation test."
---

<!-- zerotal:arch:generated -->

# Adding tenancy

Do not build tenant scoping by hand. `@zerotal/tenancy` resolves the tenant, scopes queries
and writes, owns the `tenants` and `tenant_members` tables, and scopes cache and storage.
If `app_info` does not list it, ask before `bun add @zerotal/tenancy`.

## Sequence

1. Read the `tenancy` page (`search_docs "tenancy"`) and pick a strategy: one database with
   a `tenant_id` column per table (the default), or a database per tenant.
2. `config/tenancy.ts` with `TenancyConfig({ resolvers: [...] })`; register
   `TenancyProvider.withConfig(tenancyConfig)` in `bootstrap/providers.ts`. The provider
   installs the resolving middleware itself — do not register it again.
3. Compose `Tenantable` onto each tenant-owned model: `Model.using(Tenantable)`, alongside
   any mixins it already has. Add the `tenant_id` column the way this app adds any column
   (see the `zerotal-schema-changes` skill).
4. Put `EnsureTenancyMiddleware` on the routes that make no sense without a tenant.
5. Write the isolation test, then `bun zt test` and `bun zt doctor`.

## Traps

- **Outside a tenant boundary nothing is scoped.** A query with no tenant resolved returns
  every tenant's rows. Jobs, commands and schedules run outside a request: wrap their work
  in `TenantContext.run(tenant, ...)`, one tenant at a time.
- **Never take the tenant id from the request body or query string.** It comes from the
  resolved context; a model's `tenantId` is filled on create for you.
- **Bypassing is explicit.** `withoutTenancy()` on a query is for an admin screen that
  genuinely spans tenants, and nothing else.
- **Cache keys and file paths cross tenants** unless you use `tenantCache()` and
  `tenantDisk()`.
- **The test that matters is a negative.** Create a row as one tenant, query as another,
  and assert the count is zero.
