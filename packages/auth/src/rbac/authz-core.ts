// ── Authorization core ──────────────────────────────────────────────────────
//
// Shared, mixin-agnostic helpers for the relational RBAC mixins (`Roles`,
// `Permissions`). Kept as free functions (not a base mixin) so the two mixins
// can be applied independently or together without a diamond — and so the shared
// pieces aren't redeclared as conflicting `private` members across both classes.
//
// Effective-permission resolution is the one place roles and permissions meet:
// `_effectivePermissions` feature-detects whichever slice(s) a model composed in
// (`getRolePermissionNames` from Roles, `getDirectPermissionNames` from
// Permissions) and unions them. Either mixin alone answers `can()`; together
// they answer over the union — with no required composition order.

/**
 * Per-instance authorization memo. Slices are filled lazily and reset on writes.
 *
 * @internal
 */
export interface AuthzMemo {
  /** Names of the roles assigned to the model. */
  roleNames?: Set<string>;
  /** Permission names derived from the model's roles (`roles.permissions`). */
  rolePerms?: Set<string>;
  /** Permission names granted directly to the model. */
  directPerms?: Set<string>;
}

/**
 * Lazily attach (and return) the non-enumerable `__authz` memo on an instance.
 *
 * @internal
 */
export function _authzMemo(instance: object): AuthzMemo {
  const self = instance as { __authz?: AuthzMemo };
  if (!self.__authz) {
    Object.defineProperty(self, "__authz", {
      value: {},
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return self.__authz!;
}

/**
 * Drop the whole memo (used after a write that could affect any slice).
 *
 * @internal
 */
export function _resetAuthzMemo(instance: object): void {
  (instance as { __authz?: AuthzMemo }).__authz = {};
}

/**
 * The morph type stored in the polymorphic pivots — the concrete subclass name.
 *
 * @internal
 */
export function _morphType(m: object): string {
  return (m.constructor as { name: string }).name;
}

/**
 * The model's primary key.
 *
 * @internal
 */
export function _morphId(m: object): unknown {
  return (m as { id: unknown }).id;
}

/**
 * The auth guard this model belongs to (defaults to "web").
 *
 * @internal
 */
export function _guardOf(m: object): string {
  return (m as { guard?: string }).guard ?? "web";
}

/**
 * Wildcard-aware permission match: `*`, `post.*`, or an exact name.
 *
 * @internal
 */
export function _granted(perms: Set<string>, ability: string): boolean {
  if (perms.has("*") || perms.has(ability)) return true;
  for (const p of perms) {
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -2);
      if (ability === prefix || ability.startsWith(prefix + ".")) return true;
    }
  }
  return false;
}

/**
 * A relation is "loaded" when it's a plain data property (not the lazy getter).
 *
 * @internal
 */
export function _loaded(obj: object, rel: string): boolean {
  const d = Object.getOwnPropertyDescriptor(obj, rel);
  return !!d && typeof d.get !== "function";
}

/**
 * Thrown by the synchronous reads when authorization data isn't in memory yet.
 *
 * @internal
 */
export function _notLoaded(): Error {
  return new Error(
    "[Zerotal] Authorization is not loaded on this instance. Roles/permissions checks are " +
      "synchronous and read from eager-loaded data (on by default). Fetch the model via a query " +
      "(e.g. `User.find(id)`) or call `await user.loadAuthorization()` first.",
  );
}

/**
 * Effective permission set for a model: the union of directly-granted permissions
 * (Permissions) and role-derived permissions (Roles), feature-detected so
 * each mixin works alone or composed. May throw {@link _notLoaded} if a present
 * slice hasn't been eager-loaded or `loadAuthorization()`-ed.
 *
 * @internal
 */
export function _effectivePermissions(m: object): Set<string> {
  const o = m as Record<string, unknown>;
  const set = new Set<string>();
  const direct = o["getDirectPermissionNames"];
  if (typeof direct === "function") {
    for (const p of (direct as () => string[]).call(m)) set.add(p);
  }
  const role = o["getRolePermissionNames"];
  if (typeof role === "function") {
    for (const p of (role as () => string[]).call(m)) set.add(p);
  }
  return set;
}
