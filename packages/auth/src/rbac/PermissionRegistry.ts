/**
 * Code-declared permission registry. Declare the permission names your app uses
 * in a provider (so they're reviewable in source and present on every deploy),
 * then run `auth:sync-permissions` to upsert them into the database.
 *
 * @example
 * // app/providers/AppProvider.ts (boot)
 * import { definePermission } from '@zerotal/auth';
 * definePermission('post.create', 'post.update', 'post.delete', 'post.publish');
 */

const _permissions = new Set<string>();

/** Register one or more permission names. */
export function definePermission(...names: (string | string[])[]): void {
  for (const n of names.flat()) _permissions.add(n);
}

/**
 * All registered permission names.
 *
 * @internal
 */
export function registeredPermissions(): string[] {
  return [..._permissions];
}

/** @internal — test reset. */
export function _clearRegisteredPermissions(): void {
  _permissions.clear();
}

/**
 * Facade-style accessor: `PermissionRegistry.define('post.create')`, `PermissionRegistry.all()`.
 *
 * @internal
 */
export const PermissionRegistry = {
  define: (...names: (string | string[])[]): void => definePermission(...names),
  all: (): string[] => registeredPermissions(),
};
