---
title: Multi-Tenancy
description: Resolve the active tenant from each request and isolate its data, files, and cache automatically across the call stack.
---

# Multi-Tenancy

`@zerotal/tenancy` gives Zerotal applications first-class multi-tenancy. It resolves the active tenant from every incoming request and makes that tenant available everywhere in the call stack — ORM queries, storage paths, and cache keys — without any manual thread-through.

## Choosing a strategy

Two isolation strategies are supported. Pick by how strongly tenant data must be separated.

- **`single-database` (default)** — every tenant-owned table has a `tenant_id` column. The `Tenantable` mixin appends `WHERE tenant_id = ?` to every query. Simplest to operate; the right choice for most SaaS apps.
- **`multi-database`** — each tenant gets its own database connection, opened by a `connect` factory you supply. Strongest isolation; suited to enterprise customers with hard data-separation requirements.

| Strategy          | How isolation works                                                                                 | When to use                                   |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `single-database` | `Tenantable` appends `WHERE tenant_id = ?` to every query on tenant-owned models.                   | Most SaaS apps; simpler to operate.           |
| `multi-database`  | Each tenant has its own connection; the ORM routes queries to it automatically inside the boundary. | Strong isolation; large enterprise customers. |

## Getting Started

```bash
# in your project root
bun add @zerotal/tenancy
```

The package owns the `tenants` registry and the `tenant_members` pivot tables — they are provisioned automatically on boot. You do **not** define a tenant model or write a migration for them.

## Register the provider

Supply the config with `TenancyProvider.withConfig(...)`, then add the provider to the array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { TenancyProvider } from "@zerotal/tenancy";
import tenancyConfig from "../config/tenancy.ts";

const providers = [
  // …your other providers
  TenancyProvider.withConfig(tenancyConfig),
];

export default providers;
```

Registering the provider switches on the following hooks (in lifecycle order):

- `onRegister` — binds the `Tenancy` service as a singleton under the `"tenancy"` key (the engine behind the `Tenant` facade) and registers the schema concern that provisions the `tenants` and `tenant_members` tables on boot.
- `onBooted` — configures `TenancyMiddleware` with the resolved config, wires every `Tenantable` model into the live ORM context, and (for `multi-database`) registers the per-tenant connection resolver.

> **Warning** — `withConfig(...)` must be called before the provider is registered, or `onRegister` throws `TenancyNotConfiguredError`. Calling `TenancyMiddleware` before the provider has booted throws the same error.

## Configuration

Create `config/tenancy.ts`. Use the `TenancyConfig()` helper so every field stays type-checked while defaults are filled in:

```typescript
// config/tenancy.ts
import { TenancyConfig, SubdomainResolver, HeaderResolver } from "@zerotal/tenancy";
import { env } from "zerotal";

export default TenancyConfig({
  strategy: env("TENANCY_STRATEGY", "single-database"), // 'single-database' | 'multi-database'
  tenantColumn: "tenant_id", // FK column appended by Tenantable

  resolvers: [
    new SubdomainResolver("myapp.com"),
    // Fallback: accept an X-Tenant-ID header for API clients
    new HeaderResolver("X-Tenant-ID"),
  ],
});
```

| Field          | Required            | Default             | Description                                                                                            |
| -------------- | ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `resolvers`    | yes                 | —                   | Resolvers tried in order until one returns a non-null identifier. All-null means a 404.                |
| `strategy`     | no                  | `"single-database"` | `"single-database"` or `"multi-database"`.                                                             |
| `tenantColumn` | no                  | `"tenant_id"`       | FK column appended by `Tenantable` in the single-database strategy.                                    |
| `connect`      | multi-database only | —                   | `(tenant: MultiDbTenant) => SQLInstance` factory opening each tenant's connection (pooled per tenant). |

> **Note** — The tenant registry is owned by the package. There is no `findTenant` callback and no app-level tenant model to wire up — reach tenants through the `Tenant` facade instead.

## Tenant resolvers

Resolvers are tried in order. The first one that returns a result wins.

### SubdomainResolver

Extracts the tenant slug from the leftmost subdomain.

```typescript
// config/tenancy.ts
import { SubdomainResolver } from "@zerotal/tenancy";

new SubdomainResolver("myapp.com");
// acme.myapp.com        → slug: 'acme'
// www.acme.myapp.com    → slug: 'acme'
// myapp.com             → null (no subdomain)
```

### HeaderResolver

Reads a custom request header — useful for API clients that can't use subdomains.

```typescript
// config/tenancy.ts
import { HeaderResolver } from "@zerotal/tenancy";

