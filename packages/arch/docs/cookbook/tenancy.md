---
title: Tenants by Subdomain
description: Scope a model to a tenant with @zerotal/tenancy, pick the tenant from the subdomain or an X-Tenant header, and prove with tests that one tenant cannot read another's rows.
---

# Tenants by Subdomain

Some apps give each customer an address of their own: `acme.example.com` is Acme's,
`globex.example.com` is Globex's, and the subdomain decides whose data a request sees. At
the end of this recipe the starter does that with `@zerotal/tenancy`: the tenant comes
from the subdomain, or from an `X-Tenant` header for API clients that call one host, a
`Customer` model is scoped to it, two tenants are seeded to try it with, and tests prove
that one tenant never reads another's rows.

The tutorial's [Teams](/docs/tutorial/multi-tenancy) milestone covers the other common
shape, where the tenant is whichever team the signed-in user works in and the URL does not
name it.

## Before you start

You need an app made from the React starter, `create-zerotal`. This recipe adds a new
model and leaves the starter's `Project` as it is.

The `zerotal` package bundles auth, cache, media, orm, queue, scheduler, session,
storage, testing and validator, imported as `zerotal/<name>`. Tenancy is not one of them:
it is a package of its own, installed in the first step.

## Install

```bash
# in your project root
bun add @zerotal/tenancy@~1.18.0
```

## Say where the tenant comes from

A resolver reads a tenant's slug off the request. List them in order; the first that finds
one wins:

```ts
// config/tenancy.ts
import { HeaderResolver, SubdomainResolver, TenancyConfig } from "@zerotal/tenancy";
import { env } from "zerotal";

export default TenancyConfig({
  resolvers: [
    // acme.example.com → the tenant whose slug is "acme". TENANT_DOMAIN is the domain the
    // subdomains hang off: localhost on your machine, so acme.localhost:3000 works.
    new SubdomainResolver(env("TENANT_DOMAIN", "localhost")),
    // For API clients and scripts that call one host: X-Tenant: acme.
    new HeaderResolver("X-Tenant"),
  ],
});
```

`SubdomainResolver` removes the domain from the end of the host name and takes the label
just in front of it, so `acme.localhost` and `www.acme.example.com` both name `acme`. The
bare domain names no tenant. Set `TENANT_DOMAIN` to your real domain in production.

Both resolvers read something the client chose, so the package does not take their word
for it. When a signed-in user names a tenant they are not a member of, by either route,
the request is refused with a 403 before it reaches your code. A slug that matches no
tenant, or a request that names none, carries on with no tenant at all.

Register the provider after `AuthProvider`, which is what tells it who is signed in. The
provider installs the middleware that resolves the tenant on every request; do not add it
yourself:

```ts fragment
// bootstrap/providers.ts
import { TenancyProvider } from "@zerotal/tenancy";
import tenancyConfig from "../config/tenancy";

// …

  AuthProvider,
  // After AuthProvider: the tenant check needs to know who is signed in.
  TenancyProvider.withConfig(tenancyConfig),
  NotificationProvider,
```

The package owns the `tenants` and `tenant_members` tables and creates them when the app
starts as a server, a worker or a test run. You do not write a migration for those.

## A tenant-owned model

```bash
# in your project root
bun zt make:model Customer -m
```

Replace the contents of the model it creates with:

```ts
// app/models/Customer.ts
import { Model, column, table } from "zerotal/orm";
import { Tenantable } from "@zerotal/tenancy";

/**
 * Someone a tenant does business with. Every tenant has its own list: `Tenantable` adds
 * the current tenant to every query on this model, and stamps it on every new row.
 */
@table("customers")
export class Customer extends Model.using(Tenantable) {
  static override fillable = ["name", "email"] as const;

  // The tenant that owns the row. Named by attribute, not by column: `Tenantable` sets
  // it on create, and a model with declared columns saves only those.
  static override tenantColumn = "tenantId";
  @column({ type: "number" }) tenantId!: number;

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;

  /** What a response is sent: the fields a client needs, as plain JSON. */
  toJSONResponse(): CustomerData {
    return { id: this.id, name: this.name, email: this.email };
  }
}

/** A customer as a response carries it. */
export interface CustomerData {
  id: number;
  name: string;
  email: string;
}
```

