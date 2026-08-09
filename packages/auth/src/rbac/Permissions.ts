// ── Permissions ─────────────────────────────────────────────────────────
//
// Relational, DB-backed *direct* permissions mixin. Apply to any model that should
// hold permissions granted to it directly (independent of roles):
//
//   export class ApiKey extends Model.using(Authenticatable, Permissions) {}
//   export class User extends Model.using(Authenticatable, Permissions, Roles) {}
//   // (the nested form Roles(Permissions(AuthUser)) still works too)
//
// Direct permissions are a polymorphic many-to-many (`model_permissions`), eager-
// loaded on every query via the `permissionsEagerLoad` global scope so `can()` is
// synchronous. Toggle with `static withPermissions = false`, or per query with
// `.withoutGlobalScope("permissionsEagerLoad")`.
//
// Writes (`givePermissionTo`, `revokePermissionTo`, `syncPermissions`) are async.
// When composed with `Roles`, the effective `can()` is the union of direct and
// role-derived permissions; the shared resolution lives in authz-core.

import { DB, relationRegistry, type ManyToMany } from "@zerotal/orm";
import { Permission } from "./Permission.ts";
import {
  _authzMemo,
  _effectivePermissions,
  _granted,
  _guardOf,
  _loaded,
  _morphId,
  _morphType,
  _notLoaded,
} from "./authz-core.ts";

const _permissionRelated = () => Permission;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
type Constructor<T = object> = new (...args: any[]) => T;

/** Brand marking a model (or an ancestor) as composing the `Permissions` mixin. */
export const PERMISSIONS_MIXIN: unique symbol = Symbol.for("zerotal.auth.permissions");

/** True when the given model constructor composes `Permissions`. */
export function hasPermissionsMixin(model: unknown): boolean {
  return !!(model as Record<symbol, unknown> | undefined)?.[PERMISSIONS_MIXIN];
}

/**
 * Model mixin adding DB-backed **direct permissions** — abilities granted to a
 * model independently of any role.
 *
 * Direct permissions are a polymorphic many-to-many (`model_permissions`),
 * eager-loaded on every query via the `permissionsEagerLoad` global scope, so
 * {@link can} is **synchronous**. Writes ({@link givePermissionTo},
 * {@link revokePermissionTo}, {@link syncPermissions}) are async.
 *
 * @typeParam TBase - The model constructor being extended.
 * @param Base - The base model (or another mixin) to compose onto.
 * @returns A subclass of `Base` with the direct-permissions API mixed in.
 *
 * @remarks
 * When composed with {@link Roles}, the effective {@link can} is the union of
 * directly-granted and role-derived permissions (resolution lives in
 * `authz-core`). Both `.*` and `*` wildcards are honored. Disable eager-loading
 * with `static withPermissions = false`.
 *
 * @example
 * ```ts
 * import { Model, Authenticatable } from "@zerotal/orm";
 * import { Permissions, Roles } from "@zerotal/auth";
 *
 * export class User extends Model.using(Authenticatable, Permissions, Roles) {}
 *
 * const user = await User.find(1);
 * await user.givePermissionTo("post.publish");
 * user.can("post.publish"); // true — synchronous, direct or via a role
 * ```
 */
