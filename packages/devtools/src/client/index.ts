/**
 * @zerotal/devtools — browser client
 *
 * Usage (in your app.js / frontend entry):
 *   import { DevTools } from '@zerotal/devtools/client';
 *   DevTools.start();
 *
 * Connects to the SSE stream served by DevtoolsInjectionMiddleware and renders a
 * live floating panel. No script injection by the server is required.
 *
 * This file is only the wiring. The panel was one 1,400-line closure holding its
 * state, its transport, its styles, eight renderers, and every helper — which
 * made adding a tab an edit to the middle of it and made none of its logic
 * testable. It is now a directory: {@link Store} holds the state,
 * `transport.ts` owns the wire, `ui/shell.ts` owns the frame, and each tab is a
 * file that exports a {@link TabView}. Both mount modes still run one set of
 * renderers, and both extension doors are unchanged.
 */
import { Store } from "./state.ts";
import { collectClientMetrics, onceLoaded } from "./metrics.ts";
import { connect } from "./transport.ts";
import { mountShell } from "./ui/shell.ts";
import { allTab } from "./tabs/all.ts";
import { cacheTab } from "./tabs/cache.ts";
import { exceptionsTab } from "./tabs/exceptions.ts";
import { jobsTab } from "./tabs/jobs.ts";
import { logsTab } from "./tabs/logs.ts";
import { mailTab } from "./tabs/mail.ts";
import { queriesTab } from "./tabs/queries.ts";
import { requestTab } from "./tabs/request.ts";
import { timelineTab } from "./tabs/timeline.ts";

export interface DevtoolsClientOptions {
  /** Base URL path for the devtools API. Default: '/__zerotal/devtools' */
  endpoint?: string;
  /**
   * How the panel is mounted.
   *
   * `'floating'` (default) pins a collapsible bar to the bottom of the page.
   * `'standalone'` fills the window and drops the collapse/close controls — the
   * inspector dashboard. Both run the same renderers, so a tab added for one
   * exists in the other.
   */
  mode?: "floating" | "standalone";
  /** Element to mount into. Defaults to `document.body`. */
  mount?: HTMLElement;
}

/**
 * The built-in tabs, in strip order.
 *
 * The order is also the `1`–`9` keyboard order, so it is worth being deliberate
 * about: queries first because it is where a request explains itself, all last
 * because it is where you go to leave the request you are on.
 */
const BUILT_IN = [
  queriesTab,
  timelineTab,
  logsTab,
  requestTab,
  exceptionsTab,
  mailTab,
  cacheTab,
  jobsTab,
  allTab,
];

export const DevTools = {
  start(opts: DevtoolsClientOptions = {}): void {
    if (typeof document === "undefined") return;
    if (document.getElementById("__zerotal_dt__")) return;

    const base = (opts.endpoint ?? "/__zerotal/devtools").replace(/\/$/, "");
    const standalone = opts.mode === "standalone";

    const store = new Store(standalone, base);
    const transport = connect(base, store);

    // What the browser measured for this page load, read once after it settles.
    // The panel reports server duration as though it were the user's experience;
    // it is not, and this is the only place that knows the difference.
    onceLoaded(() => {
      store.clientMetrics = collectClientMetrics();
      store.changed();
    });

    mountShell({
      base,
      standalone,
      mount: opts.mount ?? document.body,
      store,
      transport,
      tabs: BUILT_IN,
    });
  },
};

// ── Public surface ────────────────────────────────────────────────────────────
//
// The panel is markup, and markup is awkward to assert on. What is exported here
// is the part of it that is *logic*: a package contributing a channel can check
// how its rows will filter, fold, and nest without a browser.
//
// Deliberately not everything the directory exports. `TabView`, the theme choice,
// and the All tab's own mechanics are internal contracts this package reserves
// the right to change — the tests that cover them import them by path, which is
// what a same-package test should do rather than widening the API to be reachable.

export type { DevtoolsPanelPlugin } from "./registry.ts";
export type { Facets } from "./filter.ts";
export type { PathTreeNode, TraceRow } from "./tree.ts";

export {
  matchesFilter,
  matchesFacets,
  traceMatches,
  methodsPresent,
  noFacets,
  facetsActive,
  SLOW_MS,
} from "./filter.ts";
export { buildPathTree, traceGroupKey, foldTraceRows } from "./tree.ts";