`Tenantable` is the whole of the scoping. Inside a tenant, every query on `Customer` gets
`WHERE tenant_id = ?` and every new customer is stamped with the tenant. Outside one, a
query matches nothing at all rather than every tenant's rows. `tenantId` is left out of
`fillable`: the tenant comes from the request, never from a form or a JSON body.

And the migration it created:

```ts
// database/migrations/0007_create_customers_table.ts
import { Migration, Schema } from "zerotal/orm";

export default class CreateCustomersTable extends Migration {
  override async up(): Promise<void> {
    await Schema.create("customers", (table) => {
      table.increments("id");
      // The tenant that owns the row. Indexed: every query on customers filters by it.
      table.integer("tenant_id").index();
      table.string("name");
      table.string("email");
      table.timestamps();
    });
  }

  override async down(): Promise<void> {
    await Schema.drop("customers");
  }
}
```

`tenant_id` is not nullable, so a customer saved outside a tenant fails loudly instead
of becoming a row no tenant can see.

```bash
# in your project root
bun zt migrate
```

```
…
Migrated 1 migration(s).
  0007_create_customers_table    ran
```

## Routes that need a tenant

Customers only make sense inside a tenant, so their route goes in a group of its own whose
middleware insists on one. Without a tenant it answers 404, rather than running a query
that would return nothing:

```ts
// app/routes/(auth)/(verified)/(tenant)/_middleware.ts
import { EnsureTenancyMiddleware } from "@zerotal/tenancy";

/**
 * Routes in (tenant)/ only make sense inside a tenant: on acme.localhost, or with an
 * X-Tenant header. Anywhere else they answer 404 rather than run with no tenant.
 */
export const middleware = [EnsureTenancyMiddleware];
```

The group sits inside `(auth)/(verified)/`, so a visitor must also be signed in with a
confirmed address, as for the starter's own pages. The route lists the tenant's customers
and adds one:

```ts fragment
// app/routes/(auth)/(verified)/(tenant)/customers.ts
import type { HttpContext } from "zerotal";
import { validate } from "zerotal/validator";
import { Tenant } from "@zerotal/tenancy";
import { Customer } from "@app/models/Customer";

// GET /customers — the current tenant's customers. Nothing here names the tenant:
// Tenantable adds it to the query.
export const GET = async () => {
  const customers = await Customer.query().orderBy("name").get();

  return Response.json({
    tenant: Tenant.slug(),
    customers: customers.map((customer) => customer.toJSONResponse()),
  });
};

// POST /customers — Tenantable stamps the new row with the current tenant. A tenant_id in
// the body is ignored: it is not fillable, and the tenant comes from the request.
export async function POST(http: HttpContext): Promise<Response> {
  const data = await validate(http, (r) => ({
    name: r.string().trim().min(2),
    email: r.string().trim().email(),
  }));

  const customer = await Customer.create(data);

  return Response.json({ customer: customer.toJSONResponse() }, { status: 201 });
}
```

Nothing in either handler mentions a tenant, and that is the point: a handler cannot
forget a filter it never had to write. Regenerate the route types after adding a route:

```bash
# in your project root
bun zt route:types
```

## Tenants to try it with

A seeder makes two tenants with a customer each, and puts the demo account in the first:

```ts fragment
// database/seeders/TenantsSeeder.ts
import { Seeder } from "zerotal/orm";
import { Tenant, TenantModel } from "@zerotal/tenancy";
import { Customer } from "@app/models/Customer";
import { User } from "@app/models/User";
import { DEMO_EMAIL } from "./DatabaseSeeder";

/**
 * Two tenants with a customer each, and the demo account in the first: sign in on
 * acme.localhost:3000 to see Acme's customers. Local data, like the demo account.
 */
export class TenantsSeeder extends Seeder {
  async run(): Promise<void> {
    const acme = await this.tenant("acme", "Acme Inc", "Road Runner", "rr@acme.test");
    await this.tenant("globex", "Globex", "Hank Scorpio", "hank@globex.test");

    const demo = await User.query().where("email", DEMO_EMAIL).first();
    if (demo) await Tenant.run(acme, () => Tenant.addMember(demo.id));
  }

  /** The tenant with this slug, made with one customer the first time. */
  private async tenant(slug: string, name: string, customer: string, email: string) {
    const existing = await TenantModel.query().where("slug", slug).first();
    if (existing) return existing;

    const tenant = await TenantModel.forceCreate({ slug, name, isActive: true });
    // Inside the tenant, so Tenantable stamps the customer with it.
    await Tenant.run(tenant, () => Customer.create({ name: customer, email }));
    return tenant;
  }
}
```

