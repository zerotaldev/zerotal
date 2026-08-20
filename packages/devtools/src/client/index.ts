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
import { liveTab } from "./tabs/live.ts";
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
 * The built-in views, in strip order.
 *
 * Only two of these are tabs. The rest are `scope: "request"` — sections of
 * whichever request you are reading, in this order, rather than headings in a
 * strip that are empty until you have picked something. Request leads because it
 * says what the thing *was*; the exception comes next because if there is one it
 * is why you opened the panel; then the work it did, and the waterfall last,
 * being the summary of everything above it.
 */
const BUILT_IN = [
  liveTab,
  allTab,
  requestTab,
  exceptionsTab,
  queriesTab,
  logsTab,
  mailTab,
  cacheTab,
  jobsTab,
  timelineTab,
];

export const DevTools = {
  start(opts: DevtoolsClientOptions = {}): void {
    if (typeof document === "undefined") return;
    if (document.getElementById("__zerotal_dt__")) return;

    const base = (opts.endpoint ?? "/__zerotal/devtools").replace(/\/$/, "");
    const standalone = opts.mode === "standalone";

    const mount = (): void => {
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
    };

    // Mount nothing until the server half answers.
    //
    // The provider is gated on the environment, so in production the endpoints are
    // absent — and the client took that to mean it could start anyway and simply
    // connect to nothing. It could not: `mountShell` pinned the panel to the page
    // regardless, so zerotal.dev served a floating DevTools bar to every visitor,
    // opening onto tabs reading `Could not read the map — HTTP 404` because the
    // routes behind them do not exist in production.
    //
    // Failing closed here rather than in each app's entry file is deliberate: an
    // app that calls `start()` unconditionally — which the docs site did, with a
    // comment explaining why that was safe — is covered without knowing to be.
    void serverPresent(base).then((present) => {
      if (!present) return;
      if (document.getElementById("__zerotal_dt__")) return;
      mount();
    });
  },
};

/**
 * Whether the devtools routes exist on this origin.
 *
 * `api/channels` rather than `sse`: it answers and closes, where the stream stays
 * open and would leave a connection hanging on every page load just to discover
 * the panel should not be there. `no-store` so a 404 is not cached into a session
 * that later starts a dev server on the same origin.
 *
 * Any failure — offline, blocked by CSP, a proxy returning HTML — is treated as
 * absent. The panel is a development convenience, and the cost of guessing wrong
 * is that a developer presses Alt+D twice; the cost of guessing wrong the other
 * way is a debug surface on a production page.
 */
async function serverPresent(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/channels`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
