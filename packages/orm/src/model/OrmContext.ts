import type { SQLInstance } from "../db/sql-types.ts";

/**
 * Execution-scoped container for all mutable ORM state that must NOT leak across
 * requests or tenants — the override/named connections, per-model state-machine
 * transition callbacks, registered global scopes, and lifecycle hooks.
 *
 * Keeping this state on a swappable context (rather than in module globals) lets
 * each request or tenant boundary run with an isolated ORM view; the app scope
 * integration below swaps a fresh `OrmContext` in per application scope.
 *
 * @example
 * // Scope connection + registrations to a block, then restore:
 * const prev = useOrmContext(new OrmContext());
 * try {
 *   BaseModel.registerConnection("tenant", tenantConn);
 *   await doTenantWork();
 * } finally {
 *   useOrmContext(prev);
 * }
 *
 * @internal
 */
export class OrmContext {
  /** Explicit connection override that wins over the resolved default (used by tests / `withDatabase`). */
  overrideConnection: SQLInstance | null = null;
  /** Connections registered by name, selectable via `static connection`. */
  namedConnections = new Map<string, SQLInstance>();
  /** Per-model `onTransition` callbacks, keyed by target state (see the `State` mixin). */
  transitionCallbacks = new Map<ClassRef, Map<string, unknown[]>>();
  /** Per-model registered global query scopes. */
  globalScopes = new Map<ClassRef, Map<string, unknown>>();
  /** Per-model lifecycle hooks. */
  hooks = new Map<ClassRef, Map<string, unknown[]>>();
}

let _ctx = new OrmContext();

/**
 * Return the currently active {@link OrmContext}.
 *
 * @internal
 */
export function currentOrmContext(): OrmContext {
  return _ctx;
}

/**
 * Install `ctx` (or a fresh {@link OrmContext}) as the active context and return
 * the previous one, so callers can restore it afterwards.
 *
 * @param ctx The context to activate (defaults to a new, empty context).
 * @returns The context that was active before this call.
 *
 * @internal
 */
export function useOrmContext(ctx: OrmContext = new OrmContext()): OrmContext {
  const prev = _ctx;
  _ctx = ctx;
  return prev;
}

/**
 * Replace the active context with a fresh, empty {@link OrmContext} (test/teardown reset).
 *
 * @internal
 */
export function resetOrmContext(): void {
  _ctx = new OrmContext();
}

import { registerAppScope } from "@zerotal/core";
import type { ClassRef } from "../support/classRef.ts";

let _appScopeRegistered = false;
if (!_appScopeRegistered) {
  _appScopeRegistered = true;
  registerAppScope(() => {
    const prev = useOrmContext(new OrmContext());
    return () => {
      useOrmContext(prev);
    };
  });
}
