/**
 * The tenant boundary as a security control, not just a query convenience.
 *
 * Every case here failed against the pre-fix implementation. The three defects share a
 * shape: the boundary was decided by whoever was talking to the server — the client named
 * the tenant and nothing checked it, the client named `tenant_id` in a payload and it
 * stuck, and no tenant at all meant no filter rather than no rows.
 *
 * Note this file runs under the repo-wide `unguard()` preload (see scripts/test-preload.ts).
 * That is deliberate: a tenant control that only holds while mass assignment is guarded is
 * not a tenant control, and the guard is off here to prove it does not need it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Model, _setBaseModelConnection, _setDbConnection } from "@zerotal/orm";
import { TenantContext } from "./TenantContext.ts";
import { Tenantable, registerTenantScoping } from "./Tenantable.ts";
import { TenancyMiddleware } from "./TenancyMiddleware.ts";
import { HeaderResolver } from "./resolvers/HeaderResolver.ts";
import { AuthResolver } from "./resolvers/AuthResolver.ts";
import { TenantForbiddenError } from "./errors.ts";
import type { Tenant } from "./types.ts";
import type { HttpContext } from "@zerotal/core";

class Project extends Model.using(Tenantable) {
  static override table = "projects";
  name!: string;
}

const tenant = (id: number, slug: string): Tenant => ({
  id,
  slug,
  name: `Tenant ${slug}`,
  isActive: true,
});

const ACME = tenant(1, "acme");
const VICTIM = tenant(2, "victim");

/** A request naming a tenant in a header, optionally from a signed-in user. */
function request(slug: string, userId?: number): HttpContext {
  return {
    request: new Request("https://app.test/api/projects", { headers: { "X-Tenant-ID": slug } }),
    params: {},
    user: userId === undefined ? undefined : { id: userId },
  } as unknown as HttpContext;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bun.SQL has no exported type
let db: any;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);
  await db`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tenant_id INTEGER, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE tenant_members (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, user_id INTEGER, is_admin INTEGER)`;
  registerTenantScoping(Project);
});

afterAll(async () => {
  _setBaseModelConnection(null);
  _setDbConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM projects`;
  await db`DELETE FROM tenants`;
  await db`DELETE FROM tenant_members`;
  await db`DELETE FROM sqlite_sequence`;
  await db`INSERT INTO tenants (id, slug, name, is_active) VALUES (1, 'acme', 'Acme', 1)`;
  await db`INSERT INTO tenants (id, slug, name, is_active) VALUES (2, 'victim', 'Victim', 1)`;
  // User 77 belongs to acme and nothing else.
  await db`INSERT INTO tenant_members (tenant_id, user_id, is_admin) VALUES (1, 77, 0)`;
});

describe("a client cannot choose its own tenant", () => {
  const mw = new TenancyMiddleware();

  beforeEach(() => {
    TenancyMiddleware.configure({
      strategy: "single-database",
      tenantColumn: "tenant_id",
      resolvers: [new HeaderResolver("X-Tenant-ID")],
    });
  });

  it("rejects a signed-in user naming a tenant they do not belong to", async () => {
    let entered = false;
    await expect(
      mw.handle(request("victim", 77), async () => {
        entered = true;
      }),
    ).rejects.toBeInstanceOf(TenantForbiddenError);
    expect(entered).toBe(false);
  });

  it("admits a signed-in user naming their own tenant", async () => {
    let seen: number | null = null;
    await mw.handle(request("acme", 77), async () => {
      seen = TenantContext.id();
    });
    expect(seen).toBe(1);
  });

  it("leaves anonymous requests alone — a public tenant surface has no membership", async () => {
    let seen: number | null = null;
    await mw.handle(request("victim"), async () => {
      seen = TenantContext.id();
    });
    expect(seen).toBe(2);
  });

  it("does not demand membership from a trusted resolver", async () => {
    // AuthResolver reads the tenant off the user's own record, so it is a tenant they
    // belong to by construction — checking membership would be circular, not safer.
    TenancyMiddleware.configure({
      strategy: "single-database",
      tenantColumn: "tenant_id",
      resolvers: [new AuthResolver()],
    });
    const ctx = {
      request: new Request("https://app.test/"),
      params: {},
      user: { id: 99, tenantId: 2 },
    } as unknown as HttpContext;

    let seen: number | null = null;
    await mw.handle(ctx, async () => {
      seen = TenantContext.id();
    });
    expect(seen).toBe(2);
  });
});

describe("the tenant column is server-authoritative", () => {
  it("a client-supplied tenant_id cannot redirect a write", async () => {
    await TenantContext.run(ACME, async () => {
      // The shape of `Project.create(request.all())` with a hostile payload.
      await Project.create({ name: "P", tenantId: VICTIM.id } as never);
    });

    const rows = await db`SELECT tenant_id FROM projects WHERE name = 'P'`;
    expect(Number(rows[0].tenant_id)).toBe(ACME.id);
  });

  it("still writes no tenant outside a boundary", async () => {
    await Project.create({ name: "Z" } as never);
    const rows = await db`SELECT tenant_id FROM projects WHERE name = 'Z'`;
    expect(rows[0].tenant_id).toBeNull();
  });
});

describe("no tenant context means no rows, not everyone's rows", () => {
  beforeEach(async () => {
    await TenantContext.run(ACME, () => Project.create({ name: "acme-1" } as never));
    await TenantContext.run(VICTIM, () => Project.create({ name: "victim-1" } as never));
  });

  it("reads return nothing outside a boundary", async () => {
    expect(await Project.query().get()).toEqual([]);
    expect(await Project.query().first()).toBeNull();
  });

  it("aggregates and writes are scoped out too, not left unfiltered", async () => {
    expect(await Project.query().count()).toBe(0);

    await Project.query().update({ name: "HACKED" } as never);
    const rows = await db`SELECT name FROM projects ORDER BY name`;
    expect(rows.map((r: { name: string }) => r.name)).toEqual(["acme-1", "victim-1"]);

    await Project.query().delete();
    const after = await db`SELECT COUNT(*) AS n FROM projects`;
    expect(Number(after[0].n)).toBe(2);
  });

  it("withoutTenancy() remains the deliberate way to reach across tenants", async () => {
    const all = await Project.query().withoutTenancy().get();
    expect(all.map((p) => p.name).sort()).toEqual(["acme-1", "victim-1"]);
  });
});
