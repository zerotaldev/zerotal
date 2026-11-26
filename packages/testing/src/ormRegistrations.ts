/**
 * Carrying an app's ORM registrations across the context resets between test files.
 *
 * Global scopes, lifecycle hooks (observers among them) and state-transition
 * callbacks live on the active `OrmContext`, and `createTestApp()` replaces that
 * context: `resetTestState()` installs a new one, and so does re-adopting the shared
 * app. Some of what was on the old one is registered once per process and never
 * again — a provider's `onBooted()` on an app that is not booted twice, a model's
 * class body on a module that is not evaluated twice — so without this every file
 * after the first ran with tenant scopes, observers and the `Roles` eager-load
 * missing.
 *
 * Connections are left alone: those are the database helpers' to set per test.
 *
 * @internal
 */
import { currentOrmContext } from "@zerotal/orm";

type Registry<V> = Map<unknown, Map<string, V>>;

/** A copy of the registrations on an ORM context, detached from it. */
export interface OrmRegistrations {
  globalScopes: Registry<unknown>;
  hooks: Registry<unknown[]>;
  transitionCallbacks: Registry<unknown[]>;
}

function _copy<V>(source: Map<unknown, Map<string, V>>, each: (value: V) => V): Registry<V> {
  const out: Registry<V> = new Map();
  for (const [owner, entries] of source) {
    const inner = new Map<string, V>();
    for (const [key, value] of entries) inner.set(key, each(value));
    out.set(owner, inner);
  }
  return out;
}

/** @internal Copy what is registered on the active ORM context. */
export function _snapshotOrmRegistrations(): OrmRegistrations {
  const ctx = currentOrmContext();
  return {
    globalScopes: _copy(ctx.globalScopes as Registry<unknown>, (v) => v),
    hooks: _copy(ctx.hooks as Registry<unknown[]>, (v) => [...v]),
    transitionCallbacks: _copy(ctx.transitionCallbacks as Registry<unknown[]>, (v) => [...v]),
  };
}

/** Add `from`'s entries to `into`, keeping what `into` already has. */
function _merge<V>(into: Map<unknown, Map<string, V>>, from: Registry<V>, list: boolean): void {
  for (const [owner, entries] of from) {
    let target = into.get(owner);
    if (!target) into.set(owner, (target = new Map()));
    for (const [key, value] of entries) {
      const existing = target.get(key);
      if (existing === undefined) {
        target.set(key, list ? ([...(value as unknown[])] as V) : value);
      } else if (list) {
        const have = existing as unknown[];
        for (const fn of value as unknown[]) if (!have.includes(fn)) have.push(fn);
      }
    }
  }
}

/**
 * @internal Put registrations back on the active ORM context, after a reset, without
 * replacing anything registered on it since.
 */
export function _carryOrmRegistrations(...sources: (OrmRegistrations | undefined)[]): void {
  const ctx = currentOrmContext();
  for (const source of sources) {
    if (!source) continue;
    _merge(ctx.globalScopes as Registry<unknown>, source.globalScopes, false);
    _merge(ctx.hooks as Registry<unknown[]>, source.hooks, true);
    _merge(ctx.transitionCallbacks as Registry<unknown[]>, source.transitionCallbacks, true);
  }
}