export function Permissions<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    /** Eager-load directly-granted permissions on every query. */
    static withPermissions = true;

    static {
      (this as unknown as Record<symbol, unknown>)[PERMISSIONS_MIXIN] = true;
      const cls = this as unknown as {
        addGlobalScope?: (name: string, cb: (qb: unknown) => void) => void;
      };
      cls.addGlobalScope?.("permissionsEagerLoad", (qb: unknown) => {
        const q = qb as { with(r: string[]): unknown; _ModelClass?: { withPermissions?: boolean } };
        if ((q._ModelClass ?? {}).withPermissions !== false) q.with(["permissions"]);
      });

      if (!relationRegistry.has(this)) relationRegistry.set(this, new Map());
      const fields = relationRegistry.get(this)!;
      if (!fields.has("permissions")) {
        fields.set("permissions", {
          type: "morphToMany",
          related: _permissionRelated,
          pivotTable: "model_permissions",
          pivotForeignKey: "model_id",
          pivotRelatedKey: "permission_id",
          pivotMorphType: "model_type",
          pivotMorphValue: this.name,
          foreignKey: "model_id",
          localKey: "id",
        });
      }
    }

    permissions!: ManyToMany<Permission>;

    // ── Direct permission grants (async writes) ───────────────────────────────
    async givePermissionTo(...permissions: (string | number | Permission)[]): Promise<this> {
      const ids = await Permission.idsFor(permissions.flat() as never, _guardOf(this));
      const type = _morphType(this),
        id = _morphId(this);
      for (const pid of ids) {
        const exists = await DB.table("model_permissions")
          .where("model_type", type)
          .where("model_id", id)
          .where("permission_id", pid)
          .first();
        if (!exists)
          await DB.table("model_permissions").insert({
            permission_id: pid,
            model_type: type,
            model_id: id,
          });
      }
      return this._refreshPermissions();
    }

    async revokePermissionTo(...permissions: (string | number | Permission)[]): Promise<this> {
      const ids = await Permission.idsFor(permissions.flat() as never, _guardOf(this));
      if (ids.length)
        await DB.table("model_permissions")
          .where("model_type", _morphType(this))
          .where("model_id", _morphId(this))
          .whereIn("permission_id", ids)
          .delete();
      return this._refreshPermissions();
    }

    async syncPermissions(permissions: (string | number | Permission)[]): Promise<this> {
      await DB.table("model_permissions")
        .where("model_type", _morphType(this))
        .where("model_id", _morphId(this))
        .delete();
      const ids = await Permission.idsFor(permissions.flat() as never, _guardOf(this));
      const type = _morphType(this),
        id = _morphId(this);
      for (const pid of ids)
        await DB.table("model_permissions").insert({
          permission_id: pid,
          model_type: type,
          model_id: id,
        });
      return this._refreshPermissions();
    }

    /** @internal Re-read the direct-permission slice of the memo after a write. */
    /** @internal — public only because mixins can't expose private members. */
    async _refreshPermissions(): Promise<this> {
      const memo = _authzMemo(this);
      delete memo.directPerms;
      const self = this as unknown as Record<string, unknown>;
      if (_loaded(this, "permissions")) delete self["permissions"];
      // Warm every slice the model composed in (not just direct permissions), so a
      // later can() doesn't throw probing a never-loaded roles slice.
      return this.loadAuthorization();
    }

    /** Load the directly-granted permission set into the per-instance memo. */
    async loadPermissions(): Promise<this> {
      const t = _morphType(this),
        id = _morphId(this);
      const permRows = await DB.raw<{ name: string }>(
        `SELECT p.name AS name FROM permissions p
           JOIN model_permissions mp ON mp.permission_id = p.id
          WHERE mp.model_type = ? AND mp.model_id = ?`,
        [t, id],
      );
      _authzMemo(this).directPerms = new Set(permRows.map((r) => r.name));
      return this;
    }

    /** Directly-granted permission names. Read by `_effectivePermissions`. */
    getDirectPermissionNames(): string[] {
      const memo = _authzMemo(this);
      if (memo.directPerms) return [...memo.directPerms];
      if (_loaded(this, "permissions")) {
        const set = new Set((this.permissions as unknown as { name: string }[]).map((p) => p.name));
        memo.directPerms = set;
        return [...set];
      }
      throw _notLoaded();
    }

    // ── Effective authorization (shared; identical in Roles) ───────────────
    getAllPermissions(): string[] {
      return [..._effectivePermissions(this)];
    }
    /** True if the model has the ability directly or through a role (wildcard-aware). */
    hasPermissionTo(ability: string): boolean {
      return _granted(_effectivePermissions(this), ability);
    }
    /** Alias of {@link hasPermissionTo} — the canonical authorization check. */
    can(ability: string): boolean {
      return this.hasPermissionTo(ability);
    }
    /** Load whichever authorization slices this model composed in. */
    async loadAuthorization(): Promise<this> {
      const self = this as unknown as Record<string, unknown>;
      if (typeof self["loadRoles"] === "function")
        await (self["loadRoles"] as () => Promise<unknown>).call(this);
      if (typeof self["loadPermissions"] === "function")
        await (self["loadPermissions"] as () => Promise<unknown>).call(this);
      return this;
    }
  };
}
