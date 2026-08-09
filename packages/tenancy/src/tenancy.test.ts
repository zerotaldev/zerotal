import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Model, _setBaseModelConnection, _setDbConnection } from "@zerotal/orm";
import { TenantContext } from "./TenantContext.ts";
import { Tenantable, registerTenantScoping } from "./Tenantable.ts";
import { SubdomainResolver } from "./resolvers/SubdomainResolver.ts";
import { HeaderResolver } from "./resolvers/HeaderResolver.ts";
import { PathResolver } from "./resolvers/PathResolver.ts";
import { RouteParamResolver } from "./resolvers/RouteParamResolver.ts";
import { AuthResolver } from "./resolvers/AuthResolver.ts";
import { TenancyMiddleware } from "./TenancyMiddleware.ts";
import { EnsureTenancyMiddleware } from "./EnsureTenancyMiddleware.ts";
import { TenantNotFoundError } from "./errors.ts";
import { TenancyConfig } from "./config.ts";
import type { Tenant } from "./types.ts";
import type { HttpContext } from "@zerotal/core";

const tenant = (id: number, slug: string): Tenant => ({
  id,
  slug,
  name: `Tenant ${slug}`,
  isActive: true,
});
// Resolvers receive an HttpContext; these helpers build the minimal shape each reads.
const req = (url: string, headers: Record<string, string> = {}) =>
  ({ request: new Request(url, { headers }) }) as HttpContext;
const ctx = (parts: {
  url?: string;
  params?: Record<string, unknown>;
  user?: Record<string, unknown> | null;
}) =>
  ({
    request: new Request(parts.url ?? "https://x/"),
    params: parts.params ?? {},
    user: parts.user ?? undefined,
  }) as unknown as HttpContext;

describe("TenantContext — isolation", () => {
  it("throws when get() is called outside a tenant boundary", () => {
    expect(() => TenantContext.get()).toThrow(/No active tenant/);
  });

  it("tryGet/id/slug return null/undefined outside a context", () => {
    expect(TenantContext.tryGet()).toBeUndefined();
    expect(TenantContext.id()).toBeNull();
    expect(TenantContext.slug()).toBeNull();
  });

  it("exposes the active tenant inside run()", () => {
    const acme = tenant(1, "acme");
    TenantContext.run(acme, () => {
      expect(TenantContext.get()).toBe(acme);
      expect(TenantContext.id()).toBe(1);
      expect(TenantContext.slug()).toBe("acme");
    });
  });

  it("does not leak the tenant after run() returns", () => {
    TenantContext.run(tenant(1, "acme"), () => TenantContext.get());
    expect(TenantContext.tryGet()).toBeUndefined();
  });

  it("nested run() overrides then restores the outer tenant", () => {
    const outer = tenant(1, "acme");
    const inner = tenant(2, "globex");
    TenantContext.run(outer, () => {
      expect(TenantContext.id()).toBe(1);
      TenantContext.run(inner, () => expect(TenantContext.id()).toBe(2));
      expect(TenantContext.id()).toBe(1);
    });
  });

  it("keeps concurrent async contexts isolated from each other", async () => {
    const seen: number[] = [];
    const work = (t: Tenant, delay: number) =>
      TenantContext.run(t, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push(TenantContext.id()!); // must still be this context's tenant
        return TenantContext.id();
      });
    const [a, b] = await Promise.all([work(tenant(1, "acme"), 20), work(tenant(2, "globex"), 5)]);
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(seen.sort()).toEqual([1, 2]);
  });
});

describe("SubdomainResolver", () => {
  const r = new SubdomainResolver("myapp.com");
  it("extracts the leftmost-of-tenant subdomain", () => {
    expect(r.resolve(req("https://acme.myapp.com/"))?.identifier).toBe("acme");
  });
  it("takes the rightmost segment when extra subdomains precede it", () => {
    expect(r.resolve(req("https://www.acme.myapp.com/"))?.identifier).toBe("acme");
  });
  it("returns null for the base domain (no tenant) — isolation guard", () => {
    expect(r.resolve(req("https://myapp.com/"))).toBeNull();
  });
  it("returns null for an unrelated domain", () => {
    expect(r.resolve(req("https://acme.evil.com/"))).toBeNull();
  });
});

describe("HeaderResolver", () => {
  const r = new HeaderResolver("X-Tenant-ID");
  it("reads and trims the configured header", () => {
    expect(r.resolve(req("https://x/", { "X-Tenant-ID": "  acme  " }))?.identifier).toBe("acme");
  });
  it("returns null when the header is absent", () => {
    expect(r.resolve(req("https://x/"))).toBeNull();
  });
});

describe("PathResolver", () => {
  it("reads the first segment by default", () => {
    expect(new PathResolver().resolve(req("https://x/acme/dashboard"))?.identifier).toBe("acme");
  });
  it("honours a prefix + segment index", () => {
    const r = new PathResolver({ segment: 0, prefix: "/tenants" });
    expect(r.resolve(req("https://x/tenants/acme/settings"))?.identifier).toBe("acme");
  });
  it("returns null when the segment is missing", () => {
    expect(new PathResolver({ segment: 5 }).resolve(req("https://x/acme"))).toBeNull();
    expect(new PathResolver().resolve(req("https://x/"))).toBeNull();
  });
});