new HeaderResolver("X-Tenant-ID");
// Request: GET /api/users   X-Tenant-ID: acme
// → slug: 'acme'
```

### PathResolver

Extracts the tenant slug from a URL path segment.

```typescript
// config/tenancy.ts
import { PathResolver } from "@zerotal/tenancy";

new PathResolver({ segment: 0 });
// GET /acme/dashboard  → slug: 'acme'

new PathResolver({ prefix: "/tenants", segment: 0 });
// GET /tenants/acme/settings  → slug: 'acme'  (prefix stripped, then segment 0)
```

### RouteParamResolver

Reads the slug from a named route parameter. Pair it with a `/:tenancy` group
prefix — the router captures the segment into `http.params` before middleware
runs, so the resolver just reads it:

```typescript
// config/tenancy.ts
import { RouteParamResolver } from "@zerotal/tenancy";

new RouteParamResolver({ param: "tenancy" }); // default param name
```

```typescript
// bootstrap/app.ts
.fileBasedRouting({
  dir: basePath("app/routes"),
  prefix: "/:tenancy",          // GET /acme/dashboard → params.tenancy = "acme"
  middleware: [TenancyMiddleware],
});
```

Use this instead of `PathResolver` when the tenant segment is part of your route
definitions rather than a fixed position in the URL — it survives a prefix change
that would break a positional lookup.

### AuthResolver

Resolves the tenant from the **signed-in user** rather than the URL. The user
carries its tenant foreign key (`tenantId` by default), and the resolver reads it
off `http.user`:

```typescript
// config/tenancy.ts
import { RouteParamResolver, AuthResolver } from "@zerotal/tenancy";

resolvers: [
  new RouteParamResolver({ param: "tenancy" }),
  new AuthResolver(), // falls back to the logged-in user's tenantId
];
```

Order matters: put it **after** the URL-based resolvers so an explicit slug in
the path still wins, with the user as the fallback for tenant-scoped routes that
carry no slug.

Requests with no authenticated user — login, signup, a public marketing page —
resolve to `null` here, and with `strict: false` (the default) fall through to
the default connection rather than failing.

```typescript
// config/tenancy.ts — a non-default column
new AuthResolver({ column: "organisationId" });
```

> **Note** — `AuthResolver` reads `http.user` rather than importing
> `@zerotal/auth`, so tenancy stays decoupled from the auth package. Anything
> that populates `http.user` works, including your own middleware.

### Custom resolver

Implement the `TenantResolver` interface — return a `{ identifier }` result, or `null` to defer to the next resolver:

```typescript
// app/tenancy/CookieResolver.ts
import type { TenantResolver, TenantResolverResult } from "@zerotal/tenancy";

export class CookieResolver implements TenantResolver {
  resolve(request: Request): TenantResolverResult | null {
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(/tenant=([^;]+)/);
    return match ? { identifier: match[1]! } : null;
  }
}
```

## Registering TenancyMiddleware

`TenancyMiddleware` resolves the tenant and opens the [TenantContext](#tenantcontext-access-the-tenant-anywhere) boundary. Apply it globally or to specific route groups.

### Global

With `TenancyProvider` already registered, add the middleware to the global pipeline with `.use()` in `bootstrap/app.ts`:

```typescript
// bootstrap/app.ts
import { TenancyMiddleware } from "@zerotal/tenancy";

Application.create({ providers }).use([TenancyMiddleware]);
```

### Route group only

```typescript
// routes/web.ts
import { TenancyMiddleware } from "@zerotal/tenancy";

Router.group({ domain: "{tenant}.myapp.com" }, () => {
  Router.get("/dashboard", DashboardController, "index");
  Router.get("/settings", SettingsController, "index");
}).use([TenancyMiddleware]);
```

The middleware throws an [error](/docs/errors) the framework's exception handler renders by content negotiation:

| Situation                  | Error                       | Status | Message                           |
| -------------------------- | --------------------------- | ------ | --------------------------------- |
| No resolver matched        | `TenantNotFoundError`       | 404    | `This account doesn’t exist.`     |
| Slug not in the registry   | `TenantNotFoundError`       | 404    | `This account doesn’t exist.`     |
| `isActive` is false        | `TenantInactiveError`       | 403    | `This account has been disabled.` |
| Middleware ran before boot | `TenancyNotConfiguredError` | 500    | configuration error               |

## ORM scoping — Tenantable

Compose the `Tenantable` mixin via [`Model.using`](/docs/orm/index#composing-model-mixins) onto any model that belongs to a tenant. Two things happen automatically:

1. Every query on the model receives `WHERE tenant_id = <current tenant id>` (skipped outside a tenant context).
2. `create()` / `save()` inject `tenant_id` on new records, so you never accidentally write cross-tenant data.

```typescript
// app/models/Project.ts
import { Model, column, table } from "@zerotal/orm";
import { Tenantable } from "@zerotal/tenancy";

