// ── Roles ───────────────────────────────────────────────────────────────
//
// Relational, DB-backed roles mixin. Apply to any model that should carry roles:
//
//   export class User extends Model.using(Authenticatable, Roles) {}
//   export class User extends Model.using(Authenticatable, Permissions, Roles) {}
//   // (the nested form Roles(Permissions(AuthUser)) still works too)
//
// Roles are a polymorphic many-to-many (`model_roles`) and each role carries its
// own permissions (`role_permissions`). Every query eager-loads `roles.permissions`
// via the `rolesEagerLoad` global scope, so `hasRole()` / `can()` are synchronous
// and resolve from memory with no N+1. Toggle with `static withRoles = false`, or
// per query with `.withoutGlobalScope("rolesEagerLoad")`.
//
// Writes (`assignRole`, `removeRole`, `syncRoles`) are async and refresh the memo.
// The effective `can()` here covers permissions granted *through roles*; compose
// `Permissions` as well to also grant permissions directly.

import { DB, relationRegistry, type ManyToMany } from "@zerotal/orm";
import { Role } from "./Role.ts";
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

// Bun ≤ 1.x cannot parse decorator syntax inside class expressions returned from
// functions, so the relation is registered imperatively in the static block.
const _roleRelated = () => Role;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Brand marking a model (or an ancestor) as composing the `Roles` mixin.
 *
 * @internal
 */
export const ROLES_MIXIN: unique symbol = Symbol.for("zerotal.auth.roles");

/**
 * True when the given model constructor composes `Roles`.
 *
 * @internal
 */
export function hasRolesMixin(model: unknown): boolean {
  return !!(model as Record<symbol, unknown> | undefined)?.[ROLES_MIXIN];
}

/**
 * Model mixin adding DB-backed **roles** (and the permissions those roles carry).
 *
 * Roles are a polymorphic many-to-many (`model_roles`); each role owns permissions
 * (`role_permissions`). `roles.permissions` is eager-loaded on every query via the
 * `rolesEagerLoad` global scope, so the read checks ({@link hasRole}, {@link can})
 * are **synchronous** and hit no database. Writes ({@link assignRole},
 * {@link removeRole}, {@link syncRoles}) are async and refresh the per-instance memo.
 *
 * @typeParam TBase - The model constructor being extended.
 * @param Base - The base model (or another mixin) to compose onto.
 * @returns A subclass of `Base` with the roles API mixed in.
 *
 * @remarks
 * Compose {@link Permissions} alongside to also grant permissions directly to a
 * model; `can()` then answers over the union of role-derived and direct permissions.
 * Disable eager-loading with `static withRoles = false` (then call
 * `await user.loadAuthorization()` before a synchronous check).
 *
 * @example
 * ```ts
 * import { Model, Authenticatable } from "@zerotal/orm";
 * import { Roles } from "@zerotal/auth";
 *
 * export class User extends Model.using(Authenticatable, Roles) {}
 *
 * const user = await User.find(1);
 * await user.assignRole("editor");   // async write
 * user.hasRole("editor");            // true — synchronous
 * user.can("post.publish");          // permission carried by the role
 * ```
 */
