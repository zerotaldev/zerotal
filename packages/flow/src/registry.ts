import type { Component } from "./Component.ts";
import type { BaseModel } from "@zerotal/orm";
import { registerFlowModel } from "./synths/ModelSynth.ts";
import { getExposedMethods, getRenderlessMethods } from "./decorators.ts";

// ── Component registry ────────────────────────────────────────────────────────

export interface PageEntry {
  PageClass: typeof Component;
  path: string;
}

const _pages = new Map<string, PageEntry>();

/** Register a Component class by its constructor name. Called by Router.flow(). */
export function registerPage(path: string, PageClass: typeof Component): void {
  const name = PageClass.name;
  _pages.set(name, { PageClass, path });

  // Auto-register any model classes declared in PageClass.models. The map key is
  // the stable, developer-assigned name — using it (rather than ModelClass.name,
  // which minifiers mangle) preserves ModelSynth's minification-safe design.
  const models = (PageClass as unknown as PageClassWithMeta).models;
  if (models) {
    for (const [name, ModelClass] of Object.entries(models)) {
      registerFlowModel(name, ModelClass as typeof BaseModel);
    }
  }
}

/** Look up a registered Component class by its constructor name. */
export function getPage(name: string): PageEntry | undefined {
  return _pages.get(name);
}

/** @internal — used by the compiler to iterate all registered pages. */
export function _getPageEntries(): Map<string, PageEntry> {
  return _pages;
}

/**
 * Register a Component class that is used as a nested component (no route of its
 * own). Called automatically the first time a parent embeds it via
 * `this.child(...)`; call it explicitly from a provider when child components
 * must survive a server restart before any parent page has been rendered.
 *
 * Registration is keyed by the class's constructor name and is idempotent — a class
 * already registered (e.g. via `Router.flow()`) is left untouched, so the `path` here
 * only applies to a first-time, routeless registration.
 *
 * @param PageClass - The Component subclass to register.
 * @param path - Route path to associate; defaults to `""` for a nested (routeless) component.
 *
 * @example
 * ```ts
 * // In a ServiceProvider's boot method:
 * registerComponent(CounterWidget);
 * ```
 *
 * @internal
 */
export function registerComponent(PageClass: typeof Component, path = ""): void {
  if (!_pages.has(PageClass.name)) registerPage(path, PageClass);
}

// ── Method allowlist (opt-in via @expose) ────────────────────────────────────

// Built-in action names handled directly by the WS handler before method validation.
// $mount is the lazy-loading trigger: runs onMount() for components that were
// initially rendered as placeholders (lazy/defer child components).
// $rerender is a no-op re-render from the current snapshot (no onMount) — used by
// dev fast refresh to apply new code while preserving state.
// $presence refills the @presence member list(s) from the broadcast presence channel.
// $shared re-reads @shared props from the room store (convergence) and re-renders.
export const BUILTIN_ACTIONS = new Set([
  "$set",
  "$refresh",
  "$mount",
  "$rerender",
  "$presence",
  "$shared",
]);

/**
 * Returns the set of method names on a Component subclass that are safe to call
 * from the browser via WebSocket — exclusively those decorated with @expose.
 *
 * The opt-in model eliminates prototype-scanning ambiguity: no base-class
 * exclusion lists, no `_`-prefix heuristics, no duck-typing to find the
 * "base Component" prototype. If the developer did not @expose it, it is not callable.
 */
export function getAllowedMethods(PageClass: typeof Component): Set<string> {
  return getExposedMethods(PageClass);
}

/**
 * Returns the set of method names that skip the re-render step after execution.
 * Methods must still be @expose-d to be callable; @renderless only suppresses rendering.
 */
export { getRenderlessMethods };

// ── PageClass static metadata interface ──────────────────────────────────────

/**
 * A Component constructor plus the optional static metadata a page class may declare
 * (`title`, `head`, `models`, `layout`). Used when resolving file-route page exports and
 * when auto-registering associated model classes.
 *
 * @internal
 */
export interface PageClassWithMeta {
  new (): Component;
  name: string;
  /**
   * Sets the HTML `<title>` for this page — a string, or a function of the component
   * instance. Resolve it with the component's `_resolveTitle()` rather than reading it
   * directly, so both forms are handled in one place.
   */
  title?: string | ((component: never) => string);
  /** Raw HTML to inject into <head> for this page. */
  head?: string;
  /**
   * `false` renders this page as markup: no snapshot, no state script, no client
   * registration — and, if nothing else on the page registers either, no
   * WebSocket. See {@link Component.interactive}.
   */
  interactive?: boolean;
  /** Optional model associations for auto-registration. */
  models?: Record<string, typeof import("@zerotal/orm").BaseModel>;
  /** Optional layout class. */
  layout?: new () => import("./Layout.ts").Layout;
}