@(table("projects").withTimestamps())
export class Project extends Model.using(Tenantable) {
  @column() name!: string;
  @column() tenantId!: number;
}
```

```typescript
// in a controller — inside a TenancyMiddleware boundary (tenant id = 7):
const projects = await Project.all();
// → SELECT * FROM projects WHERE tenant_id = 7

const project = await Project.create({ name: "Alpha" });
// → INSERT INTO projects (tenant_id, name) VALUES (7, 'Alpha')

await Project.where("name", "Alpha").delete();
// → DELETE FROM projects WHERE tenant_id = 7 AND name = 'Alpha'
```

### Custom column name

Override the static `tenantColumn` field (default `tenant_id`):

```typescript
// app/models/Invoice.ts
import { Model, column, table } from "@zerotal/orm";
import { Tenantable } from "@zerotal/tenancy";

@(table("invoices").withTimestamps())
export class Invoice extends Model.using(Tenantable) {
  protected static tenantColumn = "organisation_id";

  @column() amount!: number;
}
// → SELECT * FROM invoices WHERE organisation_id = 7
```

## Bypassing tenancy

### Single query

```typescript
// in an admin controller — load every project across all tenants:
const all = await Project.query().withoutTenancy().get();
```

`withoutTenancy()` removes only the tenant scope. To strip every global scope instead:

```typescript
// in a controller
const all = await Project.query().withoutGlobalScopes().get();
```

### Entire background job

Wrap the work in a tenant boundary with `TenantContext.run()` (or `Tenant.run()` via the facade) to scope every query inside it to a specific tenant:

```typescript
// app/jobs/SendReminders.ts
import { TenantContext, Tenant } from "@zerotal/tenancy";

const tenants = await Tenant.all();

for (const tenant of tenants) {
  await TenantContext.run(tenant, async () => {
    const overdue = await Invoice.where("due_date", "<", today).get();
    // send reminders…
  });
}
```

## TenantContext — access the tenant anywhere

Once `TenancyMiddleware` has run, the active tenant is available anywhere in the async call chain:

```typescript
// anywhere downstream of TenancyMiddleware
import { TenantContext } from "@zerotal/tenancy";

// Throws NoActiveTenantError if called outside a tenant boundary:
const tenant = TenantContext.get();

// Safe version — returns undefined outside a boundary:
const maybeTenant = TenantContext.tryGet();

// Shortcuts:
const id = TenantContext.id(); // number | null
const slug = TenantContext.slug(); // string | null
```

The `Tenant` facade exposes the same current-tenant accessors plus tenant CRUD and membership (see [References](#references)):

```typescript
// in a controller
import { Tenant } from "@zerotal/tenancy";

const tenant = Tenant.current(); // the active tenant, or null
if (Tenant.check()) {
  /* there is an active, enabled tenant */
}
```

Controllers also receive the resolved tenant directly on the request context:

```typescript
// in a controller
async index(ctx: HttpContext): Promise<void> {
  const tenant = (ctx as any).tenant as Tenant;
  ctx.json({ tenantName: tenant.name });
}
```

## Tenant membership

The package maintains a `tenant_members` pivot linking your authenticated [User](/docs/authentication) model to tenants, with an admin flag. `Tenancy.create()` makes the current user the first admin; `update()` and `delete()` are admin-gated (use the `force*` variants to bypass the check from trusted server code).

```typescript
// in a controller
import { Tenant } from "@zerotal/tenancy";

await Tenant.create({ slug: "acme", name: "Acme Inc" }); // current user becomes admin
await Tenant.addMember(userId, { admin: true });
const team = await Tenant.members(); // hydrated User models
await Tenant.update({ name: "Acme Corp" }); // throws TenantForbiddenError unless admin
```

> **Note** — Membership requires an authenticatable User model. Compose `Authenticatable` (from `@zerotal/auth`) on it, or `Tenancy` throws `TenancyConfigError` when a membership method runs.

## Tenant-scoped storage

`tenantDisk()` wraps any [storage](/docs/storage) disk and prefixes every path with `tenants/<slug>/` for the active tenant:

```typescript
// in a controller — inside a tenant boundary (slug = 'acme')
import { tenantDisk } from "@zerotal/tenancy";

