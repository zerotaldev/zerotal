import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import {
  BaseModel,
  table,
  column,
  registerConnectionResolver,
  _setBaseModelConnection,
  _setDbConnection,
  type SQLInstance,
} from "@zerotal/orm";
import { TenantContext } from "./TenantContext.ts";
import { TenantModel } from "./TenantModel.ts";
import { TenantManager } from "./TenantManager.ts";
import type { MultiDbTenant, Tenant } from "./types.ts";

// A plain, tenant-agnostic model — in the multi-database strategy it is NOT `Tenantable`
// (no `tenant_id` scoping); isolation comes entirely from the connection it runs on.
@table("projects")
class Project extends BaseModel {
  @column() name!: string;
}

let central: any;
const dbs = new Map<number, SQLInstance>();

const tenant = (id: number, slug: string, database: string): MultiDbTenant => ({
  id,
  slug,
  name: slug,
  isActive: true,
  database,
});

const acme = tenant(1, "acme", "acme.db");
const globex = tenant(2, "globex", "globex.db");

beforeAll(async () => {
  // Central/platform DB — owns the tenant registry, set as the default connection.
  central = new SQL(":memory:");
  _setBaseModelConnection(central);
  _setDbConnection(central);
  await central`CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT, is_active INTEGER, database TEXT, created_at TEXT, updated_at TEXT)`;

  // One isolated database per tenant, each with its own projects.
  for (const t of [acme, globex]) {
    const conn = new SQL(":memory:");
    await conn`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
    await conn`INSERT INTO projects (name) VALUES (${`${t.slug}-only`})`;
    dbs.set(t.id, conn as unknown as SQLInstance);
  }

  // The exact wiring TenancyProvider installs for the multi-database strategy.
  const manager = new TenantManager({ connect: (t) => dbs.get(t.id)! });
  registerConnectionResolver((ModelClass) => {
    if (ModelClass === TenantModel) return null; // registry stays on central
    const active = TenantContext.tryGet();
    return active ? manager.connectionFor(active as MultiDbTenant) : null;
  });
});

afterAll(async () => {
  registerConnectionResolver(null);
  _setBaseModelConnection(null);
  _setDbConnection(null);
  await central.end();
  for (const conn of dbs.values()) await (conn as unknown as { end(): Promise<void> }).end();
});

describe("multi-database — seamless connection routing", () => {
  it("routes a plain model's queries to the active tenant's database", async () => {
    const a = await TenantContext.run(acme as Tenant, () => Project.query().get());
    expect(a.map((p) => p.name)).toEqual(["acme-only"]);

    const b = await TenantContext.run(globex as Tenant, () => Project.query().get());
    expect(b.map((p) => p.name)).toEqual(["globex-only"]);
  });

  it("create() writes into the active tenant's database only", async () => {
    await TenantContext.run(acme as Tenant, () => Project.create({ name: "acme-new" } as never));

    const a = await TenantContext.run(acme as Tenant, () => Project.query().get());
    expect(a.map((p) => p.name).sort()).toEqual(["acme-new", "acme-only"]);

    // globex is untouched — proof of isolation.
    const b = await TenantContext.run(globex as Tenant, () => Project.query().get());
    expect(b.map((p) => p.name)).toEqual(["globex-only"]);
  });

  it("keeps the tenant registry (TenantModel) on the central database", async () => {
    await TenantModel.create({
      slug: "acme",
      name: "Acme",
      isActive: true,
      database: "acme.db",
    } as never);

    // Even while a tenant is active, TenantModel resolves against central — not the tenant DB.
    const found = await TenantContext.run(acme as Tenant, () =>
      TenantModel.query().where("slug", "acme").first(),
    );
    expect(found?.name).toBe("Acme");

    // And the central DB has no projects table at all (queries there would fail), proving
    // Project never hit central while a tenant was active.
    const onCentral =
      await central`SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`;
    expect(onCentral.length).toBe(0);
  });

  it("falls back to the central connection outside any tenant boundary", async () => {
    // No active tenant → resolver returns null → default (central) connection is used.
    const count = await TenantModel.query().count();
    expect(typeof count).toBe("number");
  });
});
