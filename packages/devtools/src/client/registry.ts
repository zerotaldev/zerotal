/**
 * The extension door other packages come through.
 *
 * A package adds its own tab to the injected panel — a unified dev tool across
 * the framework — by calling `window.__zerotalDevtools?.register(panel)` from its
 * own browser code (`@zerotal/flow`'s time-travel timeline is the live consumer).
 * The panel renders the extra tab and calls `panel.render(el)` when it is shown;
 * `refresh(id)` lets the extension push a live update.
 *
 * The registry is created lazily by whichever runs first — this panel or an
 * extension — so registration is order-independent. That shape is public API and
 * has a shipped consumer, so it survived the client rewrite unchanged.
 */

import type { RequestTrace } from "../RequestTrace.ts";

/**
 * What the panel knows when it asks a plugin to draw.
 *
 * A plugin owns live browser state, which is why it renders itself rather than
 * declaring a channel. But the same events usually have a server half recorded
 * against a trace, and a plugin that cannot reach it has to either duplicate the
 * measurement client-side or show half the story in a tab of its own. Flow's
 * time-travel frames and its server actions are the case in point: the same
 * clicks, once from each end.
 */
export interface DevtoolsPanelContext {
  /** The trace selected in the request list, or `null` when none is. */
  trace: RequestTrace | null;
}

/** A panel another package contributes as a tab in the Zerotal devtools. */
export interface DevtoolsPanelPlugin {
  /** Unique id — the tab is addressed internally as `plugin:<id>`. */
  id: string;
  /** Tab label. */
  title: string;
  /** Optional badge value (e.g. a count); a falsy return hides the badge. */
  badge?: () => number | string | undefined;
  /**
   * Render the panel's content into `el` (the shared, persistent content area).
   *
   * `context` is optional so a plugin written against the one-argument form keeps
   * working untouched — it simply ignores an argument it never declared.
   */
  render: (el: HTMLElement, context?: DevtoolsPanelContext) => void;
}

export interface DevtoolsRegistry {
  panels: DevtoolsPanelPlugin[];
  /** @internal set by the host panel — called when a panel registers. */
  _emit: ((p: DevtoolsPanelPlugin) => void) | null;
  /** @internal set by the host panel — called on refresh(id). */
  _refresh: ((id?: string) => void) | null;
  register(panel: DevtoolsPanelPlugin): DevtoolsPanelPlugin;
  refresh(id?: string): void;
}

// `window.__zerotalDevtools` is the documented extension point above, so it
// belongs on `Window` rather than behind a cast at each use. Declared, not
// asserted: an extension reading it from its own code gets the same type.
declare global {
  interface Window {
    __zerotalDevtools?: DevtoolsRegistry;
  }
}

/** Get-or-create the global devtools extension registry. */
export function ensureRegistry(): DevtoolsRegistry {
  const w = window;
  if (!w.__zerotalDevtools) {
    w.__zerotalDevtools = {
      panels: [],
      _emit: null,
      _refresh: null,
      register(panel: DevtoolsPanelPlugin) {
        this.panels.push(panel);
        this._emit?.(panel);
        return panel;
      },
      refresh(id?: string) {
        this._refresh?.(id);
      },
    };
  }
  return w.__zerotalDevtools;
}
