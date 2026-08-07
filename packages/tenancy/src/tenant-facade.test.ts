import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import {
  BaseModel,
  table,
  column,
  DB,
  _setBaseModelConnection,
  _setDbConnection,
} from "@zerotal/orm";
import { RequestContext } from "@zerotal/core";
import { Tenancy } from "./Tenancy.ts";
import { TenantModel } from "./TenantModel.ts";
import { TenantContext } from "./TenantContext.ts";
import { TenantForbiddenError, NoActiveTenantError } from "./errors.ts";
import type { Tenant } from "./types.ts";

// Brand a User model the way @zerotal/auth would, so Tenancy can resolve it for
// membership hydration without a hard dependency on the auth package.
const AUTHENTICATABLE = Symbol.for("zerotal.auth.authenticatable");

@table("users")
class User extends BaseModel {
  @column() name!: string;
}
(User as unknown as Record<symbol, unknown>)[AUTHENTICATABLE] = true;

const tenancy = new Tenancy();

let db: any;

/** Run `cb` with `tenant` active and (optionally) `userId` authenticated. */
function as<T>(tenant: Tenant, userId: number | null, cb: () => T | Promise<T>): Promise<T> {
  return TenantContext.run(tenant, () =>
    userId == null
      ? Promise.resolve(cb())
      : RequestContext.run({ user: { id: userId } } as never, () => Promise.resolve(cb())),
  );
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);
  await db`CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT, is_active INTEGER, database TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE tenant_members (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, user_id INTEGER, is_admin INTEGER, created_at TEXT)`;
  await db`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  _setDbConnection(null);
  await db.end();
});

beforeEach(async () => {
  for (const t of ["tenants", "tenant_members", "users"]) await db`DELETE FROM ${db(t)}`;
  await db`DELETE FROM sqlite_sequence`;
});

describe("Tenancy — current tenant", () => {
  it("current()/check()/id() are null/false outside a tenant boundary", () => {
    expect(tenancy.current()).toBeNull();
    expect(tenancy.check()).toBe(false);
    expect(tenancy.id()).toBeNull();
  });

  it("check() reflects the active tenant's isActive", async () => {
    const active = await TenantModel.create({ slug: "a", name: "A", isActive: true } as never);
    const off = await TenantModel.create({ slug: "b", name: "B", isActive: false } as never);
    expect(tenancy.run(active as unknown as Tenant, () => tenancy.check())).toBe(true);
    expect(tenancy.run(off as unknown as Tenant, () => tenancy.check())).toBe(false);
  });
});

describe("Tenancy — create enrolls the creator as admin", () => {
  it("creates a tenant and makes the authenticated user its first admin", async () => {
    await User.create({ name: "Ada" });
    const tenant = await RequestContext.run({ user: { id: 1 } } as never, () =>
      tenancy.create({ slug: "acme", name: "Acme" }),
    );
    expect(tenant.slug).toBe("acme");
    expect(tenant.isActive).toBe(true);

    await as(tenant as unknown as Tenant, 1, async () => {
      expect(await tenancy.isMember()).toBe(true);
      expect(await tenancy.isMemberAdmin()).toBe(true);
    });
  });

  it("create without an authenticated user enrolls no one", async () => {
    const tenant = await tenancy.create({ slug: "solo", name: "Solo" });
    await as(tenant as unknown as Tenant, null, async () => {
      expect(await tenancy.memberCount()).toBe(0);
    });
  });
});

describe("Tenancy — membership", () => {
  it("adds members, hydrates Users, and distinguishes admins", async () => {
    const u1 = await User.create({ name: "One" });
    const u2 = await User.create({ name: "Two" });
    const tenant = (await TenantModel.create({
      slug: "t",
      name: "T",
      isActive: true,
    } as never)) as unknown as Tenant;

    await as(tenant, u1.id, async () => {
      await tenancy.addMember(u1.id, { admin: true });
      await tenancy.addMember(u2.id);

      expect(await tenancy.memberCount()).toBe(2);
      expect(await tenancy.isMemberAdmin(u1.id)).toBe(true);
      expect(await tenancy.isMemberAdmin(u2.id)).toBe(false);

      const members = (await tenancy.members<User>()).map((m) => m.name).sort();
      expect(members).toEqual(["One", "Two"]);

      const me = await tenancy.member<User>();
      expect(me?.name).toBe("One"); // current authenticated user (u1)
    });
  });

  it("promote/demote/removeMember work", async () => {
    const u = await User.create({ name: "P" });
    const tenant = (await TenantModel.create({
      slug: "p",
      name: "P",
      isActive: true,
    } as never)) as unknown as Tenant;
    await as(tenant, u.id, async () => {
      await tenancy.addMember(u.id);
      expect(await tenancy.isMemberAdmin(u.id)).toBe(false);
      await tenancy.promote(u.id);
      expect(await tenancy.isMemberAdmin(u.id)).toBe(true);
      await tenancy.demote(u.id);
      expect(await tenancy.isMemberAdmin(u.id)).toBe(false);
      await tenancy.removeMember(u.id);
      expect(await tenancy.isMember(u.id)).toBe(false);
    });
  });
});

describe("Tenancy — admin-gated update/delete", () => {
  it("update() requires admin; forceUpdate() bypasses", async () => {
    const admin = await User.create({ name: "Admin" });
    const plain = await User.create({ name: "Plain" });
    const tenant = (await TenantModel.create({
      slug: "g",
      name: "Old",
      isActive: true,
    } as never)) as unknown as Tenant;
    await DB.table("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: admin.id,
      is_admin: 1,
    });
    await DB.table("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: plain.id,
      is_admin: 0,
    });

    // Non-admin is rejected.
    await expect(
      as(tenant, plain.id, () => tenancy.update({ name: "Nope" })),
    ).rejects.toBeInstanceOf(TenantForbiddenError);

    // Admin succeeds.
    await as(tenant, admin.id, () => tenancy.update({ name: "New" }));
    expect((await TenantModel.find(tenant.id))!.name).toBe("New");

    // forceUpdate bypasses the check.
    await as(tenant, plain.id, () => tenancy.forceUpdate({ name: "Forced" }));
    expect((await TenantModel.find(tenant.id))!.name).toBe("Forced");
  });

  it("delete() requires admin and removes the tenant + memberships + fires hook", async () => {
    const admin = await User.create({ name: "Admin" });
    const tenant = (await TenantModel.create({
      slug: "d",
      name: "D",
      isActive: true,
    } as never)) as unknown as Tenant;
    await DB.table("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: admin.id,
      is_admin: 1,
    });

    let hooked: Tenant | null = null;
    tenancy.onTenantDeleted((t) => {
      hooked = t;
    });

    await as(tenant, admin.id, () => tenancy.delete());

    expect(await TenantModel.find(tenant.id)).toBeNull();
    expect(await DB.table("tenant_members").where("tenant_id", tenant.id).count()).toBe(0);
    expect(hooked).not.toBeNull();
  });
});

describe("Tenancy — reads + run", () => {
  it("find / findById / exists / all", async () => {
    const t = await TenantModel.create({ slug: "x", name: "X", isActive: true } as never);
    expect((await tenancy.find("x"))?.name).toBe("X");
    expect((await tenancy.findById(t.id))?.name).toBe("X");
    expect(await tenancy.exists("x")).toBe(true);
    expect(await tenancy.exists("nope")).toBe(false);
    expect(await tenancy.all()).toHaveLength(1);
  });

  it("forId runs work inside the tenant's context", async () => {
    const t = await TenantModel.create({ slug: "ctx", name: "Ctx", isActive: true } as never);
    const slug = await tenancy.forId(t.id, () => tenancy.slug());
    expect(slug).toBe("ctx");
  });

  it("requireCurrent-backed methods throw outside a boundary", async () => {
    await expect(tenancy.memberCount()).rejects.toBeInstanceOf(NoActiveTenantError);
  });
});
