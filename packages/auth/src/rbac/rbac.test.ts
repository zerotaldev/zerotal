import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, table, column, _setBaseModelConnection, _setDbConnection } from "@zerotal/orm";
import { Role } from "./Role.ts";
import { Permission } from "./Permission.ts";
import { Roles } from "./Roles.ts";
import { Permissions } from "./Permissions.ts";
import { rbacSchemaConcern } from "../rbacSchemaConcern.ts";

// Canonical composition: roles + direct permissions.
class User extends Roles(Permissions(BaseModel)) {
  static override table = "users";
  name!: string;
}

let db: any;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  _setDbConnection(db);
  await db`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, guard TEXT, label TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, guard TEXT, label TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER)`;
  await db`CREATE TABLE model_roles (role_id INTEGER, model_id INTEGER, model_type TEXT)`;
  await db`CREATE TABLE model_permissions (permission_id INTEGER, model_id INTEGER, model_type TEXT)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  _setDbConnection(null);
  await db.end();
});

beforeEach(async () => {
  for (const t of [
    "users",
    "roles",
    "permissions",
    "role_permissions",
    "model_roles",
    "model_permissions",
  ]) {
    await db`DELETE FROM ${db(t)}`;
  }
  await db`DELETE FROM sqlite_sequence`;
  // Clear the process-level name→id caches; otherwise they survive the table
  // truncation above and hand back stale ids whose rows no longer exist.
  Role.clearCache();
  Permission.clearCache();
});

describe("Roles — roles", () => {
  it("assigns / removes roles and resolves names", async () => {
    const u = await User.create({ name: "Al" } as never);
    await u.assignRole("editor", "viewer");
    expect(u.getRoleNames().sort()).toEqual(["editor", "viewer"]);
    expect(u.hasRole("editor")).toBe(true);
    expect(u.hasAnyRole(["nope", "viewer"])).toBe(true);
    expect(u.hasAllRoles(["editor", "viewer"])).toBe(true);
    await u.removeRole("viewer");
    expect(u.hasRole("viewer")).toBe(false);
  });

  it("Role.resolve is idempotent (no duplicate rows)", async () => {
    const a = await Role.resolve("editor");
    const b = await Role.resolve("editor");
    expect(a.id).toBe(b.id);
  });

  it("syncRoles replaces the whole set", async () => {
    const u = await User.create({ name: "Al" } as never);
    await u.assignRole("a", "b");
    await u.syncRoles(["c"]);
    expect(u.getRoleNames()).toEqual(["c"]);
  });
});

describe("Roles + Permissions — effective permissions", () => {
  it("resolves the union of direct + via-role permissions", async () => {
    const u = await User.create({ name: "Al" } as never);
    const editor = await Role.resolve("editor");
    await editor.givePermissionTo("post.create", "post.update");
    await u.assignRole("editor");
    await u.givePermissionTo("comment.delete"); // direct grant

    expect(u.getAllPermissions().sort()).toEqual(["comment.delete", "post.create", "post.update"]);
    expect(u.hasPermissionTo("post.create")).toBe(true); // via role
    expect(u.hasPermissionTo("comment.delete")).toBe(true); // direct
    expect(u.can("post.update")).toBe(true);
    expect(u.can("user.delete")).toBe(false);
  });

  it("supports segment + global wildcards", async () => {
    const admin = await Role.resolve("admin");
    await admin.givePermissionTo("post.*");
    const u = await User.create({ name: "Ed" } as never);
    await u.assignRole("admin");
    expect(u.can("post.create")).toBe(true);
    expect(u.can("post.delete")).toBe(true);
    expect(u.can("user.create")).toBe(false);

    const su = await Role.resolve("super");
    await su.givePermissionTo("*");
    const root = await User.create({ name: "Root" } as never);
    await root.assignRole("super");
    expect(root.can("anything.goes")).toBe(true);
  });

  it("role.syncPermissions / revoke work", async () => {
    const r = await Role.resolve("editor");
    await r.givePermissionTo("a", "b", "c");
    await r.revokePermissionTo("b");
    expect((await r.permissionNames()).sort()).toEqual(["a", "c"]);
    await r.syncPermissions(["x"]);
    expect(await r.permissionNames()).toEqual(["x"]);
  });
});

describe("Composition matrix — each mixin works alone and composed", () => {
  it("Roles alone: can() reflects role-derived permissions only", async () => {
    class RoleOnly extends Roles(BaseModel) {
      static override table = "users";
      name!: string;
    }
    const editor = await Role.resolve("editor");
    await editor.givePermissionTo("post.create");
    const u = await RoleOnly.create({ name: "R" } as never);
    await u.assignRole("editor");

    expect(u.hasRole("editor")).toBe(true);
    expect(u.can("post.create")).toBe(true); // via role
    expect(u.can("comment.delete")).toBe(false);
    // No direct-permission API on this model.
    expect((u as unknown as { givePermissionTo?: unknown }).givePermissionTo).toBeUndefined();
  });

  it("Permissions alone: can() reflects direct permissions only", async () => {
    class PermOnly extends Permissions(BaseModel) {
      static override table = "users";
      name!: string;
    }
    const u = await PermOnly.create({ name: "P" } as never);
    await u.givePermissionTo("comment.delete", "post.*");

    expect(u.can("comment.delete")).toBe(true);
    expect(u.can("post.edit")).toBe(true); // wildcard
    expect(u.can("user.delete")).toBe(false);
    // No role API on this model.
    expect((u as unknown as { assignRole?: unknown }).assignRole).toBeUndefined();
  });

  it("order-independent: Permissions(Roles(Base)) behaves identically", async () => {
    class Flipped extends Permissions(Roles(BaseModel)) {
      static override table = "users";
      name!: string;
    }
    const editor = await Role.resolve("editor");
    await editor.givePermissionTo("post.create");
    const u = await Flipped.create({ name: "F" } as never);
    await u.assignRole("editor");
    await u.givePermissionTo("comment.delete");

    expect(u.getAllPermissions().sort()).toEqual(["comment.delete", "post.create"]);
    expect(u.can("post.create")).toBe(true);
    expect(u.can("comment.delete")).toBe(true);
  });
});

describe("Default eager loading", () => {
  const isLoaded = (o: object, rel: string) => {
    const d = Object.getOwnPropertyDescriptor(o, rel);
    return !!d && typeof d.get !== "function";
  };

  it("eager-loads roles by default and resolves checks from memory", async () => {
    const editor = await Role.resolve("editor");
    await editor.givePermissionTo("post.create");
    const created = await User.create({ name: "Al" } as never);
    await created.assignRole("editor");

    const u = (await User.query().where("id", created.id).first()) as any;
    expect(isLoaded(u, "roles")).toBe(true); // auto eager-loaded
    expect((u.roles as { name: string }[]).map((r) => r.name)).toEqual(["editor"]);
    expect(u.can("post.create")).toBe(true); // direct OR via role
    expect(u.getRoleNames()).toEqual(["editor"]);
  });

  it("static withRoles=false / withPermissions=false opts out", async () => {
    class PlainUser extends Roles(Permissions(BaseModel)) {
      static override table = "users";
      static withRoles = false;
      static withPermissions = false;
      name!: string;
    }
    const created = await PlainUser.create({ name: "X" } as never);

    const u = (await PlainUser.query().where("id", created.id).first()) as any;
    expect(isLoaded(u, "roles")).toBe(false); // NOT eager-loaded
    // checks still work (fall back to a query)
    await u.assignRole("viewer");
    expect(u.hasRole("viewer")).toBe(true);
  });
});

describe("rbacSchemaConcern — provisions the RBAC pivots on boot", () => {
  it("creates model_roles / role_permissions / model_permissions for composing models", async () => {
    // A registered (modelsByName) model that composes both mixins — what the concern detects.
    @table("rbac_probe")
    class Probe extends Roles(Permissions(BaseModel)) {
      @column() name!: string;
    }
    void Probe;

    await db`DROP TABLE model_roles`;
    await db`DROP TABLE role_permissions`;
    await db`DROP TABLE model_permissions`;

    await rbacSchemaConcern.run!({} as never);

    const names = (await db`SELECT name FROM sqlite_master WHERE type='table'`).map(
      (r: { name: string }) => r.name,
    );
    expect(names).toContain("model_roles");
    expect(names).toContain("role_permissions");
    expect(names).toContain("model_permissions");
  });
});
