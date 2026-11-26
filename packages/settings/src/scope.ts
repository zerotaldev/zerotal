import type { SettingScopeKind } from "./setting.ts";

/**
 * Who a read or write is for. Anything left out comes from the context: the
 * tenant from `TenantContext`, the user from the authenticated request.
 */
export interface SettingsScope {
  /** The tenant (company). `null` reads and writes outside any tenant. */
  tenant?: number | null | undefined;
  /** The user. `null` reads and writes for no particular user. */
  user?: string | number | null | undefined;
}

/** One stored level: the kind, who it belongs to, and the key it is filed under. */
export interface ScopeRef {
  kind: SettingScopeKind;
  tenant: number | null;
  user: string | null;
  /** `global`, `tenant:7`, `tenant:7:user:42` or `user:42` — unique per setting. */
  id: string;
}

/**
 * The stored level for a kind and an owner.
 *
 * The id is the whole identity of an override and the only thing a read matches
 * on, so a tenant's id can only ever name that tenant's rows — that is what keeps
 * one tenant's override out of another's reads, rather than a `WHERE` someone has
 * to remember. Nulls are spelled out because a unique index treats two NULLs as
 * different, and the global level would otherwise be insertable twice.
 *
 * @internal
 */
export function _scopeRef(
  kind: SettingScopeKind,
  tenant: number | null,
  user: string | null,
): ScopeRef {
  if (kind === "global") return { kind, tenant: null, user: null, id: "global" };
  if (kind === "tenant") return { kind, tenant, user: null, id: `tenant:${String(tenant)}` };
  const id = tenant === null ? `user:${String(user)}` : `tenant:${tenant}:user:${String(user)}`;
  return { kind, tenant, user, id };
}
