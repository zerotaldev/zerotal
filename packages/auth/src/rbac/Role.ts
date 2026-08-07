import { BaseModel, column, table, manyToMany, DB, type ManyToMany } from "@zerotal/orm";
import { Permission } from "./Permission.ts";

/**
 * A role groups permissions and is assigned to models (users) via the
 * polymorphic `model_roles` pivot. Roles own permissions through the
 * `role_permissions` pivot.
 */
@table("roles")
export class Role extends BaseModel {
  @column() name!: string;
  @column() guard!: string;
  /** Display name. Optional, so `resolve()` can create a role from a name alone. */
  @column({ nullable: true }) label?: string | null;

  @manyToMany(() => Permission, {
    pivotTable: "role_permissions",
    pivotForeignKey: "role_id",
    pivotRelatedKey: "permission_id",
  })
  permissions!: ManyToMany<Permission>;

  /** Process-level name→id catalog cache (avoids re-querying during bulk ops). */
  private static _idCache = new Map<string, number>();
  /** @internal — clear the resolve cache (tests / after destructive changes). */
  static clearCache(): void {
    Role._idCache.clear();
  }

  /** Find an existing role by name (+ guard) or create it. */
  static async resolve(name: string, guard = "web"): Promise<Role> {
    const found = await Role.query().where("name", name).where("guard", guard).first<Role>();
    const row = found ?? ((await Role.forceCreate({ name, guard })) as Role);
    Role._idCache.set(`${guard}\0${name}`, Number(row.id));
    return row;
  }

  /** Resolve a name (+ guard) to a role id, cached. Creates if missing. */
  static async resolveId(name: string, guard = "web"): Promise<number> {
    const key = `${guard}\0${name}`;
    const cached = Role._idCache.get(key);
    if (cached !== undefined) return cached;
    const found = await Role.query().where("name", name).where("guard", guard).first<Role>();
    const id = found ? Number(found.id) : Number((await Role.forceCreate({ name, guard })).id);
    Role._idCache.set(key, id);
    return id;
  }

  /** Resolve a mixed list of names / ids / instances to role ids. */
  static async idsFor(items: (string | number | Role)[], guard = "web"): Promise<number[]> {
    const ids: number[] = [];
    for (const it of items) {
      if (typeof it === "number") ids.push(it);
      else if (typeof it === "string") ids.push(await Role.resolveId(it, guard));
      else ids.push(Number(it.id));
    }
    return ids;
  }

  // ── Permission management ─────────────────────────────────────────────────────

  /** Grant one or more permissions to this role (names are created if missing). */
  async givePermissionTo(...permissions: (string | number | Permission)[]): Promise<this> {
    const ids = await Permission.idsFor(permissions.flat() as never, this.guard ?? "web");
    for (const pid of ids) {
      const exists = await DB.table("role_permissions")
        .where("role_id", this.id)
        .where("permission_id", pid)
        .first();
      if (!exists)
        await DB.table("role_permissions").insert({ role_id: this.id, permission_id: pid });
    }
    return this;
  }

  /** Revoke one or more permissions from this role. */
  async revokePermissionTo(...permissions: (string | number | Permission)[]): Promise<this> {
    const ids = await Permission.idsFor(permissions.flat() as never, this.guard ?? "web");
    if (ids.length)
      await DB.table("role_permissions")
        .where("role_id", this.id)
        .whereIn("permission_id", ids)
        .delete();
    return this;
  }

  /** Replace this role's permissions with exactly the given set. */
  async syncPermissions(permissions: (string | number | Permission)[]): Promise<this> {
    await DB.table("role_permissions").where("role_id", this.id).delete();
    return this.givePermissionTo(...permissions);
  }

  /** Names of the permissions attached to this role. */
  async permissionNames(): Promise<string[]> {
    const rows = await DB.raw<{ name: string }>(
      `SELECT p.name AS name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [this.id],
    );
    return rows.map((r) => r.name);
  }

  /** Does this role include the given permission (exact match)? */
  async hasPermission(name: string): Promise<boolean> {
    return (await this.permissionNames()).includes(name);
  }
}
