import { deepMerge } from "@zerotal/core";

export interface InertiaConfigShape {
  /** Path to the HTML template file. Default: './resources/app.html' */
  htmlTemplate: string;
  /** Asset version string for cache-busting. Default: '1' */
  version: string;
  /** Public URL prefix for built assets. Default: '/' */
  assetsUrl: string;
  /**
   * Directory (relative to the project root) where Inertia page components live.
   * Used by the page-registry generator, the SSR handler, and `inertiaStream()`.
   * Default: 'resources/js/pages'
   */
  pagesDir: string;
  /**
   * Server-render every first page load.
   *
   * `Inertia.render()` renders the component into the root, injects the page's
   * `<Head>` into the served `<head>`, and marks the root `data-server-rendered`
   * so the client hydrates it. One line; no controller changes.
   *
   * Pages render with the framework they are authored in: React `.tsx` via
   * `react-dom/server`, Vue `.vue` via `@inertiajs/vue3` + `vue/server-renderer`.
   * Install the server renderer for the framework the app uses.
   *
   * **This renders in-process and registers no route.** Until 1.14.0 it did the
   * opposite — it registered `POST /__ssr` and rendered nothing — so an app that
   * set it got an HTTP endpoint it had not asked for and the empty root it
   * already had. See {@link ssrEndpoint} for the endpoint, which is now its own
   * decision.
   *
   * Default: false
   */
  ssr: boolean;
  /**
   * Expose `POST /__ssr` for a renderer running outside this process.
   *
   * The endpoint accepts `{ component, props, url }` and returns `{ body, head }` —
   * the contract upstream Inertia uses, where the web framework has no JavaScript
   * runtime and must hand rendering to a separate Node process.
   *
   * **Zerotal does not need that boundary.** Bun *is* a JavaScript runtime, so
   * {@link ssr} imports the component and renders it inline. The endpoint remains
   * for the one case that is still real: deliberately moving render CPU off the
   * web process, onto another process or another host.
   *
   * Separate from {@link ssr} since 1.14.0. Turning rendering on should not open a
   * route that renders arbitrary components from POST input, however well guarded —
   * one switch, one thing.
   *
   * Default: false
   */
  ssrEndpoint: boolean;
  /**
   * Shared secret required to reach `POST /__ssr` from off-box.
   *
   * The endpoint is loopback-only by default, because it takes an arbitrary component name
   * and a props bag and does real rendering work with them — upstream Inertia runs SSR as a
   * separate process on a private port for exactly this reason. Set this (and send it as
   * `X-Inertia-SSR-Secret`) only when the renderer runs on another host.
   *
   * Default: `""` — loopback only.
   */
  ssrSecret: string;
  /**
   * Encrypt browser history state by default for every page. Individual pages can still opt in/out
   * per request via `Inertia.encryptHistory()` / `clearHistory()`. Default: false.
   */
  encryptHistory: boolean;
  /** DevTools recorder settings. See {@link InertiaDevtoolsConfig}. */
  devtools: InertiaDevtoolsConfig;
}

/**
 * Server-side recorder for the Inertia DevTools browser extension.
 *
 * Off unless this process already exposes dev surfaces (`devSurfacesEnabled()` —
 * the same gate as the stack-trace error page). The recorder holds resolved
 * props and request headers in memory and serves them over an unauthenticated
 * local endpoint, so it has to fail closed: a production deploy that sets no
 * `APP_ENV` records nothing and registers no routes.
 *
 * @see https://inertiajs.com/docs/v3/advanced/devtools
 */
export interface InertiaDevtoolsConfig {
  /**
   * Turn the recorder on or off explicitly. `null` (the default) follows
   * `devSurfacesEnabled()`, which is what `INERTIA_DEVTOOLS_ENABLED` sets when
   * present. Setting `true` here enables it even in production — do that only
   * behind {@link InertiaDevtoolsConfig.gate}.
   */
  enabled: boolean | null;
  /** How many entries to keep before the oldest is dropped. Default: 200. */
  maxEntries: number;
  /**
   * Extra prop/body key patterns to redact, on top of the built-in list
   * (`password`, `token`, `secret`, …). Matched as case-insensitive substrings.
   */
  redact: string[];
  /**
   * Extra header names to redact, on top of the built-in list (`authorization`,
   * `cookie`, …). Matched case-insensitively.
   */
  redactHeaders: string[];
  /**
   * Path prefixes that are never recorded. The DevTools read API excludes
   * itself regardless; this is for the health checks, metrics scrapes, and
   * dashboards that would otherwise bury the timeline in noise.
   */
  except: string[];
  /**
   * Authorisation for the read API when the recorder runs outside a dev
   * process. Receives the request; return `true` to allow.
   *
   * Never consulted while `devSurfacesEnabled()` is true, so a developer cannot
   * lock themselves out of their own machine — which is also why enabling the
   * recorder in production without setting this is refused at boot.
   */
  gate: ((request: Request) => boolean | Promise<boolean>) | null;
}

/** Default directory (relative to the project root) for Inertia page components. */
export const DEFAULT_PAGES_DIR = "resources/js/pages";

const defaults: InertiaConfigShape = {
  htmlTemplate: "./resources/app.html",
  version: "1",
  assetsUrl: "/",
  pagesDir: DEFAULT_PAGES_DIR,
  ssr: false,
  ssrEndpoint: false,
  ssrSecret: "",
  encryptHistory: false,
  devtools: {
    // `null`, not `false`: the recorder follows the process's dev-surface gate
    // unless an app overrides it, so it is on for `zt dev` and off in
    // production without anyone configuring anything.
    enabled: _envFlag("INERTIA_DEVTOOLS_ENABLED"),
    maxEntries: 200,
    redact: [],
    redactHeaders: [],
    except: [],
    gate: null,
  },
};

/** Read a tri-state boolean env var: unset stays `null` so the dev-surface gate decides. */
function _envFlag(name: string): boolean | null {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return null;
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

/**
 * Create a typed Inertia configuration object with defaults.
 *
 * @example
 * import { InertiaConfig } from '@zerotal/inertia';
 * export default InertiaConfig({
 *   htmlTemplate: './resources/app.html',
 *   version:      Bun.env['ASSET_VERSION'] ?? '1',
 *   ssr:          true,   // server-render every first page load
 * });
 */
export function InertiaConfig(options: Partial<InertiaConfigShape> = {}): InertiaConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    inertia: InertiaConfigShape;
  }
}