describe("RouteParamResolver", () => {
  it("reads the tenant slug from the named route param (default 'tenancy')", () => {
    const r = new RouteParamResolver();
    expect(r.resolve(ctx({ params: { tenancy: "acme" } }))).toEqual({
      identifier: "acme",
      by: "slug",
    });
  });
  it("honours a custom param name and trims", () => {
    const r = new RouteParamResolver({ param: "org" });
    expect(r.resolve(ctx({ params: { org: "  globex  " } }))?.identifier).toBe("globex");
  });
  it("returns null when the param is absent or blank", () => {
    expect(new RouteParamResolver().resolve(ctx({ params: {} }))).toBeNull();
    expect(new RouteParamResolver().resolve(ctx({ params: { tenancy: "" } }))).toBeNull();
  });
});

describe("AuthResolver", () => {
  it("resolves the tenant by id from the authed user's tenantId", () => {
    const r = new AuthResolver();
    expect(r.resolve(ctx({ user: { id: 1, tenantId: 7 } }))).toEqual({ identifier: 7, by: "id" });
  });
  it("honours a custom column", () => {
    const r = new AuthResolver({ column: "orgId" });
    expect(r.resolve(ctx({ user: { orgId: 42 } }))?.identifier).toBe(42);
  });
  it("returns null with no user or no tenant foreign key", () => {
    expect(new AuthResolver().resolve(ctx({ user: null }))).toBeNull();
    expect(new AuthResolver().resolve(ctx({ user: { id: 1 } }))).toBeNull();
  });
});

describe("TenancyConfig", () => {
  it("applies defaults for strategy and tenantColumn", () => {
    const c = TenancyConfig({ resolvers: [] });
    expect(c.strategy).toBe("single-database");
    expect(c.tenantColumn).toBe("tenant_id");
  });
  it("respects explicit overrides", () => {
    const c = TenancyConfig({
      strategy: "multi-database",
      tenantColumn: "org_id",
      resolvers: [],
    });
    expect(c.strategy).toBe("multi-database");
    expect(c.tenantColumn).toBe("org_id");
  });
});

// ── Middleware split: lenient resolver + strict gate ──────────────────────────

describe("TenancyMiddleware — lenient global resolution", () => {
  it("continues with no boundary when no resolver identifies a tenant", async () => {
    TenancyMiddleware.configure({
      strategy: "single-database",
      tenantColumn: "tenant_id",
      resolvers: [new RouteParamResolver({ param: "tenancy" })],
    });
    const mw = new TenancyMiddleware();
    const http = ctx({ params: {} });
    let inside: unknown = "unset";
    await mw.handle(http, async () => {
      inside = TenantContext.tryGet();
    });
    expect(inside).toBeUndefined(); // ran, but outside any tenant boundary
  });
});

describe("EnsureTenancyMiddleware — strict gate", () => {
  it("throws TenantNotFoundError when there is no active tenant", async () => {
    const mw = new EnsureTenancyMiddleware();
    await expect(mw.handle(ctx({}), async () => {})).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it("passes through when a tenant boundary is active", async () => {
    const mw = new EnsureTenancyMiddleware();
    let called = false;
    await TenantContext.run(tenant(1, "acme"), () =>
      mw.handle(ctx({}), async () => {
        called = true;
      }),
    );
    expect(called).toBe(true);
  });
});

// ── Tenantable mixin (scoping + injection) ────────────────────────────────────

class Project extends Model.using(Tenantable) {
  static override table = "projects";
  name!: string;
}
class Org extends Model.using(Tenantable) {
  static override table = "orgs";
  static tenantColumn = "org_id"; // override the FK column
  name!: string;
}

describe("Tenantable — scoping + injection", () => {
  let db: any;

  beforeAll(async () => {
    db = new SQL(":memory:");
    _setBaseModelConnection(db);
    _setDbConnection(db);
    await db`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tenant_id INTEGER, created_at TEXT, updated_at TEXT)`;
    await db`CREATE TABLE orgs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, org_id INTEGER, created_at TEXT, updated_at TEXT)`;
    registerTenantScoping(Project);
    registerTenantScoping(Org);
  });
  afterAll(async () => {
    _setBaseModelConnection(null);
    _setDbConnection(null);
    await db.end();
  });
  beforeEach(async () => {
    await db`DELETE FROM projects`;
    await db`DELETE FROM orgs`;
    await db`DELETE FROM sqlite_sequence`;
  });

  it("auto-injects the tenant column on create and scopes reads", async () => {
    await TenantContext.run(tenant(7, "acme"), async () => {
      await Project.create({ name: "A" } as never);
      await Project.create({ name: "B" } as never);
    });
    await TenantContext.run(tenant(9, "globex"), async () => {
      await Project.create({ name: "C" } as never);
    });

    const acme = await TenantContext.run(tenant(7, "acme"), () => Project.query().get());
    expect(acme.map((p) => p.name).sort()).toEqual(["A", "B"]);

    const globex = await TenantContext.run(tenant(9, "globex"), () => Project.query().get());
    expect(globex.map((p) => p.name)).toEqual(["C"]);
  });

  it("withoutTenancy() bypasses the tenant scope", async () => {
    await TenantContext.run(tenant(7, "acme"), () => Project.create({ name: "A" } as never));
    await TenantContext.run(tenant(9, "globex"), () => Project.create({ name: "C" } as never));
    const all = await Project.query().withoutTenancy().get();
    expect(all.length).toBe(2);
  });

  it("does not inject a tenant outside a tenant context", async () => {
    await Project.create({ name: "Z" } as never); // no active tenant
    const row = await db`SELECT tenant_id FROM projects WHERE name = 'Z'`;
    expect(row[0].tenant_id).toBeNull();
  });

  it("honours a static tenantColumn override", async () => {
    await TenantContext.run(tenant(3, "x"), () => Org.create({ name: "O" } as never));
    const row = await db`SELECT org_id FROM orgs WHERE name = 'O'`;
    expect(Number(row[0].org_id)).toBe(3);
  });
});
