import { BaseModel, column, table, DB } from "@zerotal/orm";

/**
 * A named permission (ability) — e.g. `post.create`, `user.delete`, or a
 * wildcard like `post.*`. Permissions are granted to roles (via the
 * `role_permissions` pivot) or directly to a model (via `model_permissions`).
 */
@table("permissions")
export class Permission extends BaseModel {
  @column() name!: string;
  @column() guard!: string;
  /** Display name. Optional, so `resolve()` can create a role from a name alone. */
  @column({ nullable: true }) label?: string | null;

  /** Process-level name→id catalog cache (avoids re-querying during bulk ops). */
  private static _idCache = new Map<string, number>();
  /** @internal — clear the resolve cache (tests / after destructive changes). */
  static clearCache(): void {
    Permission._idCache.clear();
  }

  /** Find an existing permission by name (+ guard) or create it. */
  static async resolve(name: string, guard = "web"): Promise<Permission> {
    const found = await Permission.query()
      .where("name", name)
      .where("guard", guard)
      .first<Permission>();
    const row = found ?? ((await Permission.forceCreate({ name, guard })) as Permission);
    Permission._idCache.set(`${guard}\0${name}`, Number(row.id));
    return row;
  }

  /** Resolve a name (+ guard) to a permission id, cached. Creates if missing. */
  static async resolveId(name: string, guard = "web"): Promise<number> {
    const key = `${guard}\0${name}`;
    const cached = Permission._idCache.get(key);
    if (cached !== undefined) return cached;
    const found = await Permission.query()
      .where("name", name)
      .where("guard", guard)
      .first<Permission>();
    const id = found
      ? Number(found.id)
      : Number((await Permission.forceCreate({ name, guard })).id);
    Permission._idCache.set(key, id);
    return id;
  }

  /** Resolve a mixed list of names / ids / instances to permission ids. */
  static async idsFor(items: (string | number | Permission)[], guard = "web"): Promise<number[]> {
    const ids: number[] = [];
    for (const it of items) {
      if (typeof it === "number") ids.push(it);
      else if (typeof it === "string") ids.push(await Permission.resolveId(it, guard));
      else ids.push(Number(it.id));
    }
    return ids;
  }
}

/** @internal Direct-grant pivot writes (model ⇄ permission), morph-aware. */
export async function _attachModelPermissions(
  modelType: string,
  modelId: unknown,
  permissionIds: number[],
): Promise<void> {
  for (const pid of permissionIds) {
    const exists = await DB.table("model_permissions")
      .where("model_type", modelType)
      .where("model_id", modelId)
      .where("permission_id", pid)
      .first();
    if (!exists)
      await DB.table("model_permissions").insert({
        permission_id: pid,
        model_type: modelType,
        model_id: modelId,
      });
  }
}