A seeder runs outside any request, so it opens the tenant itself with `Tenant.run()`.
`TenantModel.forceCreate()` makes a tenant from values built in code; `Tenant.create()`
would also make the signed-in user its admin, and a seeder has no signed-in user.

The starter's `DatabaseSeeder` returns early when the demo account exists. Turn that
early return into a condition, so the tenants are seeded either way, after the account:

```ts fragment
// database/seeders/DatabaseSeeder.ts
import { TenantsSeeder } from "./TenantsSeeder";

// …

  async run(): Promise<void> {
    if (!(await User.query().where("email", DEMO_EMAIL).first())) await this.createDemo();
    // After the demo account, which it adds to the acme tenant.
    await this.call([TenantsSeeder]);
  }

  /** The demo account and its projects. */
  private async createDemo(): Promise<void> {
    const demo = new User();
```

The rest of the old `run()` stays as it was, now the body of `createDemo()`.

The `tenants` table does not exist until the app has started once, and a console command
does not create it. Start `bun zt dev`, then, from another terminal:

```bash
# in your project root
bun zt db:seed
```

```
…
Database Seeding
Database seeded successfully.
```

Run before the app has ever started, it reports
`Failed to run seeders: no such table: tenants` instead.

## The tests

```ts fragment
// tests/customers.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Tenant, TenantContext, TenantModel } from "@zerotal/tenancy";
import { assertDatabaseHas, refreshDatabase, type TestApp } from "zerotal/testing";
import { Customer } from "../app/models/Customer";
import type { User } from "../app/models/User";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

/** Customers belong to a tenant, and one tenant never sees another's. */
let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());
// A test that leaves a tenant set would hand it to the next one.
afterEach(() => expect(TenantContext.tryGet()).toBeUndefined());

/** A tenant with `member` in it, as an admin would set one up. */
async function createTenant(slug: string, member: User): Promise<TenantModel> {
  const tenant = await TenantModel.forceCreate({ slug, name: slug, isActive: true });
  await Tenant.run(tenant, () => Tenant.addMember(member.id));
  return tenant;
}

describe("customers", () => {
  refreshDatabase();

  test("a tenant cannot read another tenant's customers", async () => {
    const alice = await UserFactory.create();
    const bob = await UserFactory.create();
    const acme = await createTenant("acme", alice);
    const globex = await createTenant("globex", bob);

    await Tenant.run(acme, () => Customer.create({ name: "Road Runner", email: "rr@acme.test" }));

    // Count, not the absence of one row: a query that ignored the tenant returns everything.
    expect(await Tenant.run(globex, () => Customer.query().get())).toHaveLength(0);
    expect(await Tenant.run(acme, () => Customer.query().get())).toHaveLength(1);
  });

  test("the subdomain picks the tenant", async () => {
    const alice = await UserFactory.create();
    const bob = await UserFactory.create();
    const acme = await createTenant("acme", alice);
    const globex = await createTenant("globex", bob);
    await Tenant.run(acme, () => Customer.create({ name: "Road Runner", email: "rr@acme.test" }));
    await Tenant.run(globex, () => Customer.create({ name: "Hank", email: "hank@globex.test" }));

    const res = await app.actingAs(alice).get("/customers", { Host: "acme.localhost" });

    res.assertOk();
    expect(res.json()).toEqual({
      tenant: "acme",
      customers: [expect.objectContaining({ name: "Road Runner" })],
    });
  });

  test("the X-Tenant header picks the tenant", async () => {
    const alice = await UserFactory.create();
    await createTenant("acme", alice);

    const res = await app.actingAs(alice).get("/customers", { "X-Tenant": "acme" });

    res.assertOk();
    expect(res.json()).toMatchObject({ tenant: "acme" });
  });

  test("a new customer belongs to the tenant it was created in", async () => {
    const alice = await UserFactory.create();
    const acme = await createTenant("acme", alice);

    const res = await app
      .actingAs(alice)
      .post("/customers", { name: "Coyote", email: "w.e@acme.test" }, { Host: "acme.localhost" });

    res.assertStatus(201);
    await assertDatabaseHas("customers", { name: "Coyote", tenant_id: acme.id });
  });

  test("naming a tenant you are not in is refused", async () => {
    const alice = await UserFactory.create();
    const bob = await UserFactory.create();
    await createTenant("acme", alice);
    await createTenant("globex", bob);

    (await app.actingAs(alice).get("/customers", { Host: "globex.localhost" })).assertForbidden();
    (await app.actingAs(alice).get("/customers", { "X-Tenant": "globex" })).assertForbidden();
  });

  test("without a tenant there are no customers to see", async () => {
    const alice = await UserFactory.create();
    await createTenant("acme", alice);

    (await app.actingAs(alice).get("/customers")).assertNotFound();
    (await app.actingAs(alice).get("/customers", { Host: "nobody.localhost" })).assertNotFound();
  });
});
```