// Saves to:  /storage/tenants/acme/avatars/alice.jpg
await tenantDisk().put("avatars/alice.jpg", buffer);

// Reads from: /storage/tenants/acme/avatars/alice.jpg
const file = await tenantDisk().get("avatars/alice.jpg");

// Use a named disk:
await tenantDisk("s3").put("reports/q4.pdf", pdf);
```

> **Warning** — `tenantDisk()` calls `TenantContext.get()` eagerly, so it throws `NoActiveTenantError` outside a tenant boundary. Requires `zerotal/storage` to be installed.

## Tenant-scoped cache

`tenantCache()` wraps the [cache](/docs/cache) and prefixes every key with `tenant:<slug>:`:

```typescript
// in a controller — inside a tenant boundary (slug = 'acme')
import { tenantCache } from "@zerotal/tenancy";

// Key stored as: tenant:acme:dashboard:stats
await tenantCache().set("dashboard:stats", data, 300);
const stats = await tenantCache().get<Stats>("dashboard:stats");

await tenantCache().forget("dashboard:stats");

// Use a named store:
const redisCache = tenantCache("redis");
```

## Multi-database strategy

Set `strategy: "multi-database"` and supply a `connect` factory. `TenancyProvider` builds the per-tenant connection pool and registers an ORM connection resolver, so every model query inside a tenant boundary is routed to that tenant's database automatically — app models stay plain:

```typescript
// config/tenancy.ts
import { TenancyConfig, SubdomainResolver } from "@zerotal/tenancy";
import { SQL } from "bun";

export default TenancyConfig({
  strategy: "multi-database",
  resolvers: [new SubdomainResolver("myapp.com")],
  connect: (tenant) => new SQL(`file:./storage/tenants/${tenant.database}`),
});
```

```typescript
// in a controller — Project.all() automatically uses the active tenant's connection:
const projects = await Project.all();
```

The `database` column on each tenant record names its connection target. You rarely touch `TenantManager` directly — it is exported only for raw, out-of-ORM access (a manual migration or bulk import):

```typescript
// app/jobs/MigrateTenant.ts — raw connection for the active tenant:
import { TenantManager } from "@zerotal/tenancy";
import { SQL } from "bun";

const manager = new TenantManager({
  connect: (tenant) => new SQL(`file:./storage/tenants/${tenant.database}`),
});
const conn = manager.connection(); // active tenant's SQLInstance
await conn`SELECT * FROM projects`;
```

> **Danger** — App models that belong to a tenant must be composed with `Tenantable`; the package-owned `TenantModel` is deliberately not, because the tenant registry lives in the central/platform database and bootstraps the tenant context rather than being scoped within one.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Tenancy has one
test that matters more than all the others: **a tenant must not see another
tenant's rows.** Write it first, and write it as a negative.

```typescript
// tests/tenancy/isolation.test.ts
import { test, expect } from "bun:test";
import { Tenancy, TenantContext } from "@zerotal/tenancy";
import { createApp } from "../helpers.ts";
import { Post } from "../../app/models/Post.ts";

test("a tenant cannot read another tenant's posts", async () => {
  const app = await createApp();
  const acme = await Tenancy.create({ slug: "acme", name: "Acme" });
  const globex = await Tenancy.create({ slug: "globex", name: "Globex" });

  await Tenancy.run(acme, () => Post.create({ title: "Acme secret" }));

  const seen = await Tenancy.run(globex, () => Post.query().get());

  expect(seen).toHaveLength(0); // the assertion the whole feature exists for
  await app.close();
});
```

**Assert the count, not just the absence of a specific row.** `toHaveLength(0)`
fails loudly if scoping breaks; `expect(seen.find(...)).toBeUndefined()` passes
when the query returns everything but that one title.

**Test the resolver separately from the scoping.** They fail differently — a
broken resolver serves the wrong tenant's data correctly, which no isolation test
catches:

```typescript
// tests/tenancy/resolver.test.ts
const res = await app.get("/dashboard", { Host: "acme.example.test" });

