# @zerotal/tenancy

> First-class multi-tenancy: resolve the active tenant per request and scope ORM, storage, and cache.

Resolves the active tenant from every incoming request and makes it available
everywhere in the call stack — ORM queries, storage paths, and cache keys — with
no manual thread-through. Supports both single-database (a `tenant_id` column,
scoped automatically by `Tenantable`) and multi-database (a connection per tenant,
routed automatically from a one-line `connect` factory) strategies — in both, your
models "just work" with no per-query wiring. **Beta** — APIs are stable but rough
edges remain.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/tenancy
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { TenancyProvider } from "@zerotal/tenancy";
import tenancyConfig from "../config/tenancy.ts";

export default [
  // …your other providers
  TenancyProvider.withConfig(tenancyConfig),
];
```

Configure it in `config/tenancy.ts`:

```ts
// config/tenancy.ts
import { TenancyConfig, SubdomainResolver } from "@zerotal/tenancy";
import { env } from "@zerotal/core";

export default TenancyConfig({
  strategy: env("TENANCY_STRATEGY", "single-database"),
  tenantColumn: "tenant_id",
  resolvers: [new SubdomainResolver("myapp.com")],
});
```

The tenant registry is **owned by the package** — the `tenants` and `tenant_members`
tables are provisioned automatically on boot (no migration, no app `Tenant` model,
no `findTenant` callback). Reach tenants through the `Tenant` facade.

Then add `TenancyMiddleware` to the global pipeline (or a route group):

```ts
import { TenancyMiddleware } from "@zerotal/tenancy";

Application.create({ providers }).use([TenancyMiddleware]);
```

## Usage

Compose `Tenantable` via `BaseModelWith` onto any tenant-owned model (the same flat
form used for every other mixin). Every query is scoped with
`WHERE tenant_id = <current tenant>` and `create()` injects the `tenant_id`:

```ts
import { BaseModelWith, column, table } from "@zerotal/orm";
import { Tenantable } from "@zerotal/tenancy";

@table("projects")
export class Project extends BaseModelWith(Tenantable) {
  @column() name!: string;
  @column() tenantId!: number;
}

// Inside a TenancyMiddleware boundary (tenant id = 7):
await Project.all(); // SELECT * FROM projects WHERE tenant_id = 7
await Project.create({ name: "A" }); // INSERT … (tenant_id, name) VALUES (7, 'A')
```

Bypass scoping when you need cross-tenant access, or run a job under a specific
tenant:

```ts
import { TenantContext } from "@zerotal/tenancy";

await Project.query().withoutTenancy().get(); // all tenants

await TenantContext.run(tenant, async () => {
  // queries here run scoped to `tenant`
});
```

Access the active tenant anywhere in the async call chain, and scope storage and
cache to it:

```ts
import { TenantContext, tenantDisk, tenantCache } from "@zerotal/tenancy";

const tenant = TenantContext.get(); // throws outside a boundary
const id = TenantContext.id(); // number | null

await tenantDisk().put("avatars/alice.jpg", buffer); // → tenants/<slug>/avatars/alice.jpg
await tenantCache().set("dashboard:stats", data, 300); // key: tenant:<slug>:dashboard:stats
```

### The `Tenant` facade

The `Tenant` facade carries the day-to-day tenancy API — the current tenant, tenant
CRUD, and membership (the `tenant_members` pivot). Mutations are admin-gated against
the authenticated user; `force*` variants bypass the check for trusted code.

```ts
import { Tenant } from "@zerotal/tenancy";

// Current tenant (inside a TenancyMiddleware boundary)
Tenant.current(); // the active tenant, or null
Tenant.check(); // true when there is an active, enabled tenant
Tenant.id(); // number | null

// Lifecycle — the authenticated creator becomes the first admin member
const acme = await Tenant.create({ slug: "acme", name: "Acme Inc." });
await Tenant.update({ name: "Acme LLC" }); // requires the current user to be an admin
await Tenant.forceUpdate({ name: "Acme LLC" }); // bypasses the admin check
await Tenant.delete(); // admin-gated; removes the tenant + its memberships
await Tenant.forceDelete();

// Membership — members() hydrates full User models from the ORM registry
await Tenant.addMember(userId, { admin: true });
await Tenant.members(); // User[]
await Tenant.member(); // the authenticated user as a member, or null
await Tenant.isMember(userId);
await Tenant.isMemberAdmin(userId);
await Tenant.promote(userId);
await Tenant.demote(userId);
await Tenant.removeMember(userId);

// Reads + running work under a tenant
await Tenant.find("acme"); // by slug
await Tenant.findById(1);
await Tenant.exists("acme");
await Tenant.all();
await Tenant.forId(1, () => Project.all()); // run a callback inside tenant #1's context
```

Membership hydration needs an authenticatable `User` model — compose
`Authenticatable` from `@zerotal/auth` on it. Tenancy discovers it via the ORM
registry, so there's no hard dependency between the two packages.

Clean up tenant-owned data when a tenant is deleted:

```ts
import { Tenant } from "@zerotal/tenancy";

Tenant.onTenantDeleted(async (tenant) => {
  await Project.query().withoutTenancy().where("tenant_id", tenant.id).delete();
});
```

### Multi-database

For the database-per-tenant strategy, set `strategy: "multi-database"` and supply a
one-line `connect` factory. Every model query inside a tenant boundary is then routed
to that tenant's connection automatically — no `TenantManager` wiring, no raw SQL,
the same `Project.all()` you already write:

```ts
// config/tenancy.ts
import { TenancyConfig, SubdomainResolver } from "@zerotal/tenancy";
import { SQL } from "bun";

export default TenancyConfig({
  strategy: "multi-database",
  resolvers: [new SubdomainResolver("myapp.com")],
  connect: (tenant) => new SQL(`file:./storage/tenants/${tenant.database}`),
});
```

Routing is `AsyncLocalStorage`-scoped, so concurrent requests for different tenants
stay isolated. See the [tenancy guide](../../docs/tenancy.md#multi-database-strategy)
for details.

## Exports

- `Tenant` — the facade: current tenant, tenant CRUD, and membership.
- `Tenancy` — the service behind the facade (bound as `"tenancy"`).
- `TenantModel` — the internal tenant record (owned by the package; reach it via `Tenant`).
- `TenantDeletedHook` — type of the `Tenant.onTenantDeleted` callback.
- `TenantContext` — access the active tenant (`get`, `tryGet`, `id`, `slug`, `run`).
- `TenancyMiddleware` — resolves the tenant per request.
- `TenancyProvider` — wires tenancy (`.withConfig(...)`).
- `TenantManager` / `TenantManagerOptions` — per-tenant connections (multi-database).
- Resolvers: `SubdomainResolver`, `HeaderResolver`, `PathResolver`.
- `Tenantable` — ORM mixin that scopes queries to the current tenant.
- `tenantDisk`, `tenantCache` — tenant-scoped storage and cache helpers.
- `TenancyConfig`, `tenancyConfig` — config factory.
- Errors: `TenantNotFoundError`, `TenantInactiveError`, `TenantForbiddenError`,
  `TenancyNotConfiguredError`, `TenancyConfigError`, `NoActiveTenantError`.
- Types: `Tenant`, `MultiDbTenant`, `TenantResolver`, `TenantResolverResult`,
  `TenancyStrategy`, `TenancyConfigShape`.

## Documentation

- [Multi-Tenancy](../../docs/tenancy.md)
