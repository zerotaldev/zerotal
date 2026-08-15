// ── Global client store — a single Alpine store named "flow" ────────────────────
//
// App-wide, client-only UI state the SERVER never needs to see: theme, sidebar open/closed,
// a command-palette's visibility, an unsaved-changes flag. It IS an Alpine store — Alpine
// already gives us a global, reactive, dependency-tracked store, so we don't reinvent it.
// Everything lives under one store, `flow`, and `$flow.$store` returns it:
//
//   <button onClick={() => ($flow.store.ui.dark = !$flow.store.ui.dark)}>Toggle</button>
//   <div class={$flow.store.ui.dark ? "dark" : ""}>…</div>
//   <span>{$flow.store.cart.count} items</span>
//
// Reads compile to Alpine bindings (x-text / :class / x-show) and re-render with no round-trip;
// writes mutate the reactive store directly. Declare the shape with defineStore().
//
// Division of labour:
//   • $flow.store — live cross-component UI state the server never sees.
//   • @session    — a preference that must survive a refresh (persisted server-side).
//   • @expose     — state one component owns and the server may reconcile.
//
// Dependency-free (no @zerotal/core import) so it's safe in the browser runtime bundle.

/**
 * The shape of the global client store (`$flow.store`). Declare your namespaces by augmenting
 * this interface, which makes every `$flow.store.*` access fully typed:
 *
 * ```ts
 * // resources/js/env.d.ts — augment the /store subpath, where the interface is declared.
 * declare module "@zerotal/flow/store" {
 *   interface FlowStore {
 *     ui: { dark: boolean; sidebar: boolean };
 *     cart: { count: number };
 *   }
 * }
 * ```
 */
export interface FlowStore {}

/** The one Alpine store name that backs `$flow.store`. */
const STORE_NAME = "flow";

/** The slice of Alpine we use (register/read a named store). */
interface AlpineStores {
  store(name: string): Record<string, unknown> | undefined;
  store(name: string, value: Record<string, unknown>): void;
}

type GlobalWithAlpine = typeof globalThis & {
  Alpine?: AlpineStores;
  __flowStoreInit?: Array<Record<string, unknown>>;
};

function _g(): GlobalWithAlpine {
  return globalThis as GlobalWithAlpine;
}

/** Recursively fill defaults into `target` WITHOUT overwriting values already present. */
function _mergeDefaults(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      cur &&
      typeof cur === "object" &&
      !Array.isArray(cur)
    ) {
      _mergeDefaults(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else if (!(k in target)) {
      target[k] = v;
    }
  }
}

/** Merge `initial` (defaults only) into the reactive "flow" Alpine store, registering it if new. */
function _seed(A: AlpineStores, initial: Record<string, unknown>): void {
  if (!A.store(STORE_NAME)) A.store(STORE_NAME, {});
  _mergeDefaults(A.store(STORE_NAME)!, initial); // mutating the reactive store keeps bindings live
}

/**
 * Declare (or extend) the client store's initial shape — call once at app start:
 *
 * ```ts
 * // resources/js/app.ts — import from the browser-safe /store subpath, not the package barrel.
 * import { defineStore } from "@zerotal/flow/store";
 * defineStore({ ui: { dark: false, sidebar: true }, cart: { count: 0 } });
 * ```
 *
 * Existing values are preserved (defaults only). Safe to call before OR after the Flow runtime
 * boots — a call made before Alpine exists is queued and applied when the store is registered.
 */
export function defineStore(initial: Record<string, unknown>): void {
  const g = _g();
  if (g.Alpine?.store) _seed(g.Alpine, initial);
  else (g.__flowStoreInit ??= []).push(initial);
}

/**
 * @internal Register the "flow" Alpine store and apply any defineStore() calls queued before
 * Alpine existed. Called once by the client entry, before `Alpine.start()`. Idempotent.
 */
export function initClientStore(alpine: AlpineStores): Record<string, unknown> {
  if (!alpine.store(STORE_NAME)) alpine.store(STORE_NAME, {});
  const g = _g();
  for (const partial of g.__flowStoreInit ?? []) _seed(alpine, partial);
  g.__flowStoreInit = [];
  return alpine.store(STORE_NAME)!;
}

/** @internal The reactive "flow" store object (Alpine-owned), or `{}` before Alpine is ready. */
export function clientStore(): Record<string, unknown> {
  const A = _g().Alpine;
  return (A?.store && A.store(STORE_NAME)) || {};
}