What each part relies on:

- **The first test is the one the recipe exists for.** It writes a row as one tenant,
  reads as another, and asserts a count of zero. Checking that one particular row is
  missing would pass a query that returned everything else.
- **`Tenant.run(tenant, fn)`** opens a tenant for the length of `fn`. A test is not a
  request, so nothing is resolved for it: test data is created and read inside a tenant.
- **A `Host` header** is all a request needs to arrive on a subdomain. The test app sends
  it, and the resolver reads the host off the request as it would in production.
- **The refusal test** names a real tenant the user is not in, once by subdomain and once
  by header. Both must be refused, because both come from the client.
- **The `afterEach`** fails the test that leaks a tenant, rather than the unrelated one
  that runs after it.

Make sure the tests can fail. Change `Customer` to extend plain `Model` instead of
`Model.using(Tenantable)` and run the file:

```
…
SQLiteError: NOT NULL constraint failed: customers.tenant_id
(fail) customers > a tenant cannot read another tenant's customers
…
error: Expected HTTP 201 but got 500.
(fail) customers > a new customer belongs to the tenant it was created in
…
```

Without `Tenantable` nothing stamps the tenant, and the `NOT NULL` column refuses the row.
Put it back.

## Run it

```bash
# in your project root
bun zt test tests/customers.test.ts
```

Run the whole suite with `--isolate`, which gives every test file a process of its own:

```bash
# in your project root
bun zt test --isolate
```

Without it, the test files share one app, booted once for the first file that asks.
`Tenantable` wires its scope into the app as it boots, and in 1.18 that wiring does not
carry over to the files that reuse the booted app, so the customer tests fail whenever
another file runs first. Make `--isolate` the default for `bun run test`, which the
starter's CI workflow runs:

```json
// package.json
"test": "bun zt.ts test --isolate",
```

Then in the browser: with `bun zt dev` running, open `http://acme.localhost:3000/login`
and sign in as `demo@example.com`. Browsers generally send any `*.localhost` name to your
own machine; if yours does not, add `acme.localhost` and `globex.localhost` to your hosts
file. `http://acme.localhost:3000/customers` answers with Acme's one customer:

```
{"tenant":"acme","customers":[{"id":1,"name":"Road Runner","email":"rr@acme.test"}]}
```

A browser keeps a separate sign-in for each host. Sign in on `globex.localhost:3000` and
every page answers 403, because the demo account is not in Globex. On `localhost:3000`,
with no tenant, `/customers` answers 404 and the rest of the app works as before.

## See also

- [Multi-Tenancy](/docs/tenancy) — every resolver, `Tenantable`, the `Tenant` facade,
  tenant-scoped storage and cache, and the database-per-tenant strategy.
- [Custom resolver](/docs/tenancy#custom-resolver) — a tenant from somewhere else, such as
  a cookie.
- [Teams](/docs/tutorial/multi-tenancy) — the tenant taken from the signed-in user, end
  to end.
- [Seeding](/docs/seeding) — seeders and `db:seed`.
- [Testing](/docs/testing) — `bootApp()`-style feature tests and `refreshDatabase()`.
