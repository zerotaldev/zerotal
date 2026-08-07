// ── Optimistic collections (client) ────────────────────────────────────────────
//
// `appendOptimistic(prop, item)` / `removeOptimistic(prop, match)` mutate a reactive array on the
// client *before* the server confirms, so a list add/remove shows instantly. The item survives any
// interim (broadcast/event) patch — the pending ops are re-applied on top of each server merge —
// and is reconciled when the owning action's patch lands: on success the authoritative server list
// stands (the real, persisted row); on failure the server list is unchanged, so the optimistic
// change rolls back automatically. This module is the pure, DOM-free core (the bridge applies it to
// the live Alpine store).

/** A pending optimistic mutation on one array prop. */
export interface OptOp {
  prop: string;
  kind: "append" | "remove";
  /** The exact item reference appended (append ops). */
  item?: unknown;
  /** Predicate identifying the removed item(s) (remove ops). */
  match?: (item: unknown) => boolean;
}

/** Append `item` unless the array already holds that exact reference (idempotent re-apply). */
export function applyAppend(arr: readonly unknown[], item: unknown): unknown[] {
  return arr.includes(item) ? [...arr] : [...arr, item];
}

/** Remove every item matching `match`. */
export function applyRemove(arr: readonly unknown[], match: (item: unknown) => boolean): unknown[] {
  return arr.filter((x) => !match(x));
}

/**
 * Re-apply all pending ops onto a fresh (server) snapshot of the arrays, keyed by prop. Pure —
 * returns a new record, leaving `current` untouched. Ops for props absent from `current` (or
 * non-array values) are skipped.
 */
export function reapply(
  current: Record<string, unknown[]>,
  ops: readonly OptOp[],
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = { ...current };
  for (const op of ops) {
    const arr = out[op.prop];
    if (!Array.isArray(arr)) continue;
    out[op.prop] = op.kind === "append" ? applyAppend(arr, op.item) : applyRemove(arr, op.match!);
  }
  return out;
}

/** The distinct prop names touched by a set of ops (so the bridge knows which arrays to refresh). */
export function opProps(ops: readonly OptOp[]): string[] {
  return [...new Set(ops.map((o) => o.prop))];
}