export function Roles<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    /** Eager-load assigned roles (and each role's permissions) on every query. */
    static withRoles = true;

    static {
      (this as unknown as Record<symbol, unknown>)[ROLES_MIXIN] = true;
      const cls = this as unknown as {
        addGlobalScope?: (name: string, cb: (qb: unknown) => void) => void;
      };
      cls.addGlobalScope?.("rolesEagerLoad", (qb: unknown) => {
        const q = qb as { with(r: string[]): unknown; _ModelClass?: { withRoles?: boolean } };
        if ((q._ModelClass ?? {}).withRoles !== false) q.with(["roles.permissions"]);
      });

      // Register the polymorphic relation against this mixin class; ModelQueryBuilder
      // walks the prototype chain, so concrete subclasses (User, …) inherit it. The
      // morph type used at query/write time is derived from the concrete subclass,
      // so `pivotMorphValue` here is informational only.
      if (!relationRegistry.has(this)) relationRegistry.set(this, new Map());
      const fields = relationRegistry.get(this)!;
      if (!fields.has("roles")) {
        fields.set("roles", {
          type: "morphToMany",
          related: _roleRelated,
          pivotTable: "model_roles",
          pivotForeignKey: "model_id",
          pivotRelatedKey: "role_id",
          pivotMorphType: "model_type",
          pivotMorphValue: this.name,
          foreignKey: "model_id",
          localKey: "id",
        });
      }
    }

    roles!: ManyToMany<Role>;

    // ── Role assignment (async writes) ────────────────────────────────────────
    async assignRole(...roles: (string | number | Role)[]): Promise<this> {
      const ids = await Role.idsFor(roles.flat() as never, _guardOf(this));
      const type = _morphType(this),
        id = _morphId(this);
      for (const rid of ids) {
        const exists = await DB.table("model_roles")
          .where("model_type", type)
          .where("model_id", id)
          .where("role_id", rid)
          .first();
        if (!exists)
          await DB.table("model_roles").insert({ role_id: rid, model_type: type, model_id: id });
      }
      return this._refreshRoles();
    }

    async removeRole(...roles: (string | number | Role)[]): Promise<this> {
      const ids = await Role.idsFor(roles.flat() as never, _guardOf(this));
      if (ids.length)
        await DB.table("model_roles")
          .where("model_type", _morphType(this))
          .where("model_id", _morphId(this))
          .whereIn("role_id", ids)
          .delete();
      return this._refreshRoles();
    }

    async syncRoles(roles: (string | number | Role)[]): Promise<this> {
      await DB.table("model_roles")
        .where("model_type", _morphType(this))
        .where("model_id", _morphId(this))
        .delete();
      const ids = await Role.idsFor(roles.flat() as never, _guardOf(this));
      const type = _morphType(this),
        id = _morphId(this);
      for (const rid of ids)
        await DB.table("model_roles").insert({ role_id: rid, model_type: type, model_id: id });
      return this._refreshRoles();
    }

    /** @internal Re-read the role slice of the memo from the DB after a write. */
    /** @internal — public only because mixins can't expose private members. */
    async _refreshRoles(): Promise<this> {
      const memo = _authzMemo(this);
      delete memo.roleNames;
      delete memo.rolePerms;
      const self = this as unknown as Record<string, unknown>;
      if (_loaded(this, "roles")) delete self["roles"];
      // Warm every slice the model composed in (not just roles), so a later can()
      // doesn't throw probing a never-loaded direct-permissions slice.
      return this.loadAuthorization();
    }

    /**
     * Load the role name set and role-derived permission set into the per-instance
     * memo. Eager loading is on by default, so this is rarely needed directly.
     */
    async loadRoles(): Promise<this> {
      const t = _morphType(this),
        id = _morphId(this);
      const roleRows = await DB.raw<{ name: string }>(
        `SELECT r.name AS name FROM roles r
         JOIN model_roles mr ON mr.role_id = r.id
         WHERE mr.model_type = ? AND mr.model_id = ?`,
        [t, id],
      );
      const permRows = await DB.raw<{ name: string }>(
        `SELECT p.name AS name FROM permissions p
           JOIN role_permissions rp ON rp.permission_id = p.id
           JOIN model_roles mr ON mr.role_id = rp.role_id
          WHERE mr.model_type = ? AND mr.model_id = ?`,
        [t, id],
      );
      const memo = _authzMemo(this);
      memo.roleNames = new Set(roleRows.map((r) => r.name));
      memo.rolePerms = new Set(permRows.map((r) => r.name));
      return this;
    }

    // ── Synchronous reads (from eager-loaded relations or the memo) ────────────
    getRoleNames(): string[] {
      const memo = _authzMemo(this);
      if (memo.roleNames) return [...memo.roleNames];
      if (_loaded(this, "roles")) {
        const set = new Set((this.roles as unknown as { name: string }[]).map((r) => r.name));
        memo.roleNames = set;
        return [...set];
      }
      throw _notLoaded();
    }

    /** Permissions granted *through* this model's roles. Read by `_effectivePermissions`. */
    getRolePermissionNames(): string[] {
      const memo = _authzMemo(this);
      if (memo.rolePerms) return [...memo.rolePerms];
      if (_loaded(this, "roles")) {
        const roles = this.roles as unknown as Array<Record<string, unknown>>;
        if (roles.every((r) => _loaded(r, "permissions"))) {
          const set = new Set<string>();
          for (const r of roles)
            for (const p of r["permissions"] as { name: string }[]) set.add(p.name);
          memo.rolePerms = set;
          return [...set];
        }
      }
      throw _notLoaded();
    }

    hasRole(role: string): boolean {
      return this.getRoleNames().includes(role);
    }
    hasAnyRole(roles: string[]): boolean {
      const mine = new Set(this.getRoleNames());
      return roles.some((r) => mine.has(r));
    }
    hasAllRoles(roles: string[]): boolean {
      const mine = new Set(this.getRoleNames());
      return roles.every((r) => mine.has(r));
    }

    // ── Effective authorization (shared; identical in Permissions) ─────────
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
