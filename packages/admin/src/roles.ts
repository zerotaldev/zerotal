/**
 * Roles and permissions, as something you can see and change.
 *
 * Authorization already works without this: a resource's `can()` answers every
 * question the panel asks, usually by delegating to a gate. What is missing is
 * the other direction — being able to look at who can do what, and change it,
 * without editing code or writing SQL by hand.
 *
 * Two halves make that possible.
 *
 * The **catalogue** is derived, not declared. {@link panelPermissions} walks the
 * registered resources, pages and actions and reports every ability the panel
 * actually checks. That matters because a hand-maintained permission list drifts
 * the moment somebody adds a resource, and a matrix missing a row is worse than
 * no matrix — it quietly suggests a permission does not exist.
 *
 * The **assignments** are the app's, through a {@link RoleProvider}. Where roles
 * live and how a user is attached to one differs per application, and the panel
 * has no business assuming a schema:
 *
 *   Panel.roles({ list, permissionsFor, setPermissions });
 *
 * With no provider configured the page does not appear, and authorization keeps
 * working exactly as it did.
 */
import type { PanelInstance } from "./PanelInstance.ts";
import { Action, ActionGroup } from "./actions/Action.ts";

/** One thing a role may be permitted to do. */
export interface Permission {
  /** `products.update` — what a `can()` check would be asked. */
  key: string;
  /** Human label for the matrix cell's row. */
  label: string;
  /** Which resource or page this belongs to, for grouping the matrix. */
  group: string;
}

/** A named set of permissions. */
export interface Role {
  id: string;
  name: string;
  /** Optional description, shown under the name. */
  description?: string;
  /**
   * A role that holds every permission, present and future.
   *
   * Worth modelling explicitly rather than by ticking every box: an
   * administrator should not silently lose access to a resource added next week.
   */
  superuser?: boolean;
}

/** What the app supplies so roles can be listed and edited. */
export interface RoleProvider {
  /** Every role, in the order they should appear. */
  list(): Promise<Role[]> | Role[];
  /** The permission keys one role currently holds. */
  permissionsFor(roleId: string): Promise<string[]> | string[];
  /** Replace a role's permissions with exactly this set. */
  setPermissions(roleId: string, keys: string[]): Promise<void> | void;
  /** Create a role. Omit to make roles read-only in the panel. */
  create?(role: Omit<Role, "id">): Promise<void> | void;
  /** Delete a role. Omit to forbid deletion from the panel. */
  remove?(roleId: string): Promise<void> | void;
}

/** The abilities every resource is checked for, whatever else it declares. */
const RESOURCE_ABILITIES: { suffix: string; label: string }[] = [
  { suffix: "viewAny", label: "List" },
  { suffix: "view", label: "View" },
  { suffix: "create", label: "Create" },
  { suffix: "update", label: "Edit" },
  { suffix: "delete", label: "Delete" },
];

/** The soft-delete abilities, only meaningful where the model has them. */
const TRASH_ABILITIES: { suffix: string; label: string }[] = [
  { suffix: "restore", label: "Restore" },
  { suffix: "forceDelete", label: "Delete permanently" },
];

/** Turn an action key into a readable label. */
function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Every action a resource offers, with groups flattened into their members. */
function actionsOf(resource: {
  recordActions(): unknown[];
  headerActions(): unknown[];
  bulkActions(): unknown[];
}): Action[] {
  const flatten = (items: unknown[]): Action[] =>
    items.flatMap((item) =>
      item instanceof ActionGroup
        ? (item._actions as Action[])
        : item instanceof Action
          ? [item]
          : [],
    );
  return [
    ...flatten(resource.recordActions()),
    ...flatten(resource.headerActions()),
    ...flatten(resource.bulkActions()),
  ];
}

/**
 * Every permission this panel checks, derived from what it has registered.
 *
 * Grouped by resource so the matrix reads as one block per thing being
 * administered. Custom actions come last within their group, because the five
 * standard abilities are what someone scans for first.
 */
export function panelPermissions(panel: PanelInstance): Permission[] {
  const out: Permission[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, group: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, group });
  };

  for (const resource of panel.resources()) {
    const slug = resource.getSlug();
    const group = resource.getPluralLabel();

    for (const { suffix, label } of RESOURCE_ABILITIES) add(`${slug}.${suffix}`, label, group);
    if (resource.usesSoftDeletes()) {
      for (const { suffix, label } of TRASH_ABILITIES) add(`${slug}.${suffix}`, label, group);
    }
    // An action's key is what `can()` is asked for it, so it belongs in the
    // matrix on the same footing as the standard abilities.
    for (const action of actionsOf(resource)) {
      add(`${slug}.${action._key}`, action.getLabel(), group);
    }
  }

  // Pages carry their own ability when they declare one; that is the only thing
  // guarding them, so it must be visible here.
  for (const page of panel.registeredPages()) {
    const ability = page.ability;
    if (ability) add(ability, titleCase(ability.split(".").pop() ?? ability), "Pages");
  }

  return out;
}

/** Group a flat permission list for rendering, preserving order.
 *
 * @internal
 */
export function groupPermissions(
  permissions: Permission[],
): { group: string; items: Permission[] }[] {
  const groups: { group: string; items: Permission[] }[] = [];
  for (const permission of permissions) {
    const existing = groups.find((g) => g.group === permission.group);
    if (existing) existing.items.push(permission);
    else groups.push({ group: permission.group, items: [permission] });
  }
  return groups;
}

/**
 * Whether a role holds a permission.
 *
 * A superuser holds everything by definition, which is what keeps the matrix
 * honest about what such a role can actually do.
 */
export function roleHas(role: Role, held: string[], key: string): boolean {
  return role.superuser === true || held.includes(key);
}
