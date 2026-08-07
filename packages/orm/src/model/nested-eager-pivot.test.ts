/**
 * Nested eager loads through a `manyToMany` that carries pivot data.
 *
 * With `withPivot`, each (parent, related) pair gets its own copy of the related model so
 * it can hold that pair's pivot row. The loader attached the copies to parents but returned
 * the *originals* for the nested pass — so `with("roles.perms")` loaded `perms` onto objects
 * nobody held, and reading it off the attached copy gave `undefined`. Not
 * `RelationNotLoadedError`: the copy was built with `Object.assign`, which drops the
 * non-enumerable guard accessors, so there was nothing left to raise it.
 *
 * Removing `withPivot` made the same query work, which is the tell.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { manyToMany } from "./decorators/manyToMany.ts";
import { hasMany } from "./decorators/hasMany.ts";
import { table } from "./decorators/table.ts";
import { RelationNotLoadedError } from "../errors/index.ts";
import type { ManyToMany, HasMany } from "./relations/RelationRegistry.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bun.SQL has no exported type
let db: any;

@table("permissions")
class Permission extends BaseModel {
  roleId!: number;
  name!: string;
}

@table("roles")
class Role extends BaseModel {
  name!: string;
  @hasMany(() => Permission, { foreignKey: "role_id" }) perms!: HasMany<Permission>;
}

@table("users")
class User extends BaseModel {
  name!: string;
  @manyToMany(() => Role, {
    pivotTable: "role_user",
    pivotForeignKey: "user_id",
    pivotRelatedKey: "role_id",
    withPivot: ["granted_by"],
  })
  roles!: ManyToMany<Role>;
}

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE permissions (id INTEGER PRIMARY KEY, role_id INTEGER, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE role_user (id INTEGER PRIMARY KEY, user_id INTEGER, role_id INTEGER, granted_by TEXT)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  for (const t of ["role_user", "permissions", "roles", "users"]) await db`DELETE FROM ${db(t)}`;
  await db`INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Bo')`;
  await db`INSERT INTO roles (id, name) VALUES (10, 'admin'), (20, 'editor')`;
  await db`INSERT INTO permissions (id, role_id, name) VALUES (100, 10, 'users.write'), (101, 10, 'users.read'), (102, 20, 'posts.write')`;
  await db`INSERT INTO role_user (user_id, role_id, granted_by) VALUES (1, 10, 'root'), (1, 20, 'root'), (2, 10, 'ada')`;
});

describe("with('roles.perms') through a pivot-hydrated relation", () => {
  it("loads the nested relation onto the objects the parent actually holds", async () => {
    const users = await User.query().with("roles.perms").orderBy("id").get();

    const ada = users[0]!;
    expect(ada.roles).toHaveLength(2);

    const admin = ada.roles.find((r) => r.name === "admin")!;
    expect(admin.perms).toBeDefined();
    expect(admin.perms.map((p) => p.name).sort()).toEqual(["users.read", "users.write"]);

    const editor = ada.roles.find((r) => r.name === "editor")!;
    expect(editor.perms.map((p) => p.name)).toEqual(["posts.write"]);
  });

  it("still carries the pivot data that made the copy necessary", async () => {
    const users = await User.query().with("roles.perms").orderBy("id").get();
    const pivots = users[0]!.roles.map(
      (r) => (r as unknown as { pivot: Record<string, unknown> }).pivot["granted_by"],
    );
    expect(pivots).toEqual(["root", "root"]);
  });

  it("gives each parent its own copy, so pivot rows do not bleed across users", async () => {
    const users = await User.query().with("roles").orderBy("id").get();
    const adaAdmin = users[0]!.roles.find((r) => r.name === "admin")!;
    const boAdmin = users[1]!.roles.find((r) => r.name === "admin")!;

    expect((adaAdmin as unknown as { pivot: Record<string, unknown> }).pivot["granted_by"]).toBe(
      "root",
    );
    expect((boAdmin as unknown as { pivot: Record<string, unknown> }).pivot["granted_by"]).toBe(
      "ada",
    );
  });

  it("raises RelationNotLoadedError for a relation that was not loaded", async () => {
    // The copy is built from own property *descriptors* now, so it keeps the
    // non-enumerable lazy-load guards. Object.assign dropped them, turning a missing
    // relation into a silent `undefined`.
    const users = await User.query().with("roles").orderBy("id").get();
    const role = users[0]!.roles[0]!;
    expect(() => role.perms.length).toThrow(RelationNotLoadedError);
  });
});
