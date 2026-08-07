/**
 * The roles page, driven by the RBAC that `@zerotal/auth` already provides.
 *
 * {@link RoleProvider} is deliberately open, because where roles live is the
 * app's decision. When the answer is the framework's own role-based access
 * control — roles, permissions, and the `role_permissions` pivot between them —
 * this builds the provider for you:
 *
 *   import { authRoles } from "@zerotal/admin";
 *
 *   Panel.roles(authRoles());
 *
 * The result is a matrix over the real permissions, not a copy of them: ticking
 * a box calls `syncPermissions`, so the same checks that already guard the app
 * start passing immediately.
 *
 * `@zerotal/auth` is resolved lazily, so it stays an optional peer.
 */
import { frameworkLog } from "@zerotal/core/logger";
import type { Role, RoleProvider } from "./roles.ts";

export interface AuthRolesOptions {
  /**
   * Guard the roles belong to. Defaults to `"web"`, matching the framework's
   * own default, so most apps need not think about it.
   */
  guard?: string;
  /**
   * Role names that hold every permission.
   *
   * Named rather than inferred, because "administrator" is a convention and not
   * something the data can tell you. A superuser role is shown as holding
   * everything and cannot be edited or deleted from the panel.
   */
  superusers?: string[];
}

/** The role surface this needs, kept structural so `auth` stays optional. */
interface RoleModelLike {
  id: unknown;
  name: string;
  label?: string | null;
  permissionNames(): Promise<string[]>;
  syncPermissions(permissions: string[]): Promise<unknown>;
  delete(): Promise<unknown>;
}

interface RoleStatics {
  query(): {
    where(
      column: string,
      value: unknown,
    ): {
      orderBy(column: string, direction: string): { get(): Promise<RoleModelLike[]> };
      first<T>(): Promise<T | null>;
    };
  };
  find(id: unknown): Promise<RoleModelLike | null>;
  resolve(name: string, guard?: string): Promise<RoleModelLike>;
}

async function roleModel(): Promise<RoleStatics | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "@zerotal/auth" as string)) as {
      Role?: RoleStatics;
    };
    return mod.Role ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a {@link RoleProvider} over the framework's roles and permissions.
 *
 * Listing fails soft — an unconfigured database or a missing table yields an
 * empty page rather than a broken panel — while writes report their failures,
 * because silently not saving a permission change is the worst outcome here.
 */
export function authRoles(options: AuthRolesOptions = {}): RoleProvider {
  const guard = options.guard ?? "web";
  const superusers = new Set(
    (options.superusers ?? ["admin", "administrator"]).map((n) => n.toLowerCase()),
  );

  const isSuper = (name: string): boolean => superusers.has(name.toLowerCase());

  return {
    async list(): Promise<Role[]> {
      try {
        const Role = await roleModel();
        if (!Role) return [];
        const rows = await Role.query().where("guard", guard).orderBy("name", "asc").get();
        return rows.map((row) => ({
          id: String(row.id),
          name: row.label || row.name,
          superuser: isSuper(row.name),
        }));
      } catch (error) {
        frameworkLog("admin").warn("Roles unavailable", { guard }, error);
        return [];
      }
    },

    async permissionsFor(roleId): Promise<string[]> {
      try {
        const Role = await roleModel();
        const role = await Role?.find(roleId);
        return (await role?.permissionNames()) ?? [];
      } catch (error) {
        frameworkLog("admin").warn("Could not read a role's permissions", { roleId }, error);
        return [];
      }
    },

    async setPermissions(roleId, keys): Promise<void> {
      const Role = await roleModel();
      if (!Role) throw new Error("Roles need @zerotal/auth.");
      const role = await Role.find(roleId);
      if (!role) return;
      // Names that do not exist yet are created by `syncPermissions`, which is
      // what lets the matrix offer a permission before anything has used it.
      await role.syncPermissions(keys);
    },

    async create(role): Promise<void> {
      const Role = await roleModel();
      if (!Role) throw new Error("Roles need @zerotal/auth.");
      await Role.resolve(role.name, guard);
    },

    async remove(roleId): Promise<void> {
      const Role = await roleModel();
      if (!Role) throw new Error("Roles need @zerotal/auth.");
      const role = await Role.find(roleId);
      // A superuser role is the one nobody should be able to delete themselves
      // out of, so it is refused here rather than only hidden in the UI.
      if (role && !isSuper(role.name)) await role.delete();
    },
  };
}
