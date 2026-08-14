// ── Named sections ────────────────────────────────────────────────────────────
//
// `<SectionContent name="toolbar">` publishes markup from anywhere in the page
// tree; `<SectionOutlet name="toolbar" />` renders it somewhere else — usually
// in the layout, which is exactly where a page cannot otherwise reach.
//
// Without this, a page that wants to put buttons in the layout's toolbar has to
// thread them through every intermediate component as props, or the layout has
// to know about every page that might contribute. Sections invert that: the
// component that owns the content declares it, and the layout declares a hole.
//
// ## Why outlets resolve last
//
// An outlet emits a token and is filled in a final pass over the finished
// document, rather than reading the store when it renders. Rendering is a single
// forward pass, so a store read would make the result depend on whether the
// outlet happened to render before or after the content — which for the common
// case (outlet in the layout, content in the page) is *backwards*, since the
// layout wraps a page that has already rendered. Deferring makes order
// irrelevant in both directions.

import { AsyncLocalStorage } from "node:async_hooks";

/** One `<SectionOutlet>` awaiting content. */
interface Outlet {
  name: string;
  /** Markup to use when nothing was published to `name`. */
  fallback: string;
}

/** Per-request section state. */
export interface SectionStore {
  /** Published markup, in publication order, per section name. */
  readonly content: Map<string, string[]>;
  /** Outlets awaiting resolution, keyed by their token index. */
  readonly outlets: Outlet[];
  /**
   * Per-request random suffix on the outlet token.
   *
   * The resolving splice is a blind `split`/`join` over finished HTML, so any
   * occurrence of the token is replaced — including one a user put in a string.
   * Escaping is the actual control; this makes the token unguessable so a path
   * that ever misses an escape still cannot be aimed at. Same reasoning as the
   * child-placeholder nonce in `jsx-runtime.ts`.
   */
  readonly nonce: string;
}

const _storage = new AsyncLocalStorage<SectionStore>();

/** A fresh store for one request. */
export function createSectionStore(): SectionStore {
  return {
    content: new Map(),
    outlets: [],
    nonce: crypto.randomUUID().slice(0, 8),
  };
}

/** Run `fn` with `store` as the active section store for the current async chain. */
export function runWithSections<T>(store: SectionStore, fn: () => T): T {
  return _storage.run(store, fn);
}

/** The active store, or `undefined` outside a page render (e.g. a WS patch). */
export function getSectionStore(): SectionStore | undefined {
  return _storage.getStore();
}

/**
 * Publish `html` to the section called `name`.
 *
 * Repeated publications to one name accumulate in order rather than replacing,
 * so two components can both contribute toolbar buttons.
 */
export function publishSection(name: string, html: string): void {
  const store = _storage.getStore();
  if (!store) return;
  const existing = store.content.get(name);
  if (existing) existing.push(html);
  else store.content.set(name, [html]);
}

/**
 * Reserve a place for section `name`, returning the token to emit.
 *
 * Returns `fallback` directly when there is no active store — a WS patch
 * re-renders a component, not the document, so there is nothing to resolve
 * against and the outlet renders its default.
 */
export function reserveSection(name: string, fallback: string): string {
  const store = _storage.getStore();
  if (!store) return fallback;
  const index = store.outlets.length;
  store.outlets.push({ name, fallback });
  return `<!--flow-section:${store.nonce}:${index}-->`;
}

/**
 * Replace every outlet token in `html` with what was published to it.
 *
 * Call once, after the page *and* its layout have rendered — that is the only
 * point at which every publication has happened.
 */
export function resolveSections(html: string, store: SectionStore): string {
  if (store.outlets.length === 0) return html;

  // One pass, not one per outlet. Replacing outlets in a loop would rescan text
  // that was itself just substituted, so markup published to an early section
  // could go on to fill a later one. A function replacer is also what keeps `$&`
  // and friends in the content from being interpreted as replacement patterns.
  // The nonce is hex, so it needs no escaping to sit in this pattern.
  const pattern = new RegExp(`<!--flow-section:${store.nonce}:(\\d+)-->`, "g");

  return html.replace(pattern, (match, digits: string) => {
    const outlet = store.outlets[Number(digits)];
    if (!outlet) return match;
    const published = store.content.get(outlet.name);
    return published && published.length > 0 ? published.join("") : outlet.fallback;
  });
}