expect(res.json().tenant).toBe("acme");
```

**Leaking context between tests is the common failure.** A test that sets a
tenant and throws leaves it set, and the next test passes or fails for reasons
that have nothing to do with it:

```typescript
// tests/tenancy/isolation.test.ts
afterEach(() => {
  expect(TenantContext.tryGet()).toBeUndefined(); // catches a leak at its source
});
```

> **Warning** — Under the multi-database strategy every tenant a test touches
> opens a connection that stays open for the life of the process. On Windows an
> open handle is an exclusive lock, so a teardown that removes the data directory
> fails with `EBUSY` while every assertion passes. Close tenant connections in
> your teardown before deleting files.

## References

### Tenant facade

Resolved from the container binding `"tenancy"`; the `Tenant` value is the facade and the `Tenant` type is the tenant record shape.

| Method            | Signature                                          | Description                                             |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `current`         | `current(): Tenant \| null`                        | The active tenant, or null outside a boundary.          |
| `check`           | `check(): boolean`                                 | True when there is an active, enabled tenant.           |
| `id`              | `id(): number \| null`                             | Active tenant's id.                                     |
| `slug`            | `slug(): string \| null`                           | Active tenant's slug.                                   |
| `run`             | `run<T>(tenant: Tenant, cb: () => T): T`           | Run `cb` with `tenant` active.                          |
| `forId`           | `forId<T>(id: number, cb): Promise<T>`             | Load tenant by id and run `cb` in its context.          |
| `find`            | `find(slug: string): Promise<TenantModel \| null>` | Look up a tenant by slug.                               |
| `all`             | `all(): Promise<TenantModel[]>`                    | Every tenant in the registry.                           |
| `create`          | `create(data): Promise<TenantModel>`               | Create a tenant; current user becomes admin.            |
| `update`          | `update(data): Promise<TenantModel>`               | Update current tenant (admin-gated).                    |
| `delete`          | `delete(): Promise<void>`                          | Delete current tenant + memberships (admin-gated).      |
| `forceUpdate`     | `forceUpdate(data): Promise<TenantModel>`          | Update bypassing the admin check.                       |
| `forceDelete`     | `forceDelete(): Promise<void>`                     | Delete bypassing the admin check.                       |
| `member`          | `member<T>(): Promise<T \| null>`                  | Current user as a member, or null.                      |
| `members`         | `members<T>(): Promise<T[]>`                       | All members, hydrated as User models.                   |
| `memberCount`     | `memberCount(): Promise<number>`                   | Number of members in the current tenant.                |
| `isMember`        | `isMember(userId?): Promise<boolean>`              | Whether a user belongs to the current tenant.           |
| `isMemberAdmin`   | `isMemberAdmin(userId?): Promise<boolean>`         | Whether a user is an admin of the current tenant.       |
| `addMember`       | `addMember(userId, opts?): Promise<void>`          | Add a member (idempotent); `{ admin: true }` for admin. |
| `removeMember`    | `removeMember(userId): Promise<void>`              | Remove a member.                                        |
| `promote`         | `promote(userId): Promise<void>`                   | Grant admin rights.                                     |
| `demote`          | `demote(userId): Promise<void>`                    | Revoke admin rights.                                    |
| `onTenantDeleted` | `onTenantDeleted(hook): void`                      | Register a cleanup hook fired after deletion.           |

### TenantContext

| Member   | Signature                                | Description                                          |
| -------- | ---------------------------------------- | ---------------------------------------------------- |
| `run`    | `run<T>(tenant: Tenant, cb: () => T): T` | Execute `cb` inside a tenant boundary.               |
| `get`    | `get(): Tenant`                          | Active tenant; throws `NoActiveTenantError` if none. |
| `tryGet` | `tryGet(): Tenant \| undefined`          | Active tenant, or undefined outside a boundary.      |
| `id`     | `id(): number \| null`                   | Active tenant's id.                                  |
| `slug`   | `slug(): string \| null`                 | Active tenant's slug.                                |

### TenantManager (multi-database)

| Method          | Signature                            | Description                                       |
| --------------- | ------------------------------------ | ------------------------------------------------- |
| `connection`    | `connection(): SQLInstance`          | Connection for the active tenant; throws if none. |
| `connectionFor` | `connectionFor(tenant): SQLInstance` | Connection for a specific tenant.                 |
| `warmUp`        | `warmUp(tenant): void`               | Pre-open a tenant's connection.                   |
| `evict`         | `evict(tenant): void`                | Close and drop a tenant's connection.             |
| `closeAll`      | `closeAll(): void`                   | Close every open connection.                      |

## Next steps

- [ORM](/docs/orm/index) — how `Tenantable` composes onto your models via `Model.using`.
- [Storage](/docs/storage) — the disks `tenantDisk()` wraps.
- [Cache](/docs/cache) — the stores `tenantCache()` wraps.
- [Middleware](/docs/middleware) — where `TenancyMiddleware` runs in the pipeline.
- [Authentication](/docs/authentication) — the User model that tenant membership links to.
